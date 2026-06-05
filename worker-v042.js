/**
 * Sport Agent - Cloudflare Worker v0.6.0
 * Cambios vs v0.5.0:
 * - Motor de detección de patrones longitudinales (detectAndUpdatePatterns)
 *   sobre las tablas aches y verdicts -> escribe/actualiza la tabla `patterns`.
 * - Contexto de memoria estructurado (buildMemoryContext) inyectado al prompt.
 * - System prompt v2.0 (8 bloques) que obliga al uso de la memoria.
 * - Las escrituras de patrones corren en background (ctx.waitUntil) para no
 *   bloquear el streaming; el prompt usa los patrones recién computados en RAM.
 *
 * Esquema real verificado en Supabase (Sesión 05):
 *   aches:    id, user_id, conversation_id, body_zone, intensity(1-10),
 *             description, reported_at, created_at   (NO tiene `discipline`)
 *   verdicts: id, user_id, conversation_id, recommendation, load_level,
 *             rest_days, raw_json(jsonb), created_at
 *             -> raw_json.status = 'go' | 'caution' | 'stop'
 *             -> raw_json.label  = "Luz amarilla · ...", etc.
 *   profiles: id(=auth.uid), name, age, weight_kg, frequency_per_week,
 *             onboarding_completed
 */

// Modelo de Claude. claude-sonnet-4-6 es el Sonnet más reciente disponible
// al momento de esta sesión (junio 2026); no hay un Sonnet posterior estable.
const MODEL = 'claude-sonnet-4-6';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// ─────────────────────────────────────────────────────────────
// Helpers de fechas
// ─────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diffMs / 86400000);
}

