import { state } from './state.js';
import { loadHistory } from './history.js';
import { loadCuerpo } from './body.js';
import { loadProfile } from './profile.js';
import { returnToToday } from './chat.js';

export function switchTab(tabName) {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.add('hidden');
    screen.classList.remove('active');
  });
  const screen = document.getElementById(`screen-${tabName}`);
  if (screen) {
    screen.classList.remove('hidden');
    screen.classList.add('active');
  }
  state.currentTab = tabName;

  if (tabName === 'historial') loadHistory();
  else if (tabName === 'perfil') loadProfile();
  else if (tabName === 'cuerpo') loadCuerpo();
  else if (tabName === 'hoy' && state.viewingHistorical) returnToToday();
}

export function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  window.switchTab = switchTab;
  switchTab('hoy');
}
