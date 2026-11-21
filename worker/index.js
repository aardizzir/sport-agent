/**
 * ANATA · Cloudflare Worker `sport-agent-api` (v0.7.0 · Fase 1 ANATA Personal)
 *
 * Rutas:
 *   POST /  o  POST /chat        → chat con ANATA (igual que antes, ver chat.js)
 *   GET  /today                  → fila de hoy de garmin_daily + promedios de 7 días
 *                                  (requiere el JWT de Supabase del usuario)
 *   POST /admin/garmin/sync      → trae N días de Garmin y hace upsert (?days=3)
 *                                  devuelve qué métricas llegaron. Header X-Admin-Token.
 *   GET  /admin/profiles         → lista perfiles (para configurar ANATA_USER_ID)
 *   scheduled (cron)             → 06:30 y 09:30 hora de Santiago: trae ayer y hoy
 *
 * Secretos (nunca en el código; se cargan en Cloudflare):
 *   ANTHROPIC_API_KEY, GARMIN_PERSONAL_API_KEY, SUPABASE_SERVICE_ROLE_KEY, ANATA_ADMIN_TOKEN
 * Variables (wrangler.toml): SUPABASE_URL, SUPABASE_ANON_KEY, ANATA_USER_ID
 */
import { handleChat } from './chat.js';
import { fetchGarminDays, presenceReport, localDate, localHour, addDays, TZ } from './garmin.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Horas locales (Santiago) en que el cron trabaja. 6 = 06:30 (principal),
// 9 = 09:30 (repesca por si la banda sincronizó tarde). El cron de Cloudflare
// está en UTC, así que se programa en las dos horas UTC posibles (horario de
// verano e invierno de Chile) y aquí se descarta la que no corresponde.
const CRON_LOCAL_HOURS = [6, 9];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ─────────────────────────────────────────────────────────────
// Supabase (service role: solo dentro del Worker)
// ─────────────────────────────────────────────────────────────
function serviceHeaders(env, extra = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Falta el secreto SUPABASE_SERVICE_ROLE_KEY en el Worker');
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function upsertGarminRows(env, rows) {
  if (!env.ANATA_USER_ID) throw new Error('Falta ANATA_USER_ID (el uuid de tu usuario) en wrangler.toml');
  const payload = rows.map(r => ({ ...r, user_id: env.ANATA_USER_ID }));
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/garmin_daily?on_conflict=user_id,date`, {
    method: 'POST',
    headers: serviceHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Supabase upsert garmin_daily ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function logSyncRun(env, entry) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/garmin_sync_runs`, {
      method: 'POST',
      headers: serviceHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ user_id: env.ANATA_USER_ID, ...entry }),
    });
  } catch (e) {
    console.error('logSyncRun error:', e);
  }
}

// Trae fechas de Garmin, hace upsert y deja registro. Devuelve el reporte.
async function syncGarmin(env, dates, trigger) {
  const startedAt = Date.now();
  try {
    const { rows, endpointStatus, activitiesFound } = await fetchGarminDays(env, dates);
    await upsertGarminRows(env, rows);
    const report = presenceReport(rows);
    const missing = report.filter(m => m.days_with_value.startsWith('0/')).map(m => m.column);
    await logSyncRun(env, { trigger, ok: true, dates, missing_metrics: missing, duration_ms: Date.now() - startedAt });
    return { ok: true, dates, activitiesFound, metrics: report, endpointStatus };
  } catch (e) {
    console.error('syncGarmin error:', e);
    if (env.ANATA_USER_ID && env.SUPABASE_SERVICE_ROLE_KEY) {
      await logSyncRun(env, { trigger, ok: false, dates, error: String(e.message || e).slice(0, 500), duration_ms: Date.now() - startedAt });
    }
    return { ok: false, dates, error: String(e.message || e) };
  }
}

// ─────────────────────────────────────────────────────────────
// GET /today
// ─────────────────────────────────────────────────────────────
const AVG_FIELDS = [
  'body_battery_wake', 'body_battery_min', 'sleep_score', 'sleep_minutes', 'stress_avg',
  'resting_hr', 'hrv_last_night_ms', 'acute_load', 'steps',
];

function averages(rows) {
  const out = {};
  for (const f of AVG_FIELDS) {
    const vals = rows.map(r => r[f]).filter(v => typeof v === 'number');
    out[f] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    out[`${f}_days`] = vals.length;
  }
  return out;
}

