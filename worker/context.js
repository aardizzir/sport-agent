/**
 * ANATA · Contexto que el Worker arma antes de llamar a Claude (Fase 2).
 *
 * Lee de Supabase: perfil, garmin_daily (14 días), promedios de 7 días,
 * molestias activas, últimas 5 decisiones y patrones. Calcula en código
 * (no lo deja al modelo): calibración, "tu normal" y las reglas de ANATA.
 *
 * Funciona con dos tipos de headers:
 *   - JWT del usuario (chat desde la app; RLS filtra por usuario)
 *   - service role (cron; filtramos por user_id explícitamente)
 */
import { fetchUserContext, detectAndUpdatePatterns, buildMemoryContext } from './chat.js';
import { addDays } from './garmin.js';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const HRV_CALIBRATION_NIGHTS = 21;
const LOAD_CALIBRATION_DAYS = 14;

const GARMIN_COLS = [
  'date', 'body_battery_wake', 'body_battery_min', 'body_battery_max', 'body_battery_sleep_charge',
  'sleep_score', 'sleep_quality', 'sleep_minutes', 'stress_avg', 'resting_hr', 'resting_hr_7d_avg',
  'hrv_last_night_ms', 'hrv_weekly_avg_ms', 'hrv_status', 'training_readiness', 'training_load',
  'acute_load', 'load_ratio', 'vo2max', 'spo2_avg', 'steps', 'feeling', 'source', 'raw_json->activities',
].join(',');

