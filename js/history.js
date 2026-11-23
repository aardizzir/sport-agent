// ANATA · Pantalla Historial (Fase 3, básica)
// Lista por día: color, decisión y una frase. Al tocar un día se ve su resumen
// completo, la decisión y un enlace a la conversación de ese día.
import { supabaseClient } from './supabase.js';
import { state } from './state.js';
import { escapeHtml, localDate, relativeDayLabel } from './utils.js';
import { STATUS } from './metrics.js';

function stripMd(t) { return (t || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim(); }

export async function loadHistory() {
  const container = document.getElementById('history-content');
  if (!container || !state.currentUser) return;
  container.innerHTML = `<div class="card card-skeleton"></div><div class="card card-skeleton"></div>`;

  const uid = state.currentUser.id;
  const [sRes, vRes, cRes] = await Promise.all([
    supabaseClient.from('daily_summaries').select('date, headline, lines, color, status').eq('user_id', uid).order('date', { ascending: false }).limit(60),
    supabaseClient.from('verdicts').select('raw_json, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(100),
    supabaseClient.from('conversations').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(100),
  ]);
  if (sRes.error && vRes.error) {
    container.innerHTML = `<article class="card"><h2 class="card-title">No pude cargar tu historial</h2><p class="card-text">Revisa tu conexión e inténtalo de nuevo.</p></article>`;
    return;
  }

  // Unir por día (hora de Santiago). Para el veredicto, el último del día.
  const days = new Map();
  const day = d => { if (!days.has(d)) days.set(d, { date: d }); return days.get(d); };
  for (const s of sRes.data || []) day(s.date).summary = s;
  for (const v of vRes.data || []) { const d = day(localDate(new Date(v.created_at))); if (!d.verdict) d.verdict = v.raw_json || {}; }
  for (const c of cRes.data || []) { const d = localDate(new Date(c.created_at || c.updated_at)); if (days.has(d) && !days.get(d).conversationId) days.get(d).conversationId = c.id; }

  const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = `<p class="screen-intro">Todavía no hay días guardados. Mañana a las 6:30 aparece el primero.</p>`;
    return;
  }

  const card = document.createElement('div');
  card.className = 'card history-list';
  for (const d of list) {
    const color = d.verdict?.status || d.summary?.color || null;
    const st = STATUS[color];
    const decision = d.verdict ? (STATUS[d.verdict.status]?.label || 'Decisión') : d.summary?.status === 'no_data' ? 'Sin datos de la banda' : 'Sin check-in';
    const phrase = stripMd(d.summary?.headline || d.verdict?.title || '');
    const row = document.createElement('div');
    row.className = 'history-day';
    row.innerHTML = `
      <button class="history-row" aria-expanded="false">
        <span class="history-dot ${st ? st.cls : 'st-none'}"></span>
        <span class="history-main">
          <span class="history-date">${escapeHtml(relativeDayLabel(d.date))}</span>
          <span class="history-phrase">${escapeHtml(decision)}${phrase ? ` · ${escapeHtml(phrase)}` : ''}</span>
        </span>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="history-detail" hidden>
        ${d.summary?.lines?.length ? `<h3 class="card-subtitle">Tu cuerpo ese día</h3><ul class="summary-lines">${d.summary.lines.map(l => `<li><span class="line-dot ${st ? st.cls : ''}"></span><span>${escapeHtml(l)}</span></li>`).join('')}</ul>` : ''}
        ${d.verdict ? `<h3 class="card-subtitle">La decisión</h3><p class="card-text"><strong>${escapeHtml(d.verdict.title || decision)}.</strong> ${escapeHtml(stripMd(d.verdict.reasoning || ''))}</p>` : ''}
        ${d.conversationId ? `<button class="btn-secondary" data-conv="${d.conversationId}">Ver la conversación</button>` : ''}
      </div>`;
    const btn = row.querySelector('.history-row');
    const detail = row.querySelector('.history-detail');
    btn.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      btn.setAttribute('aria-expanded', String(!detail.hidden));
      row.classList.toggle('open', !detail.hidden);
    });
    row.querySelector('[data-conv]')?.addEventListener('click', e => {
      const convId = e.currentTarget.dataset.conv;
      const isToday = d.date === localDate();
      state.viewingHistorical = false;
      window.switchTab?.('hoy');
      if (!isToday) window.loadConversation?.(convId, true);
    });
    card.appendChild(row);
  }
  container.appendChild(card);
}

export function initHistory() {}
