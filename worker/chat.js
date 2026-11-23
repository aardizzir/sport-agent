/**
 * ANATA - lógica del chat (antes worker-v042.js, v0.6.0).
 * Desde la Fase 1 de ANATA Personal el router está en worker/index.js.
 * Desde la Fase 2 el prompt vive en prompt.js y el contexto en context.js.
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


import { loadAnataContext, buildContextBlock } from './context.js';
import { buildSystem } from './prompt.js';
import { streamChat } from './claude.js';
import { localDate } from './garmin.js';

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
export async function fetchUserContext(userId, headers, supabaseUrl) {
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
export async function detectAndUpdatePatterns(userId, headers, supabaseUrl, primaryDiscipline) {
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
export async function persistPatterns(upserts, headers, supabaseUrl) {
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
export function buildMemoryContext(context, patternsResult) {
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
// Handler del chat (POST / y POST /chat). El router vive en worker/index.js.
// Fase 2: contexto con Garmin (context.js), prompt v3 (prompt.js) y
// Claude Sonnet 5.5 vía SDK oficial (claude.js).
// ─────────────────────────────────────────────────────────────
export async function handleChat(request, env, ctx, corsHeaders) {
  const jsonError = (data, status) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const body = await request.json();
    const { messages, userId, authToken } = body;

    if (!messages || !Array.isArray(messages)) return jsonError({ error: 'messages array required' }, 400);
    if (!env.ANTHROPIC_API_KEY) return jsonError({ error: 'API key not configured' }, 500);

    let contextBlock = 'Sin memoria disponible (sesión sin autenticar).';
    if (userId && authToken && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      const headers = {
        Authorization: `Bearer ${authToken}`,
        apikey: env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      };
      try {
        const anata = await loadAnataContext({ env, userId, headers, asOf: localDate() });
        contextBlock = buildContextBlock(anata);
        // Escribir patrones en background: no bloquea el streaming.
        ctx.waitUntil(persistPatterns(anata.patternsResult.upserts, headers, env.SUPABASE_URL));
      } catch (e) {
        console.error('memory build failed, continuing without memory:', e);
        contextBlock = 'No se pudo cargar la memoria en este request.';
      }
    }

    const anthropicResponse = await streamChat(env, { system: buildSystem(contextBlock), messages });
    return new Response(anthropicResponse.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    const status = typeof error.status === 'number' ? error.status : 500;
    return jsonError({ error: status === 500 ? 'Internal error' : 'API error', message: error.message }, status);
  }
}
