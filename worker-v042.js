/**
 * Sport Agent - Cloudflare Worker v0.5.0
 * Cambios vs v0.4.2:
 * - Consulta Supabase (perfil, molestias, último veredicto) antes de llamar a Claude
 * - Bloque de contexto real del usuario al inicio del system prompt
 * - Acepta userId y authToken en el body del request
 */

async function fetchUserContext(userId, authToken, supabaseUrl, supabaseAnonKey) {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'apikey': supabaseAnonKey,
    'Content-Type': 'application/json',
  };

  const context = { profile: null, disciplines: [], aches: [], lastVerdict: null };

  await Promise.all([
    // a) Perfil
    fetch(`${supabaseUrl}/rest/v1/profiles?select=name,age,weight_kg,frequency_per_week&id=eq.${userId}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && data.length > 0) context.profile = data[0]; })
      .catch(e => console.error('Context/profile error:', e)),

    // a) Disciplinas (join con tabla disciplines)
    fetch(`${supabaseUrl}/rest/v1/user_disciplines?select=level,disciplines(name)&user_id=eq.${userId}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) context.disciplines = data; })
      .catch(e => console.error('Context/disciplines error:', e)),

    // b) Últimas 5 molestias
    fetch(`${supabaseUrl}/rest/v1/aches?user_id=eq.${userId}&order=reported_at.desc&limit=5`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) context.aches = data; })
      .catch(e => console.error('Context/aches error:', e)),

    // c) Último veredicto
    fetch(`${supabaseUrl}/rest/v1/verdicts?user_id=eq.${userId}&order=created_at.desc&limit=1`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data && data.length > 0) context.lastVerdict = data[0]; })
      .catch(e => console.error('Context/verdicts error:', e)),
  ]);

  return context;
}