function relativeDay(dateStr) {
  const d = daysSince(dateStr);
  if (d === null) return '—';
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  return `hace ${d} días`;
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function confidenceFor(count) {
  if (count >= 5) return 'high';
  if (count >= 3) return 'medium';
  return 'low';
}

function normZone(zone) {
  return (zone || '').trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// Contexto base: perfil + disciplinas + molestias recientes
// ─────────────────────────────────────────────────────────────
async function fetchUserContext(userId, headers, supabaseUrl) {
  const context = { profile: null, disciplines: [], aches: [] };

  await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/profiles?select=name,age,weight_kg,frequency_per_week&id=eq.${userId}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && data.length > 0) context.profile = data[0]; })
      .catch(e => console.error('Context/profile error:', e)),

    fetch(`${supabaseUrl}/rest/v1/user_disciplines?select=level,is_primary,disciplines(name)&user_id=eq.${userId}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) context.disciplines = data; })
      .catch(e => console.error('Context/disciplines error:', e)),

    // Molestias de los últimos 30 días, máx 5 para el bloque "Molestias activas"
    fetch(`${supabaseUrl}/rest/v1/aches?select=body_zone,intensity,description,reported_at&user_id=eq.${userId}&reported_at=gte.${isoDaysAgo(30)}&order=reported_at.desc&limit=5`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) context.aches = data; })
      .catch(e => console.error('Context/aches error:', e)),
  ]);

  return context;
}

// ─────────────────────────────────────────────────────────────
// TAREA 2 · Motor de detección de patrones
// Hace los reads, agrega en JS, computa los patrones y devuelve también
// las filas a upsertear (que el caller escribe en background).
// ─────────────────────────────────────────────────────────────
async function detectAndUpdatePatterns(userId, headers, supabaseUrl, primaryDiscipline) {
  const result = {
    patterns: [],          // patrones activos (recién computados)
    recentSummary: [],     // últimos 7 días
    hasRecurringAches: false,
    criticalPatterns: [],  // confidence 'high'
    upserts: [],           // filas para escribir en patterns
  };

  let aches60 = [], verdicts60 = [], verdicts7 = [];

  await Promise.all([
    // Detección 1: molestias últimos 60 días
    fetch(`${supabaseUrl}/rest/v1/aches?select=body_zone,reported_at&user_id=eq.${userId}&reported_at=gte.${isoDaysAgo(60)}&order=reported_at.desc`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(d => { aches60 = d || []; })
      .catch(e => console.error('detect/aches60 error:', e)),

    // Detección 2: veredictos últimos 60 días (para días de baja)
    fetch(`${supabaseUrl}/rest/v1/verdicts?select=raw_json,created_at&user_id=eq.${userId}&created_at=gte.${isoDaysAgo(60)}&order=created_at.desc`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(d => { verdicts60 = d || []; })
      .catch(e => console.error('detect/verdicts60 error:', e)),

    // Detección 3: veredictos últimos 7 días (resumen reciente)
    fetch(`${supabaseUrl}/rest/v1/verdicts?select=raw_json,recommendation,load_level,created_at&user_id=eq.${userId}&created_at=gte.${isoDaysAgo(7)}&order=created_at.desc`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(d => { verdicts7 = d || []; })
      .catch(e => console.error('detect/verdicts7 error:', e)),
  ]);

  // ── DETECCIÓN 1: molestias recurrentes por zona ──
  const byZone = new Map();
  for (const a of aches60) {
    const key = normZone(a.body_zone);
    if (!key) continue;
    if (!byZone.has(key)) byZone.set(key, { label: a.body_zone.trim(), count: 0, last: a.reported_at, first: a.reported_at });
    const g = byZone.get(key);
    g.count += 1;
    if (a.reported_at > g.last) g.last = a.reported_at;
    if (a.reported_at < g.first) g.first = a.reported_at;
  }

  for (const [key, g] of byZone) {
    if (g.count < 2) continue;
    result.hasRecurringAches = true;
    const conf = confidenceFor(g.count);
    const spanDays = Math.max(1, (daysSince(g.first) ?? 1));
    const discTxt = primaryDiscipline ? ` asociado a ${primaryDiscipline}` : '';
    const description = `${g.label} recurrente, ${g.count} ${g.count === 1 ? 'vez' : 'veces'} en los últimos ${spanDays} días${discTxt}`;
    const pattern = {
      type: 'recurring_ache',
      pattern_key: key,
      description,
      body_zone: g.label,
      discipline: primaryDiscipline || null,
      occurrences: g.count,
      confidence: conf,
      last_seen: g.last,
    };
    result.patterns.push(pattern);
    result.upserts.push({ user_id: userId, ...pattern });
    if (conf === 'high') result.criticalPatterns.push(pattern);
  }

  // ── DETECCIÓN 2: días de bajo rendimiento ──
  const byDow = new Map();
  for (const v of verdicts60) {
    const status = (v.raw_json && v.raw_json.status ? String(v.raw_json.status) : '').toLowerCase();
    const isLow = status === 'caution' || status === 'stop';
    if (!isLow) continue;
    const dow = new Date(v.created_at).getDay();
    if (!byDow.has(dow)) byDow.set(dow, { count: 0, last: v.created_at });
    const g = byDow.get(dow);
    g.count += 1;
    if (v.created_at > g.last) g.last = v.created_at;
  }

  for (const [dow, g] of byDow) {
    if (g.count < 3) continue;
    const conf = confidenceFor(g.count);
    const weeks = Math.max(1, Math.round((daysSince(g.last) ?? 0) / 7) + 1);
    const dayName = DAY_NAMES[dow];
    const description = `Los ${dayName} frecuentemente aparece con bajo rendimiento o precaución (${g.count} veces en las últimas semanas)`;
    const pattern = {
      type: 'fatigue_day',
      pattern_key: `dow-${dow}`,
      description,
      body_zone: null,
      discipline: null,
      occurrences: g.count,
      confidence: conf,
      last_seen: g.last,
    };
    result.patterns.push(pattern);
    result.upserts.push({ user_id: userId, ...pattern });
    if (conf === 'high') result.criticalPatterns.push(pattern);
  }

  // Ordenar por occurrences desc
  result.patterns.sort((a, b) => b.occurrences - a.occurrences);

  // ── DETECCIÓN 3: resumen de los últimos 7 días ──
  result.recentSummary = verdicts7.map(v => {
    const rj = v.raw_json || {};
    return {
      date: v.created_at,
      status: rj.status || v.load_level || '—',
      label: rj.label || null,
      summary: rj.title || rj.reasoning || v.recommendation || '',
    };
  });

  return result;
}

// Escribe los patrones detectados (upsert idempotente por user_id+type+pattern_key).
async function persistPatterns(upserts, headers, supabaseUrl) {
  if (!upserts || upserts.length === 0) return;
  try {
    // No mandamos first_seen/created_at: en update se preservan los existentes.
    const payload = upserts.map(p => ({ ...p, is_active: true, updated_at: new Date().toISOString() }));
    const res = await fetch(`${supabaseUrl}/rest/v1/patterns?on_conflict=user_id,type,pattern_key`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('persistPatterns failed:', res.status, await res.text());
  } catch (e) {
    console.error('persistPatterns error:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// TAREA 3 · Contexto enriquecido (bloque de memoria)
// ─────────────────────────────────────────────────────────────
function buildMemoryContext(context, patternsResult) {
  const profile = context.profile || {};
  const userName = profile.name || 'el usuario';

  const disciplineList = context.disciplines.length > 0
    ? context.disciplines
        .map(d => {
          const name = d.disciplines?.name || '?';
          const tags = [];
          if (d.level) tags.push(d.level);
          if (d.is_primary) tags.push('principal');
          return tags.length ? `${name} (${tags.join(', ')})` : name;
        })
        .join(', ')
    : 'sin registrar';

  const profileLine = [
    profile.age ? `${profile.age} años` : null,
    profile.weight_kg ? `${profile.weight_kg}kg` : null,
    profile.frequency_per_week ? `Entrena ${profile.frequency_per_week}x/semana` : null,
  ].filter(Boolean).join(' · ') || 'datos básicos incompletos';

  const totalSignals =
    patternsResult.patterns.length +
    patternsResult.recentSummary.length +
    context.aches.length;

  // Usuario nuevo / sin señales
  if (totalSignals === 0) {
    return `## MEMORIA DE ${userName}
Perfil: ${profileLine}
Disciplinas: ${disciplineList}
Historial: Es su primera semana usando ANATA. Sin patrones detectados aún.`;
  }

  let block = `## MEMORIA DE ${userName}\n\n`;
  block += `### Perfil\n${profileLine}\nDisciplinas: ${disciplineList}\n`;

  // Patrones
  block += `\n### Patrones identificados\n`;
  if (patternsResult.criticalPatterns.length > 0) {
    block += `⚠ ATENCIÓN — patrones de alta confianza:\n`;
    for (const p of patternsResult.criticalPatterns) {
      block += `- ${p.description}\n`;
    }
    block += `\n`;
  }
  if (patternsResult.patterns.length > 0) {
    for (const p of patternsResult.patterns) {
      block += `- ${p.description} (${p.occurrences} veces, última vez: ${relativeDay(p.last_seen)})\n`;
    }
  } else {
    block += `Sin patrones consolidados todavía.\n`;
  }

  // Últimos 7 días
  if (patternsResult.recentSummary.length > 0) {
    block += `\n### Últimos 7 días\n`;
    for (const v of patternsResult.recentSummary) {
      const summary = v.summary ? ` — ${v.summary}` : '';
      block += `- ${relativeDay(v.date)}: ${v.status}${summary}\n`;
      // ¿hubo molestia registrada ese mismo día?
      const sameDay = context.aches.find(a => daysSince(a.reported_at) === daysSince(v.date));
      if (sameDay) block += `  → Molestia: ${sameDay.body_zone}\n`;
    }
  }

  // Molestias activas
  if (context.aches.length > 0) {
    block += `\n### Molestias activas (últimos 30 días)\n`;
    for (const a of context.aches) {
      const intensity = a.intensity ? ` ${a.intensity}/10` : '';
      block += `- ${a.body_zone}${intensity} (${relativeDay(a.reported_at)})\n`;
    }
  }

  if (patternsResult.recentSummary.length < 5) {
    block += `\n_Historial corto (menos de 5 check-ins): las recomendaciones se afinarán con más sesiones._\n`;
  }

  return block;
}

