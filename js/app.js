import { checkAuthState } from './auth.js';
import { state } from './state.js';
import { initNavigation } from './navigation.js';

// Fix de altura para teclado en iOS
function updateAppHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', h + 'px');
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    updateAppHeight();
    requestAnimationFrame(() => {
      const conv = document.getElementById('conversation');
      if (conv) conv.scrollTop = conv.scrollHeight;
    });
  });
}
window.addEventListener('resize', updateAppHeight);
window.addEventListener('orientationchange', () => setTimeout(updateAppHeight, 200));
updateAppHeight();

const input = document.getElementById('inputField');
const sendBtn = document.getElementById('sendBtn');
const conversation = document.getElementById('conversation');

input.addEventListener('focus', () => {
  setTimeout(() => {
    updateAppHeight();
    conversation.scrollTop = conversation.scrollHeight;
  }, 300);
});

input.addEventListener('blur', () => {
  setTimeout(() => {
    updateAppHeight();
    window.scrollTo(0, 0);
  }, 100);
});

input.addEventListener('input', () => {
  sendBtn.disabled = input.value.trim() === '' || state.isStreaming;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 100) + 'px';
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
});

initNavigation();
checkAuthState();
