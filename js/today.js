// ANATA · Pantalla Hoy (Fases 3 y 4)
// Orden: tarjeta "Tu cuerpo hoy" → check-in de 1 toque → tarjeta de decisión → chat.
import { supabaseClient, WORKER_URL } from './supabase.js';
import { state } from './state.js';
import { escapeHtml, formatText, localDate } from './utils.js';
import { STATUS } from './metrics.js';
import { achePickerHTML, bindAchePicker, acheReady, saveAche, zoneName } from './aches.js';
import './capture.js';

// Textos fijos de la app (doc, sección Branding).
export const TEXT = {
  noData: 'Tu banda aún no sincroniza lo de anoche. Abre Garmin Connect un momento o sube una captura.',
  firstDay: 'Hola, Agus. Voy a leer tu cuerpo cada mañana y te lo voy a contar simple. Los primeros días estoy aprendiendo cómo eres tú.',
  rest: 'Descansar también es entrenar. Hoy tu cuerpo construye lo de ayer.',
};

const FEELINGS = [
  { v: 1, label: 'Muy mal' }, { v: 2, label: 'Mal' }, { v: 3, label: 'Normal' }, { v: 4, label: 'Bien' }, { v: 5, label: 'Muy bien' },
];

const checkin = { feeling: null, ache: null, zone: null, side: null, intensity: null, sent: false };

function panel() { return document.getElementById('today-panel'); }

async function authToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}

// ─────────────────────────────────────────────────────────────
// Carga
// ─────────────────────────────────────────────────────────────
export async function fetchToday() {
  const token = await authToken();
  const res = await fetch(`${WORKER_URL}/today`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  const data = await res.json();
  state.today = data;
  return data;
}

export async function todayVerdict() {
  if (!state.currentUser) return null;
  // Veredictos de las últimas 36 h; nos quedamos con el último de HOY (hora de Santiago).
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data } = await supabaseClient.from('verdicts')
    .select('id, raw_json, created_at').eq('user_id', state.currentUser.id)
    .gte('created_at', since).order('created_at', { ascending: false });
  return (data || []).find(v => localDate(new Date(v.created_at)) === localDate()) || null;
}

export async function loadTodayPanel() {
  const el = panel();
  if (!el) return;
  el.innerHTML = `<div class="card card-skeleton" aria-busy="true"></div>`;
  let data = null, verdict = null, error = null;
  try {
    [data, verdict] = await Promise.all([fetchToday(), todayVerdict()]);
  } catch (e) {
    error = e;
  }
  el.innerHTML = '';
  el.appendChild(error ? errorCard() : summaryCard(data));
  const slot = document.createElement('div');
  slot.id = 'decision-slot';
  el.appendChild(slot);
  state.effortToday = data?.effort_today ?? null;
  if (verdict) {
    checkin.sent = true;
    renderDecision(verdict.raw_json);
  } else {
    el.insertBefore(checkinCard(), slot);
  }
}

// ─────────────────────────────────────────────────────────────
// Tarjeta "Tu cuerpo hoy"
// ─────────────────────────────────────────────────────────────
function pill(color) {
  const s = STATUS[color];
  return s ? `<span class="status-pill ${s.cls}">${s.label}</span>` : '';
}

function summaryCard(data) {
  const card = document.createElement('article');
  card.className = 'card body-today';
  const s = data?.summary;
  const firstDay = (data?.history?.days_with_data || 0) <= 1;

  let inner;
  if (s && s.status === 'ok') {
    const dotCls = STATUS[s.color]?.cls || '';
    inner = `
      <div class="card-top">
        <span class="card-kicker" data-small-ok>Tu cuerpo hoy</span>
        ${pill(s.color)}
      </div>
      <h2 class="card-title">${escapeHtml(s.headline)}</h2>
      <ul class="summary-lines">
        ${(s.lines || []).map(l => `<li><span class="line-dot ${dotCls}"></span><span>${escapeHtml(l)}</span></li>`).join('')}
      </ul>
      <button class="link-btn" onclick="openCapture()">¿Falta un dato? Súbelo con una captura</button>`;
  } else if (s && s.status === 'no_data') {
    inner = `
      <div class="card-top"><span class="card-kicker" data-small-ok>Tu cuerpo hoy</span></div>
      <h2 class="card-title">Esperando tu banda</h2>
      <p class="card-text">${escapeHtml(TEXT.noData)}</p>
      <button class="btn-primary" onclick="openCapture()">Subir una captura</button>
      <button class="btn-secondary" onclick="openManual()">Llenar a mano</button>`;
  } else {
    const hasData = !!data?.has_data_today;
    inner = `
      <div class="card-top"><span class="card-kicker" data-small-ok>Tu cuerpo hoy</span></div>
      <h2 class="card-title">${hasData ? 'Tu resumen está en camino' : 'Esperando tu banda'}</h2>
      <p class="card-text">${hasData ? 'Ya llegaron tus datos. El resumen se arma cada mañana a las 6:30.' : escapeHtml(TEXT.noData)}</p>
      ${hasData ? '' : `<button class="btn-primary" onclick="openCapture()">Subir una captura</button>
      <button class="btn-secondary" onclick="openManual()">Llenar a mano</button>`}`;
  }
  card.innerHTML = `
    ${firstDay ? `<p class="card-text first-day">${escapeHtml(TEXT.firstDay)}</p>` : ''}
    ${inner}`;
  return card;
}

