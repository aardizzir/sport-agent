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
