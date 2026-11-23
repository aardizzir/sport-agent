export function getTime() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

export function getDateLabel() {
  const d = new Date();
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${d.getDate()} ${meses[d.getMonth()]}`.toUpperCase();
}

export function formatText(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

// El scroll de Hoy es #hoy-scroll (tarjetas + chat). Durante la carga inicial
// no se baja: la pantalla abre arriba, en "Tu cuerpo hoy".
export const scrollState = { suppress: false };
export function scrollToBottom(smooth = true) {
  const scroller = document.getElementById('hoy-scroll');
  if (!scroller || scrollState.suppress) return;
  setTimeout(() => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, 50);
}

// ── Fechas en hora de Santiago (la misma zona que usa el Worker) ──
export const TZ = 'America/Santiago';
export function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function longDate(isoDate) {
  const d = new Date(isoDate + 'T12:00:00Z');
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}
export function relativeDayLabel(isoDate) {
  const today = localDate();
  if (isoDate === today) return 'Hoy';
  if (isoDate === addDays(today, -1)) return 'Ayer';
  const l = longDate(isoDate);
  return l.charAt(0).toUpperCase() + l.slice(1);
}