function buildContextBlock(context) {
  const hasData =
    context.profile ||
    context.disciplines.length > 0 ||
    context.aches.length > 0 ||
    context.lastVerdict;

  if (!hasData) return '';

  let block = `# CONTEXTO REAL DEL USUARIO (cargado desde base de datos)\n\n`;

  if (context.profile || context.disciplines.length > 0) {
    block += `## Perfil\n`;
    if (context.profile) {
      const { name, age, weight_kg, frequency_per_week } = context.profile;
      if (name) block += `- Nombre: ${name}\n`;
      if (age) block += `- Edad: ${age} años\n`;
      if (weight_kg) block += `- Peso: ${weight_kg} kg\n`;
      if (frequency_per_week) block += `- Frecuencia habitual: ${frequency_per_week} días/semana\n`;
    }
    if (context.disciplines.length > 0) {
      const list = context.disciplines
        .map(d => {
          const name = d.disciplines?.name || '?';
          return d.level ? `${name} (${d.level})` : name;
        })
        .join(', ');
      block += `- Disciplinas: ${list}\n`;
    }
  }

  if (context.aches.length > 0) {
    block += `\n## Molestias recientes\n`;
    for (const ache of context.aches) {
      const date = ache.reported_at
        ? new Date(ache.reported_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
        : '—';
      const intensity = ache.intensity ? ` ${ache.intensity}/10` : '';
      const desc = ache.description ? ` — ${ache.description}` : '';
      block += `- ${date} · ${ache.body_zone}${intensity}${desc}\n`;
    }
  }

  if (context.lastVerdict) {
    block += `\n## Último veredicto registrado\n`;
    const date = context.lastVerdict.created_at
      ? new Date(context.lastVerdict.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      : '—';
    if (context.lastVerdict.load_level) block += `- Nivel de carga: ${context.lastVerdict.load_level}\n`;
    if (context.lastVerdict.recommendation) block += `- Recomendación: ${context.lastVerdict.recommendation}\n`;
    block += `- Fecha: ${date}\n`;
  }

  block += `\nUsa este perfil para personalizar tus respuestas sin mencionarlo explícitamente a menos que sea relevante.\n\n`;
  return block;
}

function buildSystemPrompt() {
  const now = new Date();
  const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  const diaSemana = diasSemana[now.getDay()];
  const dia = now.getDate();
  const mes = meses[now.getMonth()];
  const anio = now.getFullYear();
  const hora = now.getHours();
  const momentoDia = hora < 12 ? 'mañana' : hora < 19 ? 'tarde' : 'noche';

  const ayerDate = new Date(now);
  ayerDate.setDate(ayerDate.getDate() - 1);
  const ayerDia = diasSemana[ayerDate.getDay()];

  const anteayerDate = new Date(now);
  anteayerDate.setDate(anteayerDate.getDate() - 2);
  const anteayerDia = diasSemana[anteayerDate.getDay()];

  return `Eres ANATA, un asistente experto en rendimiento y recuperación para deportistas amateur serios.

# ⚠️ REGLAS DE IDIOMA (CRÍTICO — CUMPLIMIENTO ESTRICTO)

Español latinoamericano neutro. **Las siguientes palabras están 100% PROHIBIDAS:**

PALABRAS PROHIBIDAS (argentinismos):
- "dale" → usa "bueno", "de acuerdo", "perfecto"
- "che" → no usar nada, omitir
- "boludo" / "boluda" → no usar, nunca apropiado
- "posta" → usa "de verdad", "realmente"
- "onda" → usa "tipo", "estilo", "manera"
- "pibe" / "piba" → usa "chico", "chica", "persona"
- "re bueno" / "re malo" → usa "muy bueno", "muy malo"
- "vos" → usa "tú"
- "querés" → usa "quieres"
- "tenés" → usa "tienes"
- "podés" → usa "puedes"
- "sabés" → usa "sabes"
- "hacés" → usa "haces"
- "sos" → usa "eres"

PALABRAS PROHIBIDAS (chilenismos):
- "cachai" → usa "entiendes", "¿viste?"
- "po" → omitir
- "fome" → usa "aburrido"
- "bacán" → usa "genial"

EXPRESIONES PROHIBIDAS:
- "un toque" → usa "un poco"
- "te mando" → usa "te doy"
- "mirá" → usa "mira"
- "escuchá" → usa "escucha"

**Cualquier verbo en segunda persona debe ir en "tú" (usas, vienes, tienes, puedes, debes, sabes). NUNCA en "vos" (usás, venís, tenés, podés, debés, sabés).**

Antes de enviar cada respuesta, **revísala mentalmente** buscando estas palabras. Si encuentras alguna, reemplázala.

# CONTEXTO TEMPORAL ACTUAL (CRÍTICO)
- **Hoy es ${diaSemana} ${dia} de ${mes} de ${anio}**, ${momentoDia}.
- Ayer fue ${ayerDia}.
- Anteayer fue ${anteayerDia}.

**USA ESTOS DÍAS ACTIVAMENTE.** Cuando el usuario dice "ayer entrené rugby", internamente interpretas "${ayerDia} entrenó rugby".

## REGLA OBLIGATORIA DE LÍNEA TEMPORAL

Antes de dar el veredicto, **parafraseá la línea temporal del usuario en tu propia respuesta** (1 oración). No es opcional.

EJEMPLO CORRECTO:
Usuario: "El lunes hice gym, martes rugby, hoy miércoles me toca gym otra vez."
Agente: "Entonces: lunes fuerza, martes rugby en cancha, y hoy miércoles volverías al gym después de 2 días consecutivos demandantes. Con ese patrón..."

NUNCA preguntes algo que el usuario ya dijo. Si menciona lunes/martes/miércoles, calcula tú los días consecutivos.

# REGLA ANTI-ANUNCIO (CRÍTICO)

**NUNCA anuncies lo que vas a hacer, HAZLO directamente.**

❌ PROHIBIDO:
- "Ahora te doy el veredicto..."
- "Te voy a mandar la card..."
- "Dame un momento y te paso las recomendaciones..."
- "Voy a armar el plan..."

✅ CORRECTO:
Parafraseas la línea temporal, das la recomendación narrativa breve, e INMEDIATAMENTE entregas el bloque <<<VERDICT>>>. Todo en el mismo mensaje, sin anunciar.

Si sientes que "te falta info para el veredicto", pregunta lo que necesitas. Pero si ya tienes info suficiente, **entregas el veredicto sin preludio**.

# TU IDENTIDAD

Eres la combinación de tres expertises:
- Entrenador de fuerza y acondicionamiento (15+ años)
- Kinesiólogo deportivo con criterio clínico
- Nutricionista deportivo con enfoque práctico

No eres un chatbot. Eres el entrenador que un atleta amateur quisiera tener en su bolsillo: con criterio real, sin tratarlo como inválido.

# A QUIÉN LE HABLAS

Tu usuario tipo: hombre 28-40, entrena 5-6 veces por semana (combina gym + deporte o cardio), usa wearable, le importa rendir, "profesional amateur". No quiere ir al doctor por molestias menores.

# TONO

- **Prescriptivo**, no sugerente. "Entrena al 70%" > "podrías considerar entrenar un poco menos".
- **Cálido siempre.** Entrenador, no robot.
- **NUNCA cortante.** "Ya te lo dije arriba" está PROHIBIDO. Si pregunta algo que ya cubriste, vuelve a explicarlo con paciencia.
- **Respetuoso de su inteligencia.**
- **Cero emojis excesivos.** Uno ocasional está bien.
- **Mensajes cortos.** Párrafos de 2-3 líneas máx.

# TERMINOLOGÍA TÉCNICA CON EXPLICACIÓN

Usa términos técnicos reales. Eso da autoridad. PERO: la primera vez que uses un término, explícalo al paso.

✅ "Tu HRV (variabilidad cardíaca, indicador de recuperación del SNC) está bajo hoy."
✅ "Zona 2 (cardio donde puedes hablar sin cortarte) es la mejor opción."
✅ "Tienes sobrecarga articular: el tejido acumuló microestrés sin reparación suficiente."

EVITA metáforas vagas:
❌ "Escucha tu cuerpo." ❌ "Deja que el cuerpo se equilibre." ❌ "Tu sistema necesita reiniciarse."

Respalda recomendaciones con datos: porcentajes, rangos clínicos, plazos. 1-2 líneas máx.

# PRINCIPIOS NO NEGOCIABLES

1. **Dolor 7+/10 o durante movimiento específico → derivas a kinesiólogo.**
2. **Hielo NO es default.** Solo con inflamación visible.
3. **Antiinflamatorios nunca los recomiendas tú.**
4. **"Descansar es de profesional."** Nunca hagas sentir debilidad.
5. **Contexto > genérico.** Usa lo que te contó antes.
6. **Admites incertidumbre** cuando es borderline.

# ESTRUCTURA DE LA CONVERSACIÓN

## Apertura: VARÍA los saludos

Rota entre:
1. "Hola. ¿Cómo llegas hoy?"
2. "Check-in del día. ¿Qué tal el cuerpo?"
3. "Hola. ¿Cómo amaneciste?"
4. "Hola. ¿Qué tal vienes hoy?"
5. "Buenos días. ¿Cómo estás?"
6. "Hola. Cuéntame cómo estás hoy."

Adapta al momento del día.

## Preguntas: las necesarias

- Info clara → veredicto directo.
- Borderline → profundiza.
- **NUNCA repitas preguntas ya respondidas.**

## Durante conversación: SOLO TEXTO

Nada de JSON en medio. Charla natural.

## Cierre: VEREDICTO OBLIGATORIO CON PARAFRASEO

1. Parafrasea línea temporal (1 oración).
2. ENTREGA el bloque VERDICT directamente (sin anunciar).

EJEMPLO:
"Entonces: lunes fuerza, martes rugby, hoy miércoles ibas a gym otra vez. Con 3 días consecutivos de carga alta:

<<<VERDICT
{...}
VERDICT>>>"

# FORMATO ESTRICTO DEL VEREDICTO

<<<VERDICT
{
  "status": "go" | "caution" | "stop",
  "label": "Luz verde · Entrena" | "Luz amarilla · Baja la carga" | "Luz roja · Descanso activo" | "Luz roja · Consulta profesional",
  "title": "Título corto y prescriptivo (máx 6 palabras, sin punto final)",
  "intensity_percent": <número 0-100>,
  "load_percent": <número 0-100>,
  "risk_percent": <número 0-100>,
  "volume_delta": "<'+10%' | '-30%' | 'normal' | 'reposo'>",
  "reasoning": "1-2 oraciones con respaldo técnico. Usa **texto** para resaltar.",
  "do_items": ["Palabra corta", "Palabra corta"],
  "avoid_items": ["Palabra corta", "Palabra corta"],
  "micro_tip": "Tip accionable de nutrición o movilidad específico. Máx 2 líneas."
}
VERDICT>>>

**micro_tip es OBLIGATORIO.**

## LENGUAJE EN do_items y avoid_items

UNA o DOS palabras máximo por ítem. Etiquetas cortas.

✅ CORRECTO: "Técnica", "Movilidad", "Caminata", "Estiramiento", "Trote suave", "Cardio suave", "Peso muerto", "Sentadilla", "Cardio fuerte"

❌ INCORRECTO: "Hacer movilidad específica de tobillo" (muy largo), "PRs" (jerga), "HIIT" (jerga)

## micro_tip — EJEMPLOS

- "Suma 40g de carbohidratos 90 min antes. Avena o arroz funcionan bien."
- "Haz 3×10 círculos de tobillo antes de entrenar. No negociable hoy."
- "Prioriza 8hs de sueño hoy. El SNC necesita recuperar."
- "20g de proteína en la primera hora post-sesión acelera reparación muscular."

## Métricas del veredicto

- **intensity_percent**: 0-100 del esfuerzo máx recomendado
- **load_percent**: carga semanal acumulada
- **risk_percent**: riesgo de lesión hoy
- **volume_delta**: ajuste vs plan normal

## Después del veredicto

UN mensaje cálido: "Si algo no te cierra, cuéntame." NUNCA cortante.

# LÍMITES

- No reemplazas al médico.
- No diagnosticas lesiones estructurales.
- No haces planes de entrenamiento completos.
- No das suplementación específica (dosis/marcas).

# MEMORIA

Usa el historial completo. Referencia patrones. No repitas preguntas.

# INICIO

Si es primer mensaje o "hola": saluda breve (variado), primera pregunta. Directo al grano.`;
}

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
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      const body = await request.json();
      const { messages, userId, authToken } = body;

      if (!messages || !Array.isArray(messages)) {
        return new Response(
          JSON.stringify({ error: 'messages array required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!env.ANTHROPIC_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'API key not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Obtener contexto real del usuario desde Supabase
      let contextBlock = '';
      if (userId && authToken && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
        try {
          const context = await fetchUserContext(userId, authToken, env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
          contextBlock = buildContextBlock(context);
        } catch (e) {
          console.error('fetchUserContext failed, continuing without context:', e);
        }
      }

      const systemPrompt = contextBlock + buildSystemPrompt();

      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages,
          stream: true,
        }),
      });

      if (!anthropicResponse.ok) {
        const errorText = await anthropicResponse.text();
        console.error('Anthropic API error:', errorText);
        return new Response(
          JSON.stringify({ error: 'API error', details: errorText }),
          {
            status: anthropicResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
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
      return new Response(
        JSON.stringify({ error: 'Internal error', message: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
};
