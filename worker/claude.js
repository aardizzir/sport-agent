/**
 * ANATA · Llamadas a Claude con el SDK oficial (@anthropic-ai/sdk).
 *
 * Modelo: Claude Sonnet 5.5 (`claude-sonnet-5-5`), el Sonnet vigente (nov 2026).
 * - Pensamiento adaptativo (por defecto en este modelo; `disabled` da 400).
 * - Esfuerzo explícito: chat en `low` (rápido para conversar), resumen diario
 *   en `medium` (corre en el cron, importa más la calidad que la velocidad).
 * - Fallback del lado del servidor ("default"): si el modelo declina por una
 *   categoría de seguridad, la API reintenta sola con otro modelo.
 * - Prompt caching: la parte fija del system prompt va con cache_control.
 */
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function anthropicClient(env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Falta el secreto ANTHROPIC_API_KEY en el Worker');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** Chat en streaming: devuelve el Response SSE crudo para pasarlo tal cual a la app. */
export function streamChat(env, { system, messages }) {
  return anthropicClient(env).beta.messages.create({
    model: MODEL,
    max_tokens: 8000, // el pensamiento cuenta dentro de max_tokens
    output_config: { effort: 'low' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system,
    messages,
    stream: true,
  }).asResponse();
}

/** Llamada no-streaming que devuelve el texto final (ignora bloques de pensamiento). */
export async function completeText(env, { system, messages, effort = 'medium', maxTokens = 8000 }) {
  const response = await anthropicClient(env).beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system,
    messages,
  });
  if (response.stop_reason === 'refusal') {
    const cat = response.stop_details?.category || 'sin categoría';
    throw new Error(`Claude declinó la solicitud (${cat})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('La respuesta se cortó por max_tokens');
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, usage: response.usage, model: response.model };
}

// ─────────────────────────────────────────────────────────────
// Plan B · Leer una captura de Garmin Connect (visión + JSON con esquema)
// ─────────────────────────────────────────────────────────────
const nullable = type => ({ anyOf: [{ type }, { type: 'null' }] });
const SCREENSHOT_FIELDS = {
  date: { ...nullable('string'), description: 'Fecha a la que corresponden los datos, YYYY-MM-DD, solo si se ve en la captura' },
  body_battery_wake: { ...nullable('integer'), description: 'Body Battery al despertar (0-100)' },
  sleep_score: { ...nullable('integer'), description: 'Puntuación de sueño (0-100)' },
  sleep_minutes: { ...nullable('integer'), description: 'Duración total del sueño en minutos' },
  stress_avg: { ...nullable('integer'), description: 'Estrés promedio del día (0-100)' },
  resting_hr: { ...nullable('integer'), description: 'Frecuencia cardíaca en reposo (lpm)' },
  hrv_last_night_ms: { ...nullable('integer'), description: 'Promedio de VFC de la noche (ms)' },
  hrv_status: { anyOf: [{ type: 'string', enum: ['balanced', 'unbalanced', 'low', 'poor', 'none'] }, { type: 'null' }], description: 'Estado de VFC' },
  training_readiness: { ...nullable('integer'), description: 'Disposición para entrenar / Training Readiness (1-100)' },
  vo2max: { ...nullable('number'), description: 'VO2 máx' },
};
const SCREENSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(SCREENSHOT_FIELDS), 'notes'],
  properties: { ...SCREENSHOT_FIELDS, notes: { type: 'string', description: 'Una frase en español: qué pantalla es y qué no se pudo leer' } },
};

export async function extractScreenshot(env, { base64, mediaType, today }) {
  const response = await anthropicClient(env).beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCREENSHOT_SCHEMA } },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: `Es una captura de la app Garmin Connect (puede estar en español o en inglés). Extrae solo los valores que se leen con claridad en la imagen. Si un valor no aparece o no se lee bien, usa null: nunca lo estimes ni lo calcules. Convierte horas a minutos (7 h 42 min = 462). Hoy es ${today}; si la captura dice "Hoy"/"Today", la fecha es ${today}.` },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude no pudo leer la captura');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}
