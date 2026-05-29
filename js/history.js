import { supabaseClient } from './supabase.js';
import { state } from './state.js';

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getDotClass(verdict) {
  const status = verdict.raw_json?.status || '';
  const level = (verdict.load_level || '').toLowerCase();
  if (status === 'go' || level.includes('verde') || level.includes('listo')) return 'dot-verde';
  if (status === 'caution' || level.includes('amarillo') || level.includes('precauc') || level.includes('cuidado')) return 'dot-ambar';
  if (status === 'stop' || level.includes('rojo') || level.includes('descanso') || level.includes('parar')) return 'dot-rojo';
  return 'dot-neutral';
}

function groupByDate(verdicts) {
  const groups = {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  for (const v of verdicts) {
    const d = new Date(v.created_at); d.setHours(0, 0, 0, 0);
    let key;
    if (d.getTime() === today.getTime()) key = 'Hoy';
    else if (d.getTime() === yesterday.getTime()) key = 'Ayer';
    else {
      const diff = Math.round((today - d) / 86400000);
      key = diff < 7 ? `Hace ${diff} días` : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  }
  return groups;
}

function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function renderSkeletons(container) {
  container.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('div');
    s.className = 'skeleton-card';
    container.appendChild(s);
  }
}

export async function loadHistory() {
  const container = document.getElementById('history-content');
  if (!container || !state.currentUser) return;

  renderSkeletons(container);

  try {
    const { data: verdicts, error } = await supabaseClient
      .from('verdicts')
      .select('*')
      .eq('user_id', state.currentUser.id)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    container.innerHTML = '';

    if (!verdicts || verdicts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Todavía no hay veredictos.</p>
          <p>Hablá con ANATA para empezar.</p>
        </div>`;
      return;
    }

    const groups = groupByDate(verdicts);
    for (const [label, items] of Object.entries(groups)) {
      const group = document.createElement('div');
      group.innerHTML = `<div class="group-date">${label}</div>`;
      for (const v of items) {
        const card = document.createElement('div');
        card.className = 'verdict-card';
        const statusLabel = stripMarkdown(v.load_level || '—');
        const text = stripMarkdown(v.recommendation || '—');
        card.innerHTML = `
          <div class="verdict-status-dot ${getDotClass(v)}"></div>
          <div class="verdict-body">
            <div class="verdict-status-label">${statusLabel}</div>
            <div class="verdict-text">${text}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
            <div class="verdict-time">${fmtTime(v.created_at)}</div>
            <span class="verdict-arrow">›</span>
          </div>`;
        card.addEventListener('click', () => {
          if (typeof window.switchTab === 'function') window.switchTab('hoy');
        });
        group.appendChild(card);
      }
      container.appendChild(group);
    }
  } catch (err) {
    const c = document.getElementById('history-content');
    if (c) c.innerHTML = `<p class="screen-error">Error al cargar historial: ${err.message}</p>`;
  }
}

export function initHistory() {}
