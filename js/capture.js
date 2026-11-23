// ANATA · Plan B (captura de pantalla) y Plan C (formulario manual) — Fase 4.
// Plan B: subes una captura de Garmin Connect → Claude la lee → la app te muestra
// lo que leyó para que lo confirmes o corrijas → se guarda con source='screenshot'.
// Plan C: cuatro campos rápidos → se guarda con source='manual'.
import { supabaseClient, WORKER_URL } from './supabase.js';
import { escapeHtml, localDate } from './utils.js';
import { openSheet, closeSheet } from './sheet.js';

// Etiquetas simples (primero lo simple, después el nombre Garmin).
const FIELD_LABELS = {
  body_battery_wake: ['Batería al despertar', 'Body Battery', '0–100'],
  sleep_score: ['Puntuación de sueño', 'Sleep Score', '0–100'],
  sleep_minutes: ['Horas dormidas', 'en minutos', 'min'],
  stress_avg: ['Estrés promedio', 'Stress', '0–100'],
  resting_hr: ['Pulso en reposo', 'Resting HR', 'lpm'],
  hrv_last_night_ms: ['Variabilidad del pulso anoche', 'VFC / HRV', 'ms'],
  training_readiness: ['Disposición para entrenar', 'Training Readiness', '1–100'],
  vo2max: ['Motor aeróbico', 'VO2 máx', ''],
};
const HRV_LABELS = { balanced: 'Equilibrado', unbalanced: 'Desequilibrado', low: 'Bajo', poor: 'Pobre', none: 'Sin estado aún' };