// ─────────────────────────────────────────────────────────────
// TAREA 4 · System prompt v2.0
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(memoryBlock, disciplineNames) {
  const now = new Date();
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const diaSemana = DAY_NAMES[now.getDay()];
  const dia = now.getDate();
  const mes = meses[now.getMonth()];
  const anio = now.getFullYear();
  const hora = now.getHours();
  const momentoDia = hora < 12 ? 'mañana' : hora < 19 ? 'tarde' : 'noche';
  const ayerDia = DAY_NAMES[new Date(now.getTime() - 86400000).getDay()];
  const anteayerDia = DAY_NAMES[new Date(now.getTime() - 2 * 86400000).getDay()];

  const disciplinasTxt = disciplineNames.length > 0 ? disciplineNames.join(', ') : 'aún no registradas';

  return `# CONTEXTO TEMPORAL
Hoy es ${diaSemana} ${dia} de ${mes} de ${anio}, ${momentoDia}. Ayer fue ${ayerDia}. Anteayer fue ${anteayerDia}.
Usa estos días activamente: si el usuario dice "ayer entrené", interpreta "${ayerDia}". Antes del veredicto, parafrasea su línea temporal en 1 oración. Nunca preguntes algo que el usuario ya dijo.

# BLOQUE 1 · IDENTIDAD
Eres ANATA, un agente especializado en rendimiento deportivo y gestión de carga para atletas recreativos que se toman en serio su entrenamiento.
Tu expertise combina tres disciplinas:
- Preparación física y fuerza: periodización, gestión de carga, progresión de cargas, supercompensación, fatiga neuromuscular.
- Kinesiología deportiva: análisis de molestias, patrones de compensación, riesgo de lesión, cadenas musculares, protocolos de retorno.
- Nutrición deportiva: timing nutricional, recuperación, hidratación, impacto del sueño en la síntesis proteica.
NO eres un chatbot de bienestar general. NO das consejos de vida, motivación genérica ni psicología positiva. SÍ eres directivo, técnico y conciso. SÍ usas terminología precisa (no dices "músculo tenso", dices "tensión miofascial en cadena posterior" si corresponde). Eres cálido, nunca cortante: si preguntan algo ya cubierto, lo reexplicas con paciencia.

# BLOQUE 2 · USO OBLIGATORIO DE LA MEMORIA
Tienes acceso a la memoria del usuario (Bloque 8). Reglas:
1. Si existen patrones de alta confianza (⚠), SIEMPRE los mencionas en el primer mensaje de la conversación o en el primer momento relevante. No los guardas para después.
2. Si el usuario reporta algo parecido a un patrón ya registrado, lo conectas explícitamente: "Esto es consistente con el patrón que vengo registrando en tu isquiotibial izquierdo...".
3. Si el usuario reporta algo nuevo (zona o situación que no estaba en su historial), lo notas: "Nunca habías mencionado molestia en esa zona.".
4. Usas el historial de los últimos 7 días para contextualizar la carga acumulada antes de recomendar.
5. Si hay menos de 5 check-ins, lo dices: "Todavía estoy construyendo tu perfil. Con más sesiones mis recomendaciones van a ser más precisas.".

# BLOQUE 3 · PROTOCOLO DE EVALUACIÓN
Ante cada check-in evalúas en orden, sin saltarte pasos:
PASO 1 — Carga acumulada de los últimos 7 días (cuánto entrenó, intensidad, descanso).
PASO 2 — Estado subjetivo de hoy (sueño, energía, dolor, estado mental).
PASO 3 — Factores de riesgo del historial (patrones de molestias, días problemáticos, correlaciones disciplina/fatiga).
PASO 4 — Cruce: ¿lo de hoy es consistente con el historial o es algo nuevo?
PASO 5 — Veredicto con justificación técnica.
Si falta información para un paso, preguntas específicamente esa información antes de dar veredicto.

# BLOQUE 4 · ESCALA DE DOLOR
Si el usuario reporta dolor sin número, preguntas siempre: "¿En una escala del 1 al 10, qué intensidad tiene esa molestia?".
1-3: Monitorear. Continuar con adaptaciones menores. Registrar zona.
4-6: Precaución. Reducir carga en ese grupo muscular. Calentamiento específico. Reevaluar en 48h.
7-8: Detener ejercicios que involucren esa zona. RICE si es agudo. Derivar a profesional si persiste 72h.
9-10: Detener entrenamiento. Derivar a profesional inmediatamente. Sin recomendaciones de entrenamiento.
Ante dolor 7+: SIEMPRE incluyes en el veredicto la recomendación de consultar con un profesional de salud. Sin excepciones.

# BLOQUE 5 · RAZONAMIENTO POR DISCIPLINA
Disciplinas del usuario: ${disciplinasTxt}.
- Rugby / contacto: impacto acumulado, contactos, cambios de dirección explosivos. Las molestias post-partido son distintas a las de gimnasio. El lunes post-partido es distinto al lunes normal.
- Musculación / gym: considerar el split si lo tiene. La fatiga del SNC importa tanto como la muscular. Preguntar por grupos musculares entrenados si no se especifica.
- Running / ciclismo: el volumen (km) importa tanto como la intensidad. Molestias de cadena posterior son una alerta distinta a las de gym.
- Si combina dos o más disciplinas: evaluar interferencia; alta intensidad en una afecta la recuperación de la otra.

# BLOQUE 6 · FORMATO DE RESPUESTA
Mensajes de conversación: máximo 4 oraciones por turno, sin listas innecesarias, sin emojis, sin frases motivacionales genéricas. Directo al punto técnico.
Emites el bloque <<<VERDICT>>> cuando: (a) el usuario pregunta si puede entrenar o qué hacer, (b) tienes información suficiente para fundamentarlo, o (c) reporta algo que requiere una decisión clara.
El veredicto NUNCA se anuncia ("ahora te doy el veredicto" está prohibido): aparece integrado en la respuesta, después de parafrasear la línea temporal.

## FORMATO ESTRICTO DEL VEREDICTO
<<<VERDICT
{
  "status": "go" | "caution" | "stop",
  "label": "Luz verde · Entrena" | "Luz amarilla · Baja la carga" | "Luz roja · Descanso activo" | "Luz roja · Consulta profesional",
  "title": "Título corto y prescriptivo (máx 6 palabras, sin punto final)",
  "intensity_percent": <0-100>,
  "load_percent": <0-100>,
  "risk_percent": <0-100>,
  "volume_delta": "<'+10%' | '-30%' | 'normal' | 'reposo'>",
  "reasoning": "1-2 oraciones con respaldo técnico. Usa **texto** para resaltar.",
  "do_items": ["Palabra corta", "Palabra corta"],
  "avoid_items": ["Palabra corta", "Palabra corta"],
  "micro_tip": "Tip accionable de nutrición o movilidad. Máx 2 líneas."
}
VERDICT>>>
micro_tip es OBLIGATORIO. do_items/avoid_items: una o dos palabras por ítem, sin jerga (nada de "HIIT", "PRs"). Después del veredicto, un mensaje cálido: "Si algo no te cierra, cuéntame.".

## REGISTRO DE MOLESTIAS (bloque ACHE) — CRÍTICO PARA LA MEMORIA
Cada vez que el usuario reporte una molestia, dolor o tensión en una zona corporal concreta en su mensaje, emites AL FINAL de tu respuesta un bloque oculto ACHE. El usuario NUNCA lo ve; alimenta la memoria longitudinal (tabla aches). Reglas:
- Emites un bloque ACHE por cada molestia nueva reportada en ese mensaje. Si reporta dos zonas, emites dos bloques.
- Lo emites incluso si esa zona ya aparece en la memoria: cada reporte es una nueva ocurrencia (así se detectan los patrones recurrentes).
- NO lo emites para fatiga general, cansancio difuso o estados anímicos sin zona corporal. Solo molestias localizadas.
- body_zone específico y normalizado en minúsculas (ej. "isquiotibial izquierdo", "lumbar", "rodilla derecha", "hombro izquierdo"). Usa siempre el mismo nombre para la misma zona.
- intensity: número 1-10 si el usuario lo dio o lo pudiste establecer; null si todavía no lo sabes.
- description: cita breve del contexto ("tras rugby", "al correr"), o null.
- El bloque va SIEMPRE después del bloque VERDICT si ambos aparecen. Nunca lo anuncies ni lo menciones en el texto visible.

Formato exacto:
<<<ACHE
{"body_zone": "isquiotibial izquierdo", "intensity": 6, "description": "tras entrenamiento de rugby"}
ACHE>>>

# BLOQUE 7 · REGLAS DE IDIOMA
Español latinoamericano neutro. Tuteo ("tú"): usas, vienes, tienes, puedes, debes, sabes — NUNCA "vos" (usás, tenés, podés). Términos médicos y técnicos en español cuando existen; evita anglicismos innecesarios.
Prohibido: argentinismos y chilenismos ("dale", "che", "posta", "onda", "pibe", "vos", "querés", "tenés", "podés", "sos", "cachai", "po", "bacán"), y coloquialismos regionales. Permitido y recomendado: terminología de fisiología del ejercicio, anatomía funcional y biomecánica. Antes de enviar, revisa la respuesta y reemplaza cualquier término prohibido.

# LÍMITES
No reemplazas al médico. No diagnosticas lesiones estructurales. No haces planes de entrenamiento completos. No das suplementación específica (dosis/marcas). El hielo no es default (solo con inflamación visible). Nunca recomiendas antiinflamatorios.

# BLOQUE 8 · MEMORIA DEL USUARIO
${memoryBlock}`;
}

