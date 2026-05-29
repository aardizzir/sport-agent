import { supabaseClient } from './supabase.js';
import { state } from './state.js';

function statusColor(status) {
  if (status === 'go') return '#5a9e3a';
  if (status === 'caution') return '#c49b20';
  if (status === 'stop') return '#c0392b';
  return '#B0B0B0';
}

function statusDotClass(status) {
  if (status === 'go') return 'dot-verde';
  if (status === 'caution') return 'dot-ambar';
  if (status === 'stop') return 'dot-rojo';
  return 'dot-neutral';
}

function getWeekDots(verdicts) {
  const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const mondayOffset = dow === 0 ? 6 : dow - 1;

  return DAYS.map((label, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - mondayOffset + i);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d); end.setHours(23, 59, 59, 999);
    const verdict = verdicts.find(v => {
      const t = new Date(v.created_at);
      return t >= d && t <= end;
    });
    return { label, verdict, isToday: i === mondayOffset };
  });
}

function relDate(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  return `Hace ${Math.floor(hrs / 24)} días`;
}

export async function loadCuerpo() {
  const container = document.getElementById('body-content');
  if (!container || !state.currentUser) return;

  container.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';

  try {
    const [vRes, aRes] = await Promise.all([
      supabaseClient
        .from('verdicts').select('*')
        .eq('user_id', state.currentUser.id)
        .order('created_at', { ascending: false }).limit(7),
      supabaseClient
        .from('aches').select('*')
        .eq('user_id', state.currentUser.id)
        .order('reported_at', { ascending: false }).limit(10)
    ]);

    const verdicts = vRes.data || [];
    const aches = aRes.data || [];
    const latest = verdicts[0] || null;

    if (!latest && aches.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Hablá con ANATA para empezar.</p>
        </div>`;
      return;
    }

    let html = '';

    if (latest) {
      const status = latest.raw_json?.status || '';
      const color = statusColor(status);
      html += `
        <div class="body-card">
          <div class="body-card-row">
            <div class="body-status-orb" style="background:${color}22;border:2px solid ${color};">
              <div style="width:10px;height:10px;border-radius:50%;background:${color};"></div>
            </div>
            <div style="flex:1;min-width:0;">
              <div class="section-head" style="margin:0 0 2px;padding:0;">Estado actual</div>
              <div style="font-size:13px;font-weight:500;color:var(--anata-black);">${latest.load_level || '—'}</div>
              ${latest.recommendation ? `<div style="font-size:11px;color:var(--anata-gray);margin-top:3px;line-height:1.4;">${latest.recommendation}</div>` : ''}
            </div>
            <div style="font-size:9px;color:var(--anata-gray);flex-shrink:0;padding-left:8px;">${relDate(latest.created_at)}</div>
          </div>
        </div>`;
    }

    const weekDots = getWeekDots(verdicts);
    html += `<div class="body-week">`;
    for (const day of weekDots) {
      const cls = day.verdict ? statusDotClass(day.verdict.raw_json?.status) : 'dot-empty';
      html += `
        <div class="body-day-item">
          <div class="body-day-dot ${cls}${day.isToday ? ' dot-today' : ''}"></div>
          <span class="body-day-label">${day.label}</span>
        </div>`;
    }
    html += `</div>`;

    if (aches.length > 0) {
      html += `<div class="section-head">Molestias</div>`;
      for (const a of aches) {
        html += `
          <div class="verdict-card">
            <div class="verdict-status-dot dot-ambar"></div>
            <div class="verdict-body">
              <div class="verdict-status-label">${a.body_zone || '—'}</div>
              <div class="verdict-text">${a.description || '—'}</div>
            </div>
            ${a.intensity ? `<div class="verdict-time">${a.intensity}/10</div>` : ''}
          </div>`;
      }
    }

    container.innerHTML = html;
  } catch (err) {
    const c = document.getElementById('body-content');
    if (c) c.innerHTML = `<p class="screen-error">Error al cargar datos: ${err.message}</p>`;
  }
}

export function initBody() {}
