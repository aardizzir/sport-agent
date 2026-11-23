/**
 * ANATA · Rutas que usa la app con la sesión del usuario (Fase 4).
 *
 *   POST /garmin/screenshot  { image_base64, media_type }  → lee la captura con Claude (no guarda)
 *   POST /garmin/manual      { date, source, fields }       → guarda en garmin_daily y rehace el resumen
 *   POST /today/effort       { rpe }                       → guarda "¿Qué tan duro fue?" en daily_states
 *   POST /today/refresh                                     → rehace "Tu cuerpo hoy" (p. ej. tras una molestia 7+)
 *
 * La sesión se verifica con Supabase (JWT del usuario). Esta versión es para un
 * solo usuario: solo ANATA_USER_ID puede escribir.
 */
import { extractScreenshot } from './claude.js';
import { generateDailySummary } from './summary.js';
import { localDate, addDays } from './garmin.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Campos que se pueden cargar a mano o por captura, con su rango válido.
export const EDITABLE_FIELDS = {
  body_battery_wake: [0, 100],
  sleep_score: [0, 100],
  sleep_minutes: [0, 1200],
  stress_avg: [0, 100],
  resting_hr: [25, 150],
  hrv_last_night_ms: [1, 300],
  training_readiness: [1, 100],
  vo2max: [10, 100],
  feeling: [1, 5],
};
const HRV_STATUS = ['balanced', 'unbalanced', 'low', 'poor', 'none'];

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Devuelve el id del usuario de la sesión, o null. */
export async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id || null;
}

/** Limpia y valida los campos que llegan de la app. Devuelve { clean, errors }. */
export function cleanFields(fields) {
  const clean = {};
  const errors = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === null || v === undefined || v === '') continue;
    if (k === 'hrv_status') {
      if (HRV_STATUS.includes(v)) clean[k] = v; else errors.push(`${k}: valor no válido`);
      continue;
    }
    const range = EDITABLE_FIELDS[k];
    if (!range) continue; // se ignoran campos desconocidos
    const n = Number(v);
    if (!Number.isFinite(n) || n < range[0] || n > range[1]) { errors.push(`${k}: fuera de rango (${range[0]}-${range[1]})`); continue; }
    clean[k] = k === 'vo2max' ? Math.round(n * 10) / 10 : Math.round(n);
  }
  return { clean, errors };
}

/**
 * Guarda campos cargados a mano o por captura sin borrar lo que trajo la API.
 * - Solo se escriben los campos enviados.
 * - `source`: si la fila ya existía (API) se mantiene; si es nueva, queda 'screenshot' o 'manual'.
 * - Qué campos vinieron de dónde queda en raw_json.screenshot / raw_json.manual.
 */
export async function saveManualFields(env, { date, source, fields }) {
  const url = `${env.SUPABASE_URL}/rest/v1/garmin_daily`;
  const existingRes = await fetch(`${url}?select=date,source,raw_json&user_id=eq.${env.ANATA_USER_ID}&date=eq.${date}`, { headers: serviceHeaders(env) });
  const existing = existingRes.ok ? (await existingRes.json())[0] : null;
  const raw = existing?.raw_json || {};
  const prev = raw[source] || {};
  const row = {
    user_id: env.ANATA_USER_ID,
    date,
    ...fields,
    source: existing?.source || source,
    raw_json: { ...raw, [source]: { fields: { ...(prev.fields || {}), ...fields }, saved_at: new Date().toISOString() } },
  };
  const res = await fetch(`${url}?on_conflict=user_id,date`, {
    method: 'POST',
    headers: serviceHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`No se pudo guardar (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

export async function handleUserRoute(request, env, path, json) {
  const userId = await verifyUser(request, env);
  if (!userId) return json({ error: 'Sesión inválida o vencida' }, 401);
  if (userId !== env.ANATA_USER_ID) return json({ error: 'Esta versión de ANATA es para un solo usuario' }, 403);
  const today = localDate();

  // Plan B: leer la captura. No guarda nada: la app muestra lo leído para confirmar.
  if (path === '/garmin/screenshot') {
    const body = await request.json().catch(() => ({}));
    const base64 = String(body.image_base64 || '').replace(/^data:[^,]+,/, '');
    const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(body.media_type) ? body.media_type : 'image/jpeg';
    if (!base64) return json({ error: 'Falta la imagen' }, 400);
    if (base64.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: 'La imagen es muy grande (máx. 5 MB)' }, 413);
    try {
      const extracted = await extractScreenshot(env, { base64, mediaType, today });
      const { notes, date, ...values } = extracted;
      const { clean } = cleanFields(values);
      // Si la captura no dice la fecha, se asume hoy; nunca una fecha futura.
      const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date <= today && date >= addDays(today, -30) ? date : today;
      return json({ date: d, fields: clean, notes: notes || '', found: Object.keys(clean).length });
    } catch (e) {
      console.error('screenshot error:', e);
      return json({ error: 'No pude leer la captura. Prueba con otra o usa el formulario manual.' }, 502);
    }
  }

  // Guardar (desde captura confirmada o formulario manual) y rehacer el resumen.
  if (path === '/garmin/manual') {
    const body = await request.json().catch(() => ({}));
    const source = body.source === 'screenshot' ? 'screenshot' : 'manual';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : today;
    if (date > today || date < addDays(today, -30)) return json({ error: 'Fecha fuera de rango' }, 400);
    const { clean, errors } = cleanFields(body.fields);
    if (errors.length) return json({ error: 'Revisa los valores', details: errors }, 400);
    if (!Object.keys(clean).length) return json({ error: 'No hay datos para guardar' }, 400);
    await saveManualFields(env, { date, source, fields: clean });
    let summary = null;
    if (date === today) {
      try { summary = await generateDailySummary(env, today, { force: true }); }
      catch (e) { console.error('summary after manual:', e); }
    }
    return json({ ok: true, date, saved: clean, summary });
  }

  // "Después de entrenar: ¿Qué tan duro fue? 1-10" → daily_states.training_rpe
  if (path === '/today/effort') {
    const body = await request.json().catch(() => ({}));
    const rpe = Math.round(Number(body.rpe));
    if (!(rpe >= 1 && rpe <= 10)) return json({ error: 'El valor va de 1 a 10' }, 400);
    const base = `${env.SUPABASE_URL}/rest/v1/daily_states`;
    const found = await fetch(`${base}?select=id&user_id=eq.${env.ANATA_USER_ID}&date=eq.${today}&limit=1`, { headers: serviceHeaders(env) });
    const row = found.ok ? (await found.json())[0] : null;
    const res = row
      ? await fetch(`${base}?id=eq.${row.id}`, { method: 'PATCH', headers: serviceHeaders(env, { Prefer: 'return=minimal' }), body: JSON.stringify({ training_rpe: rpe }) })
      : await fetch(base, { method: 'POST', headers: serviceHeaders(env, { Prefer: 'return=minimal' }), body: JSON.stringify({ user_id: env.ANATA_USER_ID, date: today, training_rpe: rpe }) });
    if (!res.ok) return json({ error: `No se pudo guardar (${res.status})`, detail: (await res.text()).slice(0, 200) }, 502);
    return json({ ok: true, date: today, training_rpe: rpe });
  }

  // Rehacer el resumen de hoy (molestia nueva, check-in, etc.).
  if (path === '/today/refresh') {
    try {
      const summary = await generateDailySummary(env, today, { force: true });
      return json({ ok: true, summary });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  }

  return json({ error: 'Not found' }, 404);
}
