/**
 * ANATA · Resumen diario "Tu cuerpo hoy" (mode: daily_summary).
 *
 * Lo llama el cron después de traer Garmin. Arma el contexto, pide a Claude el
 * bloque <<<SUMMARY>>>, lo valida y lo guarda en daily_summaries.
 * El código es la fuente de verdad para: qué métricas calibran y las reglas de
 * ANATA (si hay una regla activa, el color nunca puede ser "go").
 */
import { loadAnataContext, buildContextBlock, dayName } from './context.js';
import { buildSystem, PROMPT_VERSION } from './prompt.js';
import { completeText, MODEL } from './claude.js';

export const NO_DATA_TEXT = 'Tu banda aún no sincroniza lo de anoche. Abre Garmin Connect un momento o sube una captura.';
const SUMMARY_RE = /<<<SUMMARY\s*([\s\S]+?)\s*SUMMARY>>>/;
const COLORS = ['go', 'caution', 'stop'];

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Línea honesta de calibración, con los números exactos (la arma el código). */
export function calibrationLine(calibration) {
  const d = calibration.details;
  const parts = [];
  if (d.hrv_status) parts.push(`tu recuperación de fondo (noche ${d.hrv_status.day}/${d.hrv_status.of})`);
  if (d.load_ratio) parts.push(`tu carga (día ${d.load_ratio.day}/${d.load_ratio.of})`);
  if (d.normal_7d) parts.push(`tu normal (día ${d.normal_7d.day}/${d.normal_7d.of})`);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
  return `Sigo aprendiendo ${list}.`;
}

const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;

/** Firma de los datos: si no cambió, no se vuelve a generar (ahorra llamadas). */
function signatureOf(ctx) {
  const t = ctx.today || {};
  const y = ctx.yesterday || {};
  return JSON.stringify([
    t.body_battery_wake, t.sleep_score, t.sleep_minutes, t.resting_hr, t.hrv_last_night_ms, t.hrv_status,
    t.training_readiness, t.feeling, y.stress_avg, y.training_load, ctx.flags.map(f => f.rule),
  ]);
}

export function parseSummary(text) {
  const m = text.match(SUMMARY_RE);
  if (!m) throw new Error('La respuesta no trae el bloque <<<SUMMARY>>>');
  const data = JSON.parse(m[1]);
  if (typeof data.headline !== 'string' || !data.headline.trim()) throw new Error('SUMMARY sin headline');
  if (!COLORS.includes(data.color)) throw new Error(`SUMMARY con color inválido: ${data.color}`);
  if (!Array.isArray(data.lines) || data.lines.length < 1 || data.lines.some(l => typeof l !== 'string')) {
    throw new Error('SUMMARY sin lines válidas');
  }
  return { headline: data.headline.trim(), color: data.color, lines: data.lines.map(l => l.trim()).filter(Boolean).slice(0, 5) };
}

async function existingSummary(env, date) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/daily_summaries?select=date,data_signature&user_id=eq.${env.ANATA_USER_ID}&date=eq.${date}`, { headers: serviceHeaders(env) });
  return res.ok ? (await res.json())[0] || null : null;
}

async function saveSummary(env, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/daily_summaries?on_conflict=user_id,date`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: env.ANATA_USER_ID, ...row }),
  });
  if (!res.ok) throw new Error(`Supabase upsert daily_summaries ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/**
 * Genera y guarda el resumen de `date`. Con force=false no repite si los datos
 * no cambiaron desde la última vez (la repesca de las 09:30 usa esto).
 */
export async function generateDailySummary(env, date, { force = false, save = true } = {}) {
  const ctx = await loadAnataContext({ env, userId: env.ANATA_USER_ID, headers: serviceHeaders(env), asOf: date });
  const signature = signatureOf(ctx);

  if (!force) {
    const prev = await existingSummary(env, date);
    if (prev && prev.data_signature === signature) return { skipped: true, reason: 'sin cambios en los datos', date };
  }

  const calibrating = ctx.calibration.calibrating;
  const flags = ctx.flags.map(f => f.rule);

  // Sin datos de anoche: texto fijo de marca, sin llamar a Claude.
  if (!ctx.today || (ctx.today.body_battery_wake == null && ctx.today.sleep_score == null)) {
    const row = {
      date, headline: 'Esperando tu banda', color: null, lines: [NO_DATA_TEXT], summary_text: NO_DATA_TEXT,
      calibrating_metrics: calibrating, flags, data_signature: signature, status: 'no_data',
      model: null, prompt_version: PROMPT_VERSION, word_count: words(NO_DATA_TEXT), created_at: new Date().toISOString(),
    };
    if (save) await saveSummary(env, row);
    return { ...row, saved: save };
  }

  // Hora de referencia: 06:30 de Santiago de ese día (UTC-3 en verano).
  const now = new Date(`${date}T09:30:00Z`);
  const system = buildSystem(buildContextBlock(ctx), now);
  const calLine = calibrationLine(ctx.calibration);
  const messages = [{
    role: 'user',
    content: `Modo daily_summary. Genera "Tu cuerpo hoy" para el ${dayName(date)} ${date} siguiendo el BLOQUE C. Métricas calibrando según el contexto: ${JSON.stringify(calibrating)}.`
      + (calLine ? ` La última línea debe ser esta, con sus números exactos (puedes ajustar mínimamente la redacción): "${calLine}"` : '')
      + ' Responde solo con el bloque SUMMARY.',
  }];

  let parsed, result, lastErr;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    try {
      result = await completeText(env, { system, messages, effort: 'medium' });
      parsed = parseSummary(result.text);
    } catch (e) {
      lastErr = e;
      console.error(`daily_summary intento ${attempt}:`, e.message);
    }
  }
  if (!parsed) throw lastErr;

  // Reglas de ANATA mandan sobre el color.
  if (ctx.flags.some(f => f.rule === 'ache_7plus')) parsed.color = 'stop';
  else if (ctx.flags.length && parsed.color === 'go') parsed.color = 'caution';

  const summaryText = parsed.lines.join('\n');
  const row = {
    date, headline: parsed.headline, color: parsed.color, lines: parsed.lines, summary_text: summaryText,
    calibrating_metrics: calibrating, flags, data_signature: signature, status: 'ok',
    model: result.model || MODEL, prompt_version: PROMPT_VERSION,
    word_count: words(parsed.headline) + words(summaryText), created_at: new Date().toISOString(),
  };
  if (save) await saveSummary(env, row);
  return { ...row, saved: save, usage: result.usage };
}