export function dayName(isoDate) {
  return DAY_NAMES[new Date(isoDate + 'T12:00:00Z').getUTCDay()];
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round1 = v => Math.round(v * 10) / 10;

export function hhmm(minutes) {
  if (!isNum(minutes)) return null;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

function avg(rows, field) {
  const vals = rows.map(r => r[field]).filter(isNum);
  return vals.length ? { value: round1(vals.reduce((a, b) => a + b, 0) / vals.length), days: vals.length } : { value: null, days: 0 };
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Lee todo lo necesario. `asOf` = fecha (YYYY-MM-DD, hora de Santiago) que
 * cuenta como "hoy"; sirve para generar resúmenes de días pasados.
 */
export async function loadAnataContext({ env, userId, headers, asOf }) {
  const url = env.SUPABASE_URL;
  const from14 = addDays(asOf, -13);

  const base = await fetchUserContext(userId, headers, url);
  const disciplineNames = base.disciplines.map(d => d.disciplines?.name).filter(Boolean);
  const primaryDiscipline = base.disciplines.find(d => d.is_primary)?.disciplines?.name || disciplineNames[0] || null;

  const [patternsResult, garmin14, garminAll, verdicts5, efforts] = await Promise.all([
    detectAndUpdatePatterns(userId, headers, url, primaryDiscipline),
    getJson(`${url}/rest/v1/garmin_daily?select=${GARMIN_COLS}&user_id=eq.${userId}&date=gte.${from14}&date=lte.${asOf}&order=date.asc`, headers).catch(e => { console.error('ctx/garmin14', e); return []; }),
    getJson(`${url}/rest/v1/garmin_daily?select=date,sleep_score,hrv_last_night_ms&user_id=eq.${userId}&date=lte.${asOf}&order=date.asc`, headers).catch(e => { console.error('ctx/garminAll', e); return []; }),
    getJson(`${url}/rest/v1/verdicts?select=raw_json,created_at&user_id=eq.${userId}&order=created_at.desc&limit=5`, headers).catch(e => { console.error('ctx/verdicts5', e); return []; }),
    // "¿Qué tan duro fue?" de los últimos 7 días (Fase 4).
    getJson(`${url}/rest/v1/daily_states?select=date,training_rpe&user_id=eq.${userId}&training_rpe=not.is.null&date=gte.${addDays(asOf, -7)}&order=date.asc`, headers).catch(() => []),
  ]);

  const today = garmin14.find(r => r.date === asOf) || null;
  const yesterday = garmin14.find(r => r.date === addDays(asOf, -1)) || null;
  const previous7 = garmin14.filter(r => r.date < asOf && r.date >= addDays(asOf, -7));

  const normal = {};
  for (const f of ['body_battery_wake', 'sleep_score', 'sleep_minutes', 'stress_avg', 'resting_hr', 'hrv_last_night_ms', 'steps']) {
    normal[f] = avg(previous7, f);
  }

  const calibration = computeCalibration({ asOf, today, garmin14, garminAll });
  const flags = computeFlags({ asOf, today, garmin14, aches: base.aches });

  return {
    asOf, base, disciplineNames, patternsResult, verdicts5,
    garmin14, garminAll, today, yesterday, previous7, normal, calibration, flags, efforts,
  };
}

/**
 * Qué métricas todavía no son confiables y cuánto falta.
 *  - Estado de VFC: Garmin necesita ~3 semanas de noches con la banda.
 *  - Ratio de carga: lo calcula ANATA con 14 días de historia.
 *  - "Tu normal": ANATA lo arma con 7 días.
 */
export function computeCalibration({ asOf, today, garmin14, garminAll }) {
  const out = { calibrating: [], details: {} };

  const hrvNights = garminAll.filter(r => isNum(r.hrv_last_night_ms)).length;
  const hrvStatus = today?.hrv_status || [...garmin14].reverse().find(r => r.hrv_status)?.hrv_status || null;
  if (!hrvStatus || hrvStatus === 'none') {
    out.calibrating.push('hrv_status');
    const remaining = Math.max(HRV_CALIBRATION_NIGHTS - hrvNights, 0);
    out.details.hrv_status = { day: hrvNights, of: HRV_CALIBRATION_NIGHTS, estimated_ready: addDays(asOf, remaining) };
  }

  const first = garminAll[0]?.date || asOf;
  const historyDays = Math.round((Date.parse(asOf) - Date.parse(first)) / 86400000) + 1;
  if (!isNum(today?.load_ratio)) {
    out.calibrating.push('load_ratio');
    const remaining = Math.max(LOAD_CALIBRATION_DAYS - historyDays, 0);
    out.details.load_ratio = { day: Math.min(historyDays, LOAD_CALIBRATION_DAYS), of: LOAD_CALIBRATION_DAYS, estimated_ready: addDays(asOf, remaining) };
  }

  const normalDays = garmin14.filter(r => r.date < asOf && r.date >= addDays(asOf, -7)).length;
  if (normalDays < 7) {
    out.calibrating.push('normal_7d');
    out.details.normal_7d = { day: normalDays, of: 7 };
  }
  return out;
}

/**
 * Reglas de ANATA (doc, sección "Traductor de métricas"), calculadas en código.
 */
export function computeFlags({ asOf, today, garmin14, aches }) {
  const flags = [];

  // 1) Pulso en reposo ≥ 5 sobre el promedio de 7 días, 2 días seguidos.
  const elevated = d => {
    const row = garmin14.find(r => r.date === d);
    if (!isNum(row?.resting_hr)) return null;
    const prev = garmin14.filter(r => r.date < d && r.date >= addDays(d, -7));
    const a = avg(prev, 'resting_hr');
    if (a.days < 3) return null; // sin base suficiente no se juzga
    return { diff: round1(row.resting_hr - a.value), base: a.value, value: row.resting_hr };
  };
  const e0 = elevated(asOf), e1 = elevated(addDays(asOf, -1));
  if (e0 && e1 && e0.diff >= 5 && e1.diff >= 5) {
    flags.push({ rule: 'rhr_elevated_2d', text: `Pulso en reposo ${e1.diff} y ${e0.diff} latidos sobre su normal dos días seguidos: señal de cansancio acumulado.` });
  }

  // 2) Batería al despertar ≤ 25 y sueño < 60 → por defecto Ajusta o Descansa.
  if (isNum(today?.body_battery_wake) && isNum(today?.sleep_score) && today.body_battery_wake <= 25 && today.sleep_score < 60) {
    flags.push({ rule: 'low_battery_low_sleep', text: `Batería al despertar ${today.body_battery_wake} y sueño ${today.sleep_score}: la decisión por defecto es Ajusta o Descansa.` });
  }

  // 3) Molestia ≥ 7/10 en los últimos 7 días: siempre gana sobre las métricas.
  const strong = (aches || []).filter(a => isNum(a.intensity) && a.intensity >= 7 && a.reported_at >= addDays(asOf, -7));
  for (const a of strong) {
    flags.push({ rule: 'ache_7plus', text: `Molestia en ${a.body_zone} de ${a.intensity}/10 (reportada ${a.reported_at.slice(0, 10)}): gana sobre cualquier métrica. Derivar al kinesiólogo y no dar plan para esa zona.` });
  }
  return flags;
}

// ─────────────────────────────────────────────────────────────
// Bloque de contexto compacto para el prompt
// ─────────────────────────────────────────────────────────────
const v = (x, suffix = '') => (isNum(x) ? `${x}${suffix}` : '—');

function activitiesOf(row) {
  const acts = row?.activities || row?.['raw_json->activities'] || [];
  return Array.isArray(acts) ? acts : [];
}

function actsText(row) {
  const acts = activitiesOf(row);
  if (!acts.length) return 'sin entrenamientos registrados';
  return acts.map(a => `${a.name || a.type || 'actividad'} ${v(a.durationMin, ' min')}, carga ${isNum(a.activityTrainingLoad) ? Math.round(a.activityTrainingLoad) : '—'}`).join('; ');
}

export function buildGarminBlock(ctx) {
  const { asOf, today, yesterday, normal, calibration, flags, garmin14 } = ctx;
  const lines = [];
  lines.push(`## DATOS DE LA BANDA GARMIN CIRQA`);
  lines.push(`"Hoy" = ${dayName(asOf)} ${asOf}. La fila de hoy trae el sueño de anoche y la batería al despertar. El estrés, los pasos y los entrenamientos de hoy recién empiezan: para hablar del día, usa los de ayer.`);

  if (!today) {
    lines.push(`\nHOY: sin datos todavía (la banda no ha sincronizado lo de anoche). No inventes valores.`);
  } else {
    lines.push(`\nHOY (${asOf}): batería al despertar ${v(today.body_battery_wake)} · cargó durmiendo ${v(today.body_battery_sleep_charge)} · sueño ${v(today.sleep_score)}${today.sleep_quality ? ` (${today.sleep_quality})` : ''}, ${hhmm(today.sleep_minutes) || '—'} · pulso en reposo ${v(today.resting_hr)} · VFC anoche ${v(today.hrv_last_night_ms, ' ms')} (estado Garmin: ${today.hrv_status || '—'}) · Sat. O2 ${v(today.spo2_avg, '%')} · cómo se siente (1-5): ${v(today.feeling)} · fuente: ${today.source}`);
  }
  if (yesterday) {
    lines.push(`AYER (${dayName(yesterday.date)} ${yesterday.date}): estrés promedio ${v(yesterday.stress_avg)} · batería mínima ${v(yesterday.body_battery_min)} · pasos ${v(yesterday.steps)} · entrenamientos: ${actsText(yesterday)}`);
  }

  // Promedios redondeados: el modelo los repite tal cual y sin decimales se leen más simple.
  const n = Object.fromEntries(Object.entries(normal).map(([k, o]) => [k, { ...o, value: isNum(o.value) ? Math.round(o.value) : null }]));
  const dd = o => `${o.days} ${o.days === 1 ? 'día' : 'días'}`;
  const nd = calibration.details.normal_7d ? ` — OJO: solo ${calibration.details.normal_7d.day} de 7 días, todavía aprendiendo su normal` : '';
  lines.push(`\nTU NORMAL (promedio de los días anteriores a hoy, máx. 7${nd}): batería al despertar ${v(n.body_battery_wake.value)} (${dd(n.body_battery_wake)}) · sueño ${v(n.sleep_score.value)} (${dd(n.sleep_score)}) · horas dormidas ${hhmm(n.sleep_minutes.value) || '—'} (${dd(n.sleep_minutes)}) · estrés ${v(n.stress_avg.value)} (${dd(n.stress_avg)}) · pulso en reposo ${v(n.resting_hr.value)} (${dd(n.resting_hr)}) · VFC ${v(n.hrv_last_night_ms.value, ' ms')} (${dd(n.hrv_last_night_ms)})`);

  if (ctx.efforts?.length) {
    lines.push(`\nESFUERZO PERCIBIDO DESPUÉS DE ENTRENAR (1-10, lo responde él): ${ctx.efforts.map(e => `${dayName(e.date)} ${e.date}: ${e.training_rpe}`).join(' · ')}`);
  }
  lines.push(`\nCARGA DE ENTRENAMIENTO (calculada por ANATA con la carga de cada actividad): carga aguda 7 días ${v(today?.acute_load ?? yesterday?.acute_load)} · ratio aguda/crónica ${v(today?.load_ratio)}`);

  lines.push(`\nÚLTIMOS 14 DÍAS (fecha | batería despertar | sueño | horas | estrés | pulso reposo | VFC ms | carga del día | entrenamientos):`);
  for (const r of garmin14) {
    lines.push(`${r.date} ${dayName(r.date).slice(0, 3)} | ${v(r.body_battery_wake)} | ${v(r.sleep_score)} | ${hhmm(r.sleep_minutes) || '—'} | ${v(r.stress_avg)} | ${v(r.resting_hr)} | ${v(r.hrv_last_night_ms)} | ${v(r.training_load)} | ${activitiesOf(r).map(a => a.name || a.type).join(', ') || '—'}`);
  }
  if (!garmin14.length) lines.push('(sin datos de Garmin aún)');

  lines.push(`\nCALIBRACIÓN (no adivines estas métricas, dilo en una frase):`);
  const d = calibration.details;
  if (d.hrv_status) lines.push(`- Estado de VFC: calibrando, noche ${d.hrv_status.day} de ${d.hrv_status.of}. Listo aprox. ${d.hrv_status.estimated_ready} si usa la banda todas las noches.`);
  if (d.load_ratio) lines.push(`- Ratio de carga: calibrando, día ${d.load_ratio.day} de ${d.load_ratio.of}. Listo aprox. ${d.load_ratio.estimated_ready}.`);
  if (d.normal_7d) lines.push(`- Tu normal de 7 días: día ${d.normal_7d.day} de 7. Las comparaciones son provisorias.`);
  lines.push(`- Disposición para entrenar (Training Readiness): la API de Garmin no la entrega; solo existe si viene por captura (fuente screenshot). No la menciones si no está.`);
  lines.push(`- VO2 máx: ${garmin14.some(r => isNum(r.vo2max)) ? 'disponible; solo como tendencia mensual, nunca en el resumen diario' : 'Garmin todavía no lo calcula; no lo menciones en el resumen diario'}.`);

  lines.push(`\nREGLAS DE ANATA ACTIVAS HOY:`);
  if (flags.length) for (const f of flags) lines.push(`- ${f.text}`);
  else lines.push('- Ninguna regla de alerta activa.');

  return lines.join('\n');
}

export function buildRecentVerdictsBlock(verdicts5) {
  if (!verdicts5?.length) return '';
  const lines = ['### Últimas decisiones de ANATA'];
  for (const vd of verdicts5) {
    const r = vd.raw_json || {};
    lines.push(`- ${vd.created_at.slice(0, 10)}: ${r.label || r.status || '—'}${r.title ? ` — ${r.title}` : ''}`);
  }
  return lines.join('\n');
}

/** Bloque completo de memoria + Garmin que va al final del system prompt. */
export function buildContextBlock(ctx) {
  const memory = buildMemoryContext(ctx.base, ctx.patternsResult);
  return [memory, buildRecentVerdictsBlock(ctx.verdicts5), buildGarminBlock(ctx)].filter(Boolean).join('\n\n');
}
