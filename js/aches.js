// ANATA · Molestias (Fase 4): registro rápido por zona, lado e intensidad.
// Regla: con 7/10 o más, ANATA deriva al kinesiólogo y no da plan para esa zona.
import { supabaseClient, WORKER_URL } from './supabase.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { openSheet, closeSheet } from './sheet.js';

export const ZONES = ['Tobillo', 'Rodilla', 'Cadera', 'Isquiotibial', 'Cuádriceps', 'Lumbar', 'Hombro', 'Cuello', 'Otra'];
const SIDES = ['Izquierda', 'Derecha', 'Ambos'];
const NO_SIDE = ['Lumbar', 'Cuello', 'Otra'];
const MASC = ['Tobillo', 'Hombro', 'Isquiotibial', 'Cuádriceps', 'Cuello'];
export const DERIVATION = 'Esa molestia no es normal. Ve al kinesiólogo antes de seguir.';

/** Nombre normalizado para la tabla aches (minúsculas, igual que usa el agente). */
export function zoneName(sel) {
  if (!sel.zone) return '';
  const z = sel.zone.toLowerCase();
  if (NO_SIDE.includes(sel.zone) || !sel.side) return z;
  if (sel.side === 'Ambos') return `${z} (ambos lados)`;
  const masc = MASC.includes(sel.zone);
  return `${z} ${sel.side === 'Izquierda' ? (masc ? 'izquierdo' : 'izquierda') : (masc ? 'derecho' : 'derecha')}`;
}

/**
 * Selector de molestia. `sel` = { zone, side, intensity }. Llama a onChange tras cada toque.
 * Devuelve el HTML; `bindAchePicker` conecta los botones.
 */
export function achePickerHTML(sel) {
  return `
    <p class="card-label">¿Dónde?</p>
    <div class="chip-row wrap">${ZONES.map(z => `<button type="button" class="chip ${sel.zone === z ? 'on' : ''}" data-zone="${z}">${z}</button>`).join('')}</div>
    ${sel.zone && !NO_SIDE.includes(sel.zone) ? `
      <p class="card-label">¿Qué lado?</p>
      <div class="chip-row">${SIDES.map(s => `<button type="button" class="chip ${sel.side === s ? 'on' : ''}" data-side="${s}">${s}</button>`).join('')}</div>` : ''}
    <p class="card-label">¿Cuánto te molesta? (1 a 10)</p>
    <div class="pain-row">${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button type="button" class="pain-btn ${sel.intensity === n ? 'on' : ''} ${n >= 7 ? 'high' : ''}" data-pain="${n}" aria-label="${n} de 10">${n}</button>`).join('')}</div>
    ${sel.intensity >= 7 ? `<p class="card-warning">Con ${sel.intensity}/10 te voy a pedir que veas al kinesiólogo antes de entrenar esa zona.</p>` : ''}`;
}

export function bindAchePicker(root, sel, onChange) {
  root.querySelectorAll('[data-zone]').forEach(b => b.onclick = () => { sel.zone = b.dataset.zone; sel.side = null; onChange(); });
  root.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { sel.side = b.dataset.side; onChange(); });
  root.querySelectorAll('[data-pain]').forEach(b => b.onclick = () => { sel.intensity = Number(b.dataset.pain); onChange(); });
}

export function acheReady(sel) {
  return !!(sel.zone && sel.intensity && (NO_SIDE.includes(sel.zone) || sel.side));
}

/** Guarda la molestia en `aches`. Con 7+ rehace el resumen (la regla lo pone en Descansa). */
export async function saveAche(sel, description = null) {
  const { error } = await supabaseClient.from('aches').insert({
    user_id: state.currentUser.id,
    conversation_id: state.currentConversationId || null,
    body_zone: zoneName(sel),
    intensity: sel.intensity,
    description,
  });
  if (error) throw new Error(error.message);
  if (sel.intensity >= 7) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    fetch(`${WORKER_URL}/today/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } })
      .then(() => window.__reloadToday?.())
      .catch(e => console.warn('refresh tras molestia:', e));
  }
}

/** Hoja "Registrar molestia" (desde Cuerpo). */
export function openAcheSheet() {
  const sel = { zone: null, side: null, intensity: null };
  const el = document.createElement('div');
  const render = () => {
    el.innerHTML = `
      ${achePickerHTML(sel)}
      <button class="btn-primary" data-save ${acheReady(sel) ? '' : 'disabled'}>Registrar</button>
      <p class="form-error" aria-live="polite"></p>`;
    bindAchePicker(el, sel, render);
    el.querySelector('[data-save]').onclick = async () => {
      const btn = el.querySelector('[data-save]');
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        await saveAche(sel);
        el.innerHTML = sel.intensity >= 7
          ? `<p class="card-text"><strong>${escapeHtml(DERIVATION)}</strong></p><p class="card-text">Hoy no te doy plan para esa zona. Ya actualicé tu resumen.</p><button class="btn-primary" data-ok>Entendido</button>`
          : `<p class="card-text">Listo, quedó registrada. La tengo en cuenta en tu decisión de hoy y en las próximas.</p><button class="btn-primary" data-ok>Listo</button>`;
        el.querySelector('[data-ok]').onclick = () => { closeSheet(); window.__reloadBody?.(); };
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Reintentar';
        el.querySelector('.form-error').textContent = `No se pudo guardar: ${e.message}`;
      }
    };
  };
  render();
  openSheet('Registrar molestia', el);
}

window.openAcheSheet = openAcheSheet;