// ─────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { messages, userId, authToken } = body;

      if (!messages || !Array.isArray(messages)) {
        return new Response(JSON.stringify({ error: 'messages array required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!env.ANTHROPIC_API_KEY) {
        return new Response(JSON.stringify({ error: 'API key not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── Construir el bloque de memoria ──
      let memoryBlock = 'Sin memoria disponible (sesión sin autenticar).';
      let disciplineNames = [];

      if (userId && authToken && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
        const supabaseUrl = env.SUPABASE_URL;
        const headers = {
          'Authorization': `Bearer ${authToken}`,
          'apikey': env.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        };
        try {
          const context = await fetchUserContext(userId, headers, supabaseUrl);
          disciplineNames = context.disciplines.map(d => d.disciplines?.name).filter(Boolean);
          const primaryDiscipline =
            context.disciplines.find(d => d.is_primary)?.disciplines?.name ||
            disciplineNames[0] || null;

          const patternsResult = await detectAndUpdatePatterns(userId, headers, supabaseUrl, primaryDiscipline);
          memoryBlock = buildMemoryContext(context, patternsResult);

          // Escribir patrones en background: no bloquea el streaming.
          ctx.waitUntil(persistPatterns(patternsResult.upserts, headers, supabaseUrl));
        } catch (e) {
          console.error('memory build failed, continuing without memory:', e);
          memoryBlock = 'No se pudo cargar la memoria en este request.';
        }
      }

      const systemPrompt = buildSystemPrompt(memoryBlock, disciplineNames);

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages,
          stream: true,
        }),
      });

      if (!anthropicResponse.ok) {
        const errorText = await anthropicResponse.text();
        console.error('Anthropic API error:', errorText);
        return new Response(JSON.stringify({ error: 'API error', details: errorText }),
          { status: anthropicResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(anthropicResponse.body, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'Internal error', message: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  },
};