async function handleToday(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Falta el token de sesión (Authorization: Bearer <jwt>)' }, 401);

  const url = new URL(request.url);
  const today = url.searchParams.get('date') || localDate();
  const from = addDays(today, -7);
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: auth };
  const cols = 'date,body_battery_wake,body_battery_min,body_battery_max,body_battery_sleep_charge,sleep_score,sleep_quality,sleep_minutes,stress_avg,resting_hr,resting_hr_7d_avg,hrv_last_night_ms,hrv_weekly_avg_ms,hrv_status,training_readiness,training_load,acute_load,load_ratio,vo2max,spo2_avg,steps,source,fetched_at';

  // RLS de Supabase filtra por el usuario del JWT.
  const [rowsRes, countRes, lastRunRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/garmin_daily?select=${cols}&date=gte.${from}&date=lte.${today}&order=date.desc`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/garmin_daily?select=date,sleep_score,acute_load&order=date.asc`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/garmin_sync_runs?select=ran_at,ok,trigger,missing_metrics,error&order=ran_at.desc&limit=1`, { headers }),
  ]);
  if (rowsRes.status === 401) return json({ error: 'Sesión inválida o vencida' }, 401);
  if (!rowsRes.ok) return json({ error: 'Error leyendo garmin_daily', detail: await rowsRes.text() }, 500);

  const rows = await rowsRes.json();
  const all = countRes.ok ? await countRes.json() : [];
  const lastRun = lastRunRes.ok ? (await lastRunRes.json())[0] || null : null;

  const todayRow = rows.find(r => r.date === today) || null;
  const previous7 = rows.filter(r => r.date < today); // "tu normal": los 7 días anteriores a hoy

  return json({
    date: today,
    timezone: TZ,
    today: todayRow,
    has_data_today: !!todayRow,
    averages_7d: averages(previous7),
    days_in_window: previous7.length,
    history: {
      days_with_data: all.length,
      days_with_sleep: all.filter(r => typeof r.sleep_score === 'number').length,
      first_date: all[0]?.date || null,
    },
    last_sync: lastRun,
  });
}

// ─────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────
function isAdmin(request, env) {
  const t = request.headers.get('X-Admin-Token');
  return !!env.ANATA_ADMIN_TOKEN && !!t && t === env.ANATA_ADMIN_TOKEN;
}

async function handleAdmin(request, env, path) {
  if (!isAdmin(request, env)) return json({ error: 'No autorizado' }, 401);
  const url = new URL(request.url);

  if (path === '/admin/profiles' && request.method === 'GET') {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=id,name,created_at&order=created_at.asc`, { headers: serviceHeaders(env) });
    return json(await res.json(), res.status);
  }

  if (path === '/admin/garmin/sync' && request.method === 'POST') {
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '2', 10) || 2, 1), 31);
    const end = url.searchParams.get('end') || localDate();
    const dates = Array.from({ length: days }, (_, i) => addDays(end, -i));
    const result = await syncGarmin(env, dates, url.searchParams.get('trigger') || 'manual');
    return json(result, result.ok ? 200 : 502);
  }

  return json({ error: 'Ruta admin no encontrada' }, 404);
}

// ─────────────────────────────────────────────────────────────
// Entrypoints
// ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'POST' && (path === '/' || path === '/chat')) {
        return await handleChat(request, env, ctx, CORS);
      }
      if (request.method === 'GET' && path === '/today') return await handleToday(request, env);
      if (path.startsWith('/admin/')) return await handleAdmin(request, env, path);
      if (request.method === 'GET' && path === '/') return json({ ok: true, service: 'ANATA sport-agent-api', version: '0.7.0' });
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ error: 'Internal error', message: String(e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime);
    const hour = localHour(now);
    if (!CRON_LOCAL_HOURS.includes(hour)) {
      console.log(`cron ${event.cron}: ${hour}h en Santiago, no corresponde (horario de verano/invierno)`);
      return;
    }
    const today = localDate(now);
    const result = await syncGarmin(env, [addDays(today, -1), today], `cron-${hour}h`);
    console.log('cron result:', JSON.stringify({ ok: result.ok, dates: result.dates, error: result.error }));
  },
};