async function authHeaders() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` };
}

async function post(path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Reduce la imagen a máx. 1600 px y JPEG: sube más rápido y Claude la lee igual de bien.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No pude abrir esa imagen')); };
    img.src = url;
  });
}

function afterSave() {
  closeSheet();
  window.__reloadToday?.();
}

function numberField(key, value) {
  const [label, garmin, unit] = FIELD_LABELS[key];
  return `
    <label class="form-field">
      <span class="form-label">${label} <span class="form-hint" data-small-ok>${garmin}${unit ? ` · ${unit}` : ''}</span></span>
      <input class="form-input" type="number" inputmode="decimal" name="${key}" value="${value ?? ''}">
    </label>`;
}

// ─────────────────────────────────────────────────────────────
// Plan B · Captura
// ─────────────────────────────────────────────────────────────
export function openCapture() {
  const el = document.createElement('div');
  el.innerHTML = `
    <p class="card-text">Saca una captura de Garmin Connect (resumen del día, sueño o Disposición para entrenar) y súbela. Te muestro lo que leí antes de guardarlo.</p>
    <label class="btn-primary file-btn">
      Elegir captura
      <input type="file" accept="image/*" hidden>
    </label>
    <button class="btn-secondary" data-manual>Prefiero llenarlo a mano</button>
    <div class="capture-status" aria-live="polite"></div>`;
  el.querySelector('[data-manual]').onclick = openManual;
  const status = el.querySelector('.capture-status');
  el.querySelector('input[type=file]').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    status.innerHTML = `<p class="card-text">Leyendo tu captura…</p>`;
    try {
      const dataUrl = await shrinkImage(file);
      const result = await post('/garmin/screenshot', { image_base64: dataUrl, media_type: 'image/jpeg' });
      renderConfirm(el, result, dataUrl);
    } catch (err) {
      status.innerHTML = `<p class="card-warning">${escapeHtml(err.message)}</p>`;
    }
  };
  openSheet('Subir una captura', el);
}

function renderConfirm(el, result, dataUrl) {
  const fields = result.fields || {};
  const keys = Object.keys(FIELD_LABELS).filter(k => fields[k] !== undefined);
  if (!keys.length && !fields.hrv_status) {
    el.querySelector('.capture-status').innerHTML = `<p class="card-warning">No encontré números de Garmin en esa imagen. ${escapeHtml(result.notes || '')}</p>`;
    return;
  }
  el.innerHTML = `
    <img class="capture-thumb" src="${dataUrl}" alt="Tu captura">
    <p class="card-text">Esto es lo que leí${result.date !== localDate() ? ` (del ${escapeHtml(result.date)})` : ''}. Corrige lo que no esté bien.</p>
    ${result.notes ? `<p class="card-text muted-text">${escapeHtml(result.notes)}</p>` : ''}
    <form class="form">
      ${keys.map(k => numberField(k, fields[k])).join('')}
      ${fields.hrv_status ? `<p class="form-label">Estado de VFC: ${HRV_LABELS[fields.hrv_status] || fields.hrv_status}</p>` : ''}
      <button class="btn-primary" type="submit">Confirmar y guardar</button>
      <p class="form-error" aria-live="polite"></p>
    </form>`;
  el.querySelector('form').onsubmit = async ev => {
    ev.preventDefault();
    const out = {};
    for (const k of keys) out[k] = ev.target.elements[k].value === '' ? null : Number(ev.target.elements[k].value);
    if (fields.hrv_status) out.hrv_status = fields.hrv_status;
    await save(el, { date: result.date, source: 'screenshot', fields: out });
  };
}

async function save(el, payload) {
  const btn = el.querySelector('button[type=submit]');
  const err = el.querySelector('.form-error');
  btn.disabled = true;
  btn.textContent = 'Guardando y actualizando tu resumen…';
  try {
    await post('/garmin/manual', payload);
    afterSave();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Reintentar';
    err.textContent = e.message;
  }
}

// ─────────────────────────────────────────────────────────────
// Plan C · Formulario manual (4 campos)
// ─────────────────────────────────────────────────────────────
export function openManual() {
  const el = document.createElement('div');
  el.innerHTML = `
    <p class="card-text">Cuatro datos rápidos de esta mañana. Los encuentras en Garmin Connect.</p>
    <form class="form">
      ${numberField('body_battery_wake')}
      ${numberField('sleep_score')}
      <div class="form-field">
        <span class="form-label">Horas dormidas</span>
        <div class="form-row">
          <label class="form-inline"><input class="form-input" type="number" inputmode="numeric" name="h" min="0" max="16" aria-label="Horas"> <span>h</span></label>
          <label class="form-inline"><input class="form-input" type="number" inputmode="numeric" name="m" min="0" max="59" aria-label="Minutos"> <span>min</span></label>
        </div>
      </div>
      <div class="form-field">
        <span class="form-label">¿Cómo te sientes? (1 a 5)</span>
        <div class="scale-row">${[1, 2, 3, 4, 5].map(v => `<button type="button" class="scale-btn" data-feel="${v}"><span class="scale-num">${v}</span></button>`).join('')}</div>
      </div>
      <button class="btn-primary" type="submit">Guardar</button>
      <p class="form-error" aria-live="polite"></p>
    </form>`;
  let feeling = null;
  el.querySelectorAll('[data-feel]').forEach(b => b.onclick = () => {
    feeling = Number(b.dataset.feel);
    el.querySelectorAll('[data-feel]').forEach(x => x.classList.toggle('on', x === b));
  });
  el.querySelector('form').onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target.elements;
    const h = f.h.value === '' ? null : Number(f.h.value);
    const m = f.m.value === '' ? null : Number(f.m.value);
    const fields = {
      body_battery_wake: f.body_battery_wake.value === '' ? null : Number(f.body_battery_wake.value),
      sleep_score: f.sleep_score.value === '' ? null : Number(f.sleep_score.value),
      sleep_minutes: h === null && m === null ? null : (h || 0) * 60 + (m || 0),
      feeling,
    };
    if (Object.values(fields).every(v => v === null)) {
      el.querySelector('.form-error').textContent = 'Llena al menos un dato.';
      return;
    }
    await save(el, { date: localDate(), source: 'manual', fields });
  };
  openSheet('Llenar a mano', el);
}

window.openCapture = openCapture;
window.openManual = openManual;
