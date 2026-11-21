/**
 * ANATA · Cliente de la Garmin Connect Personal API (oficial, solo lectura).
 *
 * Fuente: developer.garmin.com/gc-developer-program/personal/ (FAQ + Swagger),
 * copia del spec en docs/garmin-personal-api-openapi.json.
 *
 * - La Personal API Key (secreto del Worker GARMIN_PERSONAL_API_KEY) se cambia
 *   por un access token OAuth2 que dura 24 h. No hay refresh token: pedimos uno
 *   nuevo en cada ejecución (1-2 veces al día).
 * - Nada de librerías no oficiales (garth, python-garminconnect).
 */

const GARMIN_BASE = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

// ─────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────
export async function getGarminToken(env) {
  if (!env.GARMIN_PERSONAL_API_KEY) {
    throw new Error('Falta el secreto GARMIN_PERSONAL_API_KEY en el Worker');
  }
  const res = await fetch(GARMIN_BASE + TOKEN_PATH, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${env.GARMIN_PERSONAL_API_KEY}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Garmin token ${res.status}: ${text.slice(0, 300)}`);
  }
  // El FAQ no documenta el nombre del campo; aceptamos las variantes OAuth2 habituales.
  let data;
  try { data = JSON.parse(text); } catch { data = { access_token: text.trim() }; }
  const token = data.access_token || data.accessToken || data.token;
  if (!token) throw new Error(`Garmin token: respuesta sin access_token (campos: ${Object.keys(data).join(', ')})`);
  return token;
}

async function garminGet(token, path, query) {
  const url = new URL(GARMIN_BASE + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
  if (!text) return { ok: true, status: res.status, data: null };
  try { return { ok: true, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, error: 'respuesta no JSON' }; }
}

// ─────────────────────────────────────────────────────────────
// Fechas (siempre en hora de Santiago)
// ─────────────────────────────────────────────────────────────
export const TZ = 'America/Santiago';

export function localDate(date = new Date(), tz = TZ) {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function localHour(date = new Date(), tz = TZ) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// Lectura cruda de un día
// ─────────────────────────────────────────────────────────────
async function fetchDayRaw(token, date) {
  const [summary, sleep, hrv, vo2] = await Promise.all([
    garminGet(token, '/usersummary-service/usersummary/daily', { calendarDate: date }),
    garminGet(token, '/sleep-service/sleep/dailySleep', { date }),
    garminGet(token, `/hrv-service/hrv/${date}`),
    garminGet(token, `/metrics-service/metrics/maxmet/daily/${date}/${date}`),
  ]);
  return { summary, sleep, hrv, vo2 };
}

// Actividades de un rango (para la carga de entrenamiento).
async function fetchActivities(token, startDate, endDate) {
  return garminGet(token, '/activitylist-service/activities/search/activities', {
    startDate, endDate, limit: 100, sortOrder: 'asc',
  });
}

// ─────────────────────────────────────────────────────────────
// Mapeo a garmin_daily
// ─────────────────────────────────────────────────────────────
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Garmin usa -1 / -2 cuando no hay datos suficientes (p.ej. estrés).
const pos = v => { const n = num(v); return n !== null && n >= 0 ? n : null; };
const int = v => { const n = pos(v); return n === null ? null : Math.round(n); };

function pickSleepScore(sleepScores) {
  if (!sleepScores || typeof sleepScores !== 'object') return { value: null, qualifier: null };
  const item = sleepScores.overall || sleepScores.overallScore || sleepScores.totalScore ||
    Object.entries(sleepScores).find(([k]) => /overall|total/i.test(k))?.[1];
  return { value: int(item?.value), qualifier: item?.qualifierKey || null };
}

function activityDate(a) {
  return (a.startTimeLocal || a.startTimeGMT || '').slice(0, 10);
}

/**
 * Convierte las respuestas crudas de un día en una fila de garmin_daily.
 * `loads` = { training_load, acute_load, load_ratio } calculados aparte.
 */
export function mapDay(date, raw, loads) {
  const s = raw.summary.ok ? raw.summary.data || {} : {};
  const sl = raw.sleep.ok ? raw.sleep.data || {} : {};
  const hv = raw.hrv.ok ? raw.hrv.data?.hrvSummary || {} : {};
  const vo2List = raw.vo2.ok && Array.isArray(raw.vo2.data) ? raw.vo2.data : [];
  const vo2 = vo2List.map(x => x?.generic).filter(Boolean).pop() || {};
  const score = pickSleepScore(sl.sleepScores);
  const sleepSeconds = pos(sl.sleepTimeSeconds);

  return {
    date,
    body_battery_wake: int(s.bodyBatteryAtWakeTime),
    body_battery_min: int(s.bodyBatteryLowestValue),
    body_battery_max: int(s.bodyBatteryHighestValue),
    body_battery_sleep_charge: int(s.bodyBatteryDuringSleep),
    sleep_score: score.value,
    sleep_quality: score.qualifier ? score.qualifier.toLowerCase() : null,
    sleep_minutes: sleepSeconds === null ? null : Math.round(sleepSeconds / 60),
    stress_avg: int(s.averageStressLevel),
    resting_hr: int(s.restingHeartRate),
    resting_hr_7d_avg: int(s.lastSevenDaysAvgRestingHeartRate),
    hrv_last_night_ms: int(hv.lastNightAvg),
    hrv_weekly_avg_ms: int(hv.weeklyAvg),
    hrv_status: hv.status ? String(hv.status).toLowerCase() : null,
    training_readiness: null, // La Personal API no lo entrega → Plan B (captura).
    training_load: loads?.training_load ?? null,
    acute_load: loads?.acute_load ?? null,
    load_ratio: loads?.load_ratio ?? null,
    vo2max: num(vo2.vo2MaxPreciseValue) ?? num(vo2.vo2MaxValue),
    spo2_avg: num(sl.averageSpO2Value) ?? num(s.averageSpo2),
    steps: int(s.totalSteps),
    source: 'api',
    raw_json: {
      usersummary: raw.summary.ok ? raw.summary.data : { error: raw.summary.status, detail: raw.summary.error },
      sleep: raw.sleep.ok ? raw.sleep.data : { error: raw.sleep.status, detail: raw.sleep.error },
      hrv: raw.hrv.ok ? stripHrvReadings(raw.hrv.data) : { error: raw.hrv.status, detail: raw.hrv.error },
      vo2max: raw.vo2.ok ? raw.vo2.data : { error: raw.vo2.status, detail: raw.vo2.error },
      activities: loads?.activities || [],
    },
    fetched_at: new Date().toISOString(),
  };
}

// Las lecturas cada 5 min de VFC no aportan al resumen; guardamos solo cuántas hubo.
function stripHrvReadings(d) {
  if (!d || typeof d !== 'object') return d;
  const { hrvReadings, ...rest } = d;
  return { ...rest, hrvReadingsCount: Array.isArray(hrvReadings) ? hrvReadings.length : 0 };
}

/**
 * Carga de entrenamiento calculada por ANATA (la Personal API no entrega el
 * "ratio de carga" de Garmin). Usa activityTrainingLoad de cada actividad:
 *   carga aguda   = suma de los últimos 7 días
 *   carga crónica = suma de los últimos 28 días / 4  (promedio semanal)
 *   ratio         = aguda / crónica, solo si hay ≥ 14 días desde la 1ª actividad
 */
function computeLoads(activities, date) {
  const loadOn = d => activities.filter(a => activityDate(a) === d)
    .reduce((acc, a) => acc + (num(a.activityTrainingLoad) || 0), 0);
  const sumRange = (from, to) => activities
    .filter(a => { const d = activityDate(a); return d >= from && d <= to; })
    .reduce((acc, a) => acc + (num(a.activityTrainingLoad) || 0), 0);

  const acute = sumRange(addDays(date, -6), date);
  const chronicWeekly = sumRange(addDays(date, -27), date) / 4;
  const first = activities.map(activityDate).filter(Boolean).sort()[0];
  const spanDays = first ? Math.round((Date.parse(date) - Date.parse(first)) / 86400000) + 1 : 0;
  const ratio = spanDays >= 14 && chronicWeekly > 0 ? Math.round((acute / chronicWeekly) * 100) / 100 : null;

  const dayActs = activities.filter(a => activityDate(a) === date).map(a => ({
    activityId: a.activityId,
    name: a.activityName,
    type: a.activityType?.typeKey || null,
    startTimeLocal: a.startTimeLocal,
    durationMin: num(a.duration) ? Math.round(a.duration / 60) : null,
    averageHR: num(a.averageHR),
    activityTrainingLoad: num(a.activityTrainingLoad),
    aerobicTrainingEffect: num(a.aerobicTrainingEffect),
    anaerobicTrainingEffect: num(a.anaerobicTrainingEffect),
  }));

  return {
    training_load: Math.round(loadOn(date)),
    acute_load: Math.round(acute),
    load_ratio: ratio,
    activities: dayActs,
  };
}

/**
 * Trae N fechas de Garmin y devuelve las filas listas para upsert.
 * También devuelve un reporte por endpoint (para el descubrimiento).
 */
export async function fetchGarminDays(env, dates) {
  const token = await getGarminToken(env);
  const sorted = [...dates].sort();
  const actRes = await fetchActivities(token, addDays(sorted[0], -27), sorted[sorted.length - 1]);
  const activities = actRes.ok ? (Array.isArray(actRes.data) ? actRes.data : actRes.data?.activityList || []) : [];

  const rows = [];
  const endpointStatus = { activities: actRes.ok ? 200 : actRes.status };
  for (const date of sorted) {
    const raw = await fetchDayRaw(token, date);
    for (const [k, v] of Object.entries(raw)) endpointStatus[`${k}:${date}`] = v.ok ? v.status : `${v.status} ${v.error || ''}`.trim();
    rows.push(mapDay(date, raw, computeLoads(activities, date)));
  }
  return { rows, endpointStatus, activitiesFound: activities.length };
}

// Qué métricas del "Traductor de métricas" trae cada fila.
export const TRANSLATOR_METRICS = [
  ['Body Battery al despertar', 'body_battery_wake'],
  ['Puntuación de sueño', 'sleep_score'],
  ['Horas dormidas', 'sleep_minutes'],
  ['Estrés promedio', 'stress_avg'],
  ['Estado de VFC', 'hrv_status'],
  ['VFC última noche (ms)', 'hrv_last_night_ms'],
  ['Disposición para entrenar', 'training_readiness'],
  ['Carga aguda (calculada por ANATA)', 'acute_load'],
  ['Ratio de carga (calculado por ANATA)', 'load_ratio'],
  ['Pulso en reposo', 'resting_hr'],
  ['VO2 máx', 'vo2max'],
  ['Sat. O2 (Pulse Ox)', 'spo2_avg'],
];

export function presenceReport(rows) {
  return TRANSLATOR_METRICS.map(([label, col]) => {
    const byDay = Object.fromEntries(rows.map(r => [r.date, r[col] ?? null]));
    const days = Object.values(byDay).filter(v => v !== null && v !== '').length;
    return { metric: label, column: col, days_with_value: `${days}/${rows.length}`, values: byDay };
  });
}