function errorCard() {
  const card = document.createElement('article');
  card.className = 'card body-today';
  card.innerHTML = `
    <div class="card-top"><span class="card-kicker" data-small-ok>Tu cuerpo hoy</span></div>
    <h2 class="card-title">No pude cargar tu resumen</h2>
    <p class="card-text">Revisa tu conexión e inténtalo de nuevo.</p>
    <button class="btn-secondary" id="retry-today">Reintentar</button>`;
  card.querySelector('#retry-today').addEventListener('click', loadTodayPanel);
  return card;
}

// ─────────────────────────────────────────────────────────────
// Check-in de 1 toque
// ─────────────────────────────────────────────────────────────
function checkinCard() {
  const card = document.createElement('article');
  card.className = 'card checkin';
  card.id = 'checkin-card';
  const render = () => {
    const showAche = checkin.ache === true;
    const ready = checkin.feeling && (checkin.ache === false || (showAche && acheReady(checkin)));
    card.innerHTML = `
      <h3 class="card-subtitle">¿Cómo te sientes?</h3>
      <div class="scale-row" role="group" aria-label="Cómo te sientes, del 1 al 5">
        ${FEELINGS.map(f => `<button class="scale-btn ${checkin.feeling === f.v ? 'on' : ''}" data-feel="${f.v}" aria-pressed="${checkin.feeling === f.v}"><span class="scale-num">${f.v}</span><span class="scale-word" data-small-ok>${f.label}</span></button>`).join('')}
      </div>
      <h3 class="card-subtitle">¿Alguna molestia?</h3>
      <div class="chip-row">
        <button class="chip ${checkin.ache === false ? 'on' : ''}" data-ache="no">No</button>
        <button class="chip ${checkin.ache === true ? 'on' : ''}" data-ache="si">Sí</button>
      </div>
      ${showAche ? achePickerHTML(checkin) : ''}
      <button class="btn-primary" id="checkin-send" ${ready ? '' : 'disabled'}>Ver mi decisión de hoy</button>`;
    card.querySelectorAll('[data-feel]').forEach(b => b.onclick = () => { checkin.feeling = Number(b.dataset.feel); render(); });
    card.querySelectorAll('[data-ache]').forEach(b => b.onclick = () => { checkin.ache = b.dataset.ache === 'si'; render(); });
    bindAchePicker(card, checkin, render);
    card.querySelector('#checkin-send').onclick = sendCheckin;
  };
  render();
  return card;
}

async function sendCheckin() {
  if (checkin.sent || state.isStreaming) return;
  checkin.sent = true;
  const f = FEELINGS.find(x => x.v === checkin.feeling);
  // La molestia se guarda directo en `aches` (no depende de que el agente la marque).
  let acheSaved = false;
  if (checkin.ache) {
    try { await saveAche(checkin, 'check-in de la mañana'); acheSaved = true; }
    catch (e) { console.warn('molestia no guardada:', e.message); }
  }
  const ache = checkin.ache
    ? `Tengo una molestia en ${zoneName(checkin)}, ${checkin.intensity}/10${acheSaved ? ' (ya quedó registrada)' : ''}.`
    : 'No tengo molestias.';
  const message = `Check-in de hoy: me siento ${f.label.toLowerCase()} (${f.v}/5). ${ache} ¿Qué hago hoy?`;

  // Guardar la sensación en la fila de hoy (si ya llegó de Garmin).
  supabaseClient.from('garmin_daily').update({ feeling: checkin.feeling })
    .eq('user_id', state.currentUser.id).eq('date', localDate())
    .then(({ error }) => { if (error) console.warn('feeling no guardado:', error.message); });

  const card = document.getElementById('checkin-card');
  if (card) card.innerHTML = `<p class="card-text">Listo. Estoy pensando tu decisión de hoy…</p>`;
  if (typeof window.__sendToAgent === 'function') await window.__sendToAgent(message);
}

