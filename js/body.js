// ANATA · Pantalla Cuerpo (Fase 3)
// Una tarjeta por métrica: nombre simple, nombre Garmin pequeño, número grande,
// una línea de traducción, mini línea de 7 días e insignia "calibrando".
// Al tocarla se abre la explicación del traductor. Abajo, las molestias activas.
import { supabaseClient } from './supabase.js';
import { state } from './state.js';
import { escapeHtml, localDate, addDays } from './utils.js';
import { METRICS, MUTED, calibrationBadge } from './metrics.js';
import { fetchToday } from './today.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// Mini línea de 7 días (SVG en salvia). Los días sin dato quedan como hueco.
function sparkline(values) {
  const W = 120, H = 36, P = 3;
  const nums = values.filter(isNum);
  if (nums.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>`;
  const lastI = values.map(isNum).lastIndexOf(true);
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const x = i => P + (i * (W - 2 * P)) / (values.length - 1);
  const y = v => H - P - ((v - min) / span) * (H - 2 * P);
  let d = '', pen = false;
  values.forEach((v, i) => {
    if (!isNum(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${d.trim()}" fill="none" stroke="var(--anata-sage)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${values.map((v, i) => (isNum(v) && i !== lastI ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.8" fill="var(--anata-sage)"/>` : '')).join('')}
    <circle cx="${x(lastI).toFixed(1)}" cy="${y(values[lastI]).toFixed(1)}" r="2.5" fill="var(--anata-dark)"/>
  </svg>`;
}

function last7Values(data, col, useYesterday) {
  const end = useYesterday ? addDays(data.date, -1) : data.date;
  const byDate = Object.fromEntries((data.last7 || []).map(r => [r.date, r]));
  return Array.from({ length: 7 }, (_, i) => byDate[addDays(end, i - 6)]?.[col] ?? null);
}

function metricCard(m, data) {
  const row = m.useYesterday ? (data.last7 || []).find(r => r.date === addDays(data.date, -1)) : data.today;
  const value = row?.[m.col] ?? null;
  const normal = data.averages_7d?.[m.col] ?? null;
  const badge = m.calibKey ? calibrationBadge(data.calibration, m.calibKey) : null;
  const card = document.createElement('article');
  card.className = 'card metric-card';
  card.innerHTML = `
    <button class="metric-head" aria-expanded="false">
      <div class="metric-names">
        <span class="metric-name">${m.name}</span>
        <span class="metric-garmin" data-small-ok>${m.garmin}</span>
      </div>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="metric-row">
      <span class="big-number">${m.format(value)}${isNum(value) && m.unit ? `<span class="big-unit">${m.unit}</span>` : ''}</span>
      ${sparkline(last7Values(data, m.col, m.useYesterday))}
    </div>
    <p class="metric-line">${escapeHtml(m.line(value, normal, row))}</p>
    ${badge ? `<span class="badge-calib" data-small-ok>${escapeHtml(badge)}</span>` : ''}
    <div class="metric-explain" hidden>
      <p><strong>Qué es.</strong> ${escapeHtml(m.what)}</p>
      <p><strong>Rangos.</strong> ${escapeHtml(m.ranges)}</p>
      <p><strong>Cómo leerlo.</strong> ${escapeHtml(m.read)}</p>
    </div>`;
  const head = card.querySelector('.metric-head');
  const explain = card.querySelector('.metric-explain');
  const toggle = () => {
    const open = explain.hidden;
    explain.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    card.classList.toggle('open', open);
  };
  head.addEventListener('click', toggle);
  card.querySelector('.metric-row').addEventListener('click', toggle);
  return card;
}

function mutedCard(m) {
  const card = document.createElement('article');
  card.className = 'card metric-card muted';
  card.innerHTML = `
    <div class="metric-names">
      <span class="metric-name">${m.name}</span>
      <span class="metric-garmin" data-small-ok>${m.garmin}</span>
    </div>
    <p class="metric-line">${escapeHtml(m.note)}</p>`;
  return card;
}

function relDay(iso) {
  const d = localDate(new Date(iso));
  const today = localDate();
  if (d === today) return 'hoy';
  if (d === addDays(today, -1)) return 'ayer';
  const n = Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
  return `hace ${n} días`;
}

async function achesSection() {
  const wrap = document.createElement('section');
  wrap.className = 'aches';
  wrap.innerHTML = `<h2 class="section-title">Tus molestias</h2>`;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await supabaseClient.from('aches')
    .select('body_zone, intensity, description, reported_at')
    .eq('user_id', state.currentUser.id).gte('reported_at', since)
    .order('reported_at', { ascending: false }).limit(10);
  if (error || !data?.length) {
    wrap.insertAdjacentHTML('beforeend', `<p class="card-text muted-text">Sin molestias en los últimos 30 días.</p>`);
    return wrap;
  }
  // Una línea por zona (la más reciente), con cuántas veces apareció.
  const byZone = new Map();
  for (const a of data) {
    const k = (a.body_zone || '').toLowerCase();
    if (!byZone.has(k)) byZone.set(k, { ...a, count: 0 });
    byZone.get(k).count++;
  }
  const list = document.createElement('div');
  list.className = 'card ache-list';
  list.innerHTML = [...byZone.values()].map(a => {
    const high = isNum(a.intensity) && a.intensity >= 7;
    return `
      <div class="ache-row">
        <span class="ache-dot ${high ? 'high' : ''}"></span>
        <div class="ache-text">
          <span class="ache-zone">${escapeHtml(a.body_zone.charAt(0).toUpperCase() + a.body_zone.slice(1))}${isNum(a.intensity) ? ` · ${a.intensity}/10` : ''}</span>
          <span class="ache-meta">${relDay(a.reported_at)}${a.count > 1 ? ` · ${a.count} veces en 30 días` : ''}</span>
          ${high ? `<span class="ache-warn">Esa molestia no es normal. Ve al kinesiólogo antes de seguir.</span>` : ''}
        </div>
      </div>`;
  }).join('');
  wrap.appendChild(list);
  return wrap;
}

export async function loadCuerpo() {
  const container = document.getElementById('body-content');
  if (!container || !state.currentUser) return;
  container.innerHTML = `<div class="card card-skeleton"></div><div class="card card-skeleton"></div>`;

  let data = state.today;
  try {
    if (!data || data.date !== localDate()) data = await fetchToday();
  } catch (e) {
    container.innerHTML = `<article class="card"><h2 class="card-title">No pude cargar tus métricas</h2><p class="card-text">Revisa tu conexión e inténtalo de nuevo.</p></article>`;
    return;
  }

  container.innerHTML = '';
  const intro = document.createElement('p');
  intro.className = 'screen-intro';
  const nd = data.calibration?.details?.normal_7d;
  intro.textContent = nd
    ? `Comparo cada número con tu normal. Todavía lo estoy aprendiendo: día ${nd.day} de 7. Toca una métrica para entenderla.`
    : 'Comparo cada número con tu normal de los últimos 7 días. Toca una métrica para entenderla.';
  container.appendChild(intro);

  for (const m of METRICS) container.appendChild(metricCard(m, data));
  for (const m of MUTED) container.appendChild(mutedCard(m));
  container.appendChild(await achesSection());
}
