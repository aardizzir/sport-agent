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

export function scrollToBottom(smooth = true) {
  const conversation = document.getElementById('conversation');
  if (!conversation) return;
  setTimeout(() => {
    conversation.scrollTo({ top: conversation.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, 50);
}