// ─────────────────────────────────────────────────────────────
// Tarjeta de decisión
// ─────────────────────────────────────────────────────────────
export function renderDecision(data) {
  const slot = document.getElementById('decision-slot');
  if (!slot || !data) return;
  document.getElementById('checkin-card')?.remove();
  const s = STATUS[data.status] || STATUS.caution;
  const intensity = Math.max(0, Math.min(100, Number(data.intensity_percent) || 0));
  const doItems = (data.do_items || []).slice(0, 2);
  const avoidItems = (data.avoid_items || []).slice(0, 2);
  slot.innerHTML = `
    <article class="card decision ${s.cls}">
      <div class="card-top">
        <span class="card-kicker" data-small-ok>Tu decisión de hoy</span>
        <span class="status-pill ${s.cls}">${s.label}</span>
      </div>
      <h2 class="card-title">${escapeHtml(data.title || s.label)}</h2>
      <div class="decision-intensity">
        <span class="big-number">${intensity}<span class="big-unit">%</span></span>
        <span class="card-label">intensidad sugerida</span>
      </div>
      ${data.reasoning ? `<p class="card-text">${formatText(escapeHtml(data.reasoning))}</p>` : ''}
      ${data.status === 'stop' ? `<p class="card-text rest-text">${escapeHtml(TEXT.rest)}</p>` : ''}
      ${doItems.length ? `<h3 class="card-subtitle">Haz</h3><ul class="decision-list do">${doItems.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
      ${avoidItems.length ? `<h3 class="card-subtitle">Evita</h3><ul class="decision-list avoid">${avoidItems.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
      ${data.warning ? `<p class="card-note">${escapeHtml(data.warning)}</p>` : ''}
      ${data.micro_tip ? `<p class="card-tip"><strong>Tip:</strong> ${escapeHtml(data.micro_tip)}</p>` : ''}
    </article>`;
  if (data.status !== 'stop' || state.effortToday) slot.appendChild(effortCard());
}

// ─────────────────────────────────────────────────────────────
// Después de entrenar (opcional): "¿Qué tan duro fue? 1-10" → daily_states
// ─────────────────────────────────────────────────────────────
const EFFORT_WORDS = { 1: 'Muy suave', 3: 'Suave', 5: 'Moderado', 7: 'Duro', 9: 'Muy duro', 10: 'Al límite' };

function effortCard() {
  const card = document.createElement('article');
  card.className = 'card effort';
  const render = (saving = false, error = '') => {
    const v = state.effortToday;
    card.innerHTML = v && !saving && !error
      ? `<h3 class="card-subtitle">Después de entrenar</h3>
         <p class="card-text">Hoy fue un <strong>${v}/10</strong>${EFFORT_WORDS[v] ? ` (${EFFORT_WORDS[v].toLowerCase()})` : ''}. Mañana lo tengo en cuenta.</p>
         <button class="link-btn" data-change>Cambiar</button>`
      : `<h3 class="card-subtitle">Después de entrenar <span class="card-label inline">(opcional)</span></h3>
         <p class="card-text">¿Qué tan duro fue? 1 es muy suave, 10 al límite.</p>
         <div class="pain-row">${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button type="button" class="pain-btn ${v === n ? 'on' : ''}" data-rpe="${n}" aria-label="${n} de 10" ${saving ? 'disabled' : ''}>${n}</button>`).join('')}</div>
         ${error ? `<p class="card-warning">${escapeHtml(error)}</p>` : ''}`;
    card.querySelector('[data-change]')?.addEventListener('click', () => { state.effortToday = null; render(); state.effortToday = v; });
    card.querySelectorAll('[data-rpe]').forEach(b => b.onclick = () => saveEffort(Number(b.dataset.rpe)));
  };
  const saveEffort = async rpe => {
    render(true);
    try {
      const token = await authToken();
      const res = await fetch(`${WORKER_URL}/today/effort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rpe }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
      state.effortToday = rpe;
      render();
    } catch (e) {
      render(false, `No se pudo guardar: ${e.message}`);
    }
  };
  render();
  return card;
}

window.__reloadToday = () => loadTodayPanel();

// Enlaza el veredicto recién guardado con el resumen del día (daily_summaries.verdict_id).
export async function linkVerdictToSummary(verdictId) {
  if (!verdictId || !state.currentUser) return;
  const { error } = await supabaseClient.from('daily_summaries')
    .update({ verdict_id: verdictId }).eq('user_id', state.currentUser.id).eq('date', localDate());
  if (error) console.warn('No se pudo enlazar el veredicto al resumen:', error.message);
}
