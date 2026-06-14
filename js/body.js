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

// Mapa status -> display (label + color), según brief Sesión 06.
function statusDisplay(status) {
  if (status === 'go') return { label: 'Listo', color: '#5a9e3a' };
  if (status === 'caution') return { label: 'Precaución', color: '#c49b20' };
  if (status === 'stop') return { label: 'Descanso', color: '#c0392b' };
  return { label: 'Sin datos', color: '#B0B0B0' };
}

function statusDotClass(status) {
  if (status === 'go') return 'dot-verde';
  if (status === 'caution') return 'dot-ambar';
  if (status === 'stop') return 'dot-rojo';
  return 'dot-empty';
}

// Diferencia en días calendario respecto de hoy.
function daysAgo(dateStr) {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - d) / 86400000);
}

// Fecha relativa: Hoy / Ayer / hace N días.
function relDate(dateStr) {
  const n = daysAgo(dateStr);
  if (n <= 0) return 'Hoy';
  if (n === 1) return 'Ayer';
  return `hace ${n} días`;
}

// 7 dots L·M·X·J·V·S·D, de lunes a domingo de la semana actual.
// Agrupa por día y, si hay varios veredictos en un día, usa el último.
function getWeekDots(verdicts) {
  const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const today = new Date();
  const dow = today.getDay();
  const mondayOffset = dow === 0 ? 6 : dow - 1;

  return DAYS.map((label, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - mondayOffset + i);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d); end.setHours(23, 59, 59, 999);
    // verdicts viene ordenado desc; el primero que matchee es el último del día.
    const verdict = verdicts.find(v => {
      const t = new Date(v.created_at);
      return t >= d && t <= end;
    });
    return { label, verdict, isToday: i === mondayOffset };
  });
}

function renderSkeleton(container) {
  container.innerHTML = `
    <div class="body-skeleton" style="height:84px;"></div>
    <div class="body-skeleton" style="height:64px;"></div>
    <div class="body-skeleton" style="height:120px;"></div>`;
}

export async function loadCuerpo() {
  const container = document.getElementById('body-content');
  if (!container || !state.currentUser) return;

  renderSkeleton(container);

  const userId = state.currentUser.id;

  try {
    // QUERY 1+2: veredictos (último estado + dots de la semana).
    // QUERY 3: molestias.
    const [vRes, aRes] = await Promise.all([
      supabaseClient
        .from('verdicts')
        .select('id, raw_json, recommendation, load_level, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseClient
        .from('aches')
        .select('body_zone, intensity, description, reported_at')
        .eq('user_id', userId)
        .order('reported_at', { ascending: false })
        .limit(10)
    ]);

    if (vRes.error) throw vRes.error;
    if (aRes.error) throw aRes.error;

    const verdicts = vRes.data || [];
    const aches = aRes.data || [];
    const latest = verdicts[0] || null;

    // QUERY 4: patrón crítico (tabla puede no existir aún -> no debe romper).
    let pattern = null;
    try {
      const pRes = await supabaseClient
        .from('patterns')
        .select('description, confidence, occurrences')
        .eq('user_id', userId)
        .eq('is_active', true)
        .in('confidence', ['medium', 'high'])
        .order('occurrences', { ascending: false })
        .limit(1);
      if (!pRes.error && pRes.data && pRes.data.length) pattern = pRes.data[0];
    } catch (e) {
      // patterns no disponible — se ignora silenciosamente.
    }

    let html = '';

    // ── Card estado actual ──
    if (latest) {
      const status = latest.raw_json?.status || null;
      const { label, color } = statusDisplay(status);
      const fullText = stripMarkdown(latest.raw_json?.reasoning || latest.recommendation || '');
      const desc = fullText.length > 80 ? fullText.slice(0, 80).trim() + '…' : fullText;
      html += `
        <div class="body-card">
          <div class="body-card-row">
            <div class="body-status-orb" style="background:${color}22;border:2px solid ${color};">
              <div style="width:16px;height:16px;border-radius:50%;background:${color};"></div>
            </div>
            <div style="flex:1;min-width:0;">
              <div class="section-head" style="margin:0 0 4px;padding:0;">Estado actual</div>
              <div class="body-status-label">${escapeHtml(label)}</div>
              ${desc ? `<div class="body-status-desc">${escapeHtml(desc)}</div>` : ''}
            </div>
            <div style="font-size:9px;color:var(--anata-gray);flex-shrink:0;padding-left:8px;">${relDate(latest.created_at)}</div>
          </div>
        </div>`;
    } else {
      // Usuario nuevo sin check-ins.
      html += `
        <div class="body-card">
          <div class="body-card-row">
            <div class="body-status-orb" style="background:#B0B0B022;border:2px solid #B0B0B0;">
              <div style="width:16px;height:16px;border-radius:50%;background:#B0B0B0;"></div>
            </div>
            <div style="flex:1;min-width:0;">
              <div class="section-head" style="margin:0 0 4px;padding:0;">Estado actual</div>
              <div class="body-status-label">Sin check-ins aún</div>
            </div>
          </div>
        </div>`;
    }

    // ── Banner de patrón crítico (arriba de los dots) ──
    if (pattern && pattern.description) {
      html += `<div class="pattern-banner">${escapeHtml(stripMarkdown(pattern.description))}</div>`;
    }

    // ── Dots de la semana ──
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

    // ── Molestias ──
    html += `<div class="section-head">Molestias</div>`;
    if (aches.length > 0) {
      // Activa: reported_at en los últimos 14 días. Activas primero, resueltas al final.
      const decorated = aches.map(a => ({ ...a, _active: daysAgo(a.reported_at) <= 14 }));
      decorated.sort((x, y) => (x._active === y._active ? 0 : x._active ? -1 : 1));

      for (const a of decorated) {
        const dotColor = a._active ? '#c49b20' : '#B0B0B0';
        const badge = a._active ? 'Activa' : 'Resuelta';
        const n = daysAgo(a.reported_at);
        const when = n <= 0 ? 'Hoy' : n === 1 ? 'Hace 1 día' : `Hace ${n} días`;
        const meta = a.intensity ? `${when} · intensidad ${a.intensity}/10` : when;
        html += `
          <div class="ache-item${a._active ? '' : ' resolved'}">
            <div class="ache-dot" style="background:${dotColor};"></div>
            <div class="ache-info">
              <div class="ache-zone">${escapeHtml(a.body_zone || '—')}</div>
              <div class="ache-meta">${escapeHtml(meta)}</div>
            </div>
            <div class="ache-badge">${badge}</div>
          </div>`;
      }
    } else {
      html += `
        <div class="empty-state" style="padding:24px 20px;">
          <p>Sin molestias registradas.</p>
          <p>Cuéntale a ANATA si algo molesta.</p>
        </div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    const c = document.getElementById('body-content');
    if (c) c.innerHTML = `<p class="screen-error">Error al cargar datos: ${escapeHtml(err.message || String(err))}</p>`;
  }
}

export function initBody() {}
