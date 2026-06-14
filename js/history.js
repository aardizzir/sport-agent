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

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Mapa status -> display (label + clase del dot), consistente con Cuerpo.
function statusLabel(status) {
  if (status === 'go') return 'Listo';
  if (status === 'caution') return 'Precaución';
  if (status === 'stop') return 'Descanso';
  return 'Sin datos';
}

function getDotClass(status) {
  if (status === 'go') return 'dot-verde';
  if (status === 'caution') return 'dot-ambar';
  if (status === 'stop') return 'dot-rojo';
  return 'dot-neutral';
}

// Agrupa: Hoy / Ayer / Esta semana (≤7 días) / DD/MM/YYYY (más antiguo).
function groupByDate(verdicts) {
  const groups = {};
  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const v of verdicts) {
    const d = new Date(v.created_at); d.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    let key;
    if (diff <= 0) key = 'Hoy';
    else if (diff === 1) key = 'Ayer';
    else if (diff < 7) key = 'Esta semana';
    else key = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
      .select('id, raw_json, recommendation, load_level, created_at, conversation_id')
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
        const status = v.raw_json?.status || null;
        const card = document.createElement('div');
        card.className = 'verdict-card';
        // Texto completo del veredicto, sin truncar y sin markdown.
        const text = escapeHtml(stripMarkdown(v.raw_json?.reasoning || v.recommendation || '—'));
        card.innerHTML = `
          <div class="verdict-status-dot ${getDotClass(status)}"></div>
          <div class="verdict-body">
            <div class="verdict-status-label">${statusLabel(status)}</div>
            <div class="verdict-text">${text}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
            <div class="verdict-time">${fmtTime(v.created_at)}</div>
            <span class="verdict-arrow">›</span>
          </div>`;
        const convId = v.conversation_id;
        card.addEventListener('click', () => {
          if (!convId) return;
          // Bajamos el flag antes de switchTab para que NO dispare returnToToday()
          // en paralelo con loadConversation (evita mezclar mensajes de 2 charlas).
          state.viewingHistorical = false;
          if (typeof window.switchTab === 'function') window.switchTab('hoy');
          if (typeof window.loadConversation === 'function') window.loadConversation(convId, true);
        });
        group.appendChild(card);
      }
      container.appendChild(group);
    }
  } catch (err) {
    const c = document.getElementById('history-content');
    if (c) c.innerHTML = `<p class="screen-error">Error al cargar historial: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

export function initHistory() {}
