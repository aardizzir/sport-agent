import { supabaseClient } from './supabase.js';
import { state } from './state.js';
import { startOnboarding } from './onboarding.js';
import { enterChatApp, clearConversationUI } from './chat.js';

const loginScreen = document.getElementById('loginScreen');
const loginButtons = document.getElementById('loginButtons');
const emailForm = document.getElementById('emailForm');
const loginLoading = document.getElementById('loginLoading');
const loginError = document.getElementById('loginError');
const onboarding = document.getElementById('onboarding');
const appMain = document.getElementById('appMain');

export function showLoginScreen() {
  loginScreen.classList.remove('hidden');
  onboarding.classList.add('hidden');
  appMain.style.display = 'none';
  loginButtons.classList.remove('hidden');
  emailForm.classList.add('hidden');
  loginLoading.classList.add('hidden');
}

function showLoginLoading() {
  loginButtons.classList.add('hidden');
  emailForm.classList.add('hidden');
  loginLoading.classList.remove('hidden');
}

export function showEmailForm() {
  loginButtons.classList.add('hidden');
  emailForm.classList.remove('hidden');
  loginError.textContent = '';
  document.getElementById('emailInput').focus();
}

export function hideEmailForm() {
  emailForm.classList.add('hidden');
  loginButtons.classList.remove('hidden');
  loginError.textContent = '';
}

export async function signInWithGoogle() {
  showLoginLoading();
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
  } catch (error) {
    console.error('Google sign in error:', error);
    showLoginScreen();
    loginError.textContent = error.message || 'Error al conectar con Google';
  }
}

export async function signInWithEmail() {
  const email = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  if (!email || !password) { loginError.textContent = 'Completá email y contraseña'; return; }
  if (password.length < 6) { loginError.textContent = 'La contraseña debe tener al menos 6 caracteres'; return; }
  loginError.textContent = '';
  showLoginLoading();
  try {
    let { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error && error.message.toLowerCase().includes('invalid')) {
      const result = await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
      if (result.error) throw result.error;
      data = result.data;
    } else if (error) {
      throw error;
    }
    if (data.user) {
      state.currentUser = data.user;
      await onUserAuthenticated();
    }
  } catch (error) {
    console.error('Email sign in error:', error);
    showLoginScreen();
    showEmailForm();
    loginError.textContent = error.message || 'Error al iniciar sesión';
  }
}

export async function signOut() {
  if (!confirm('¿Cerrar sesión?')) return;
  await supabaseClient.auth.signOut();
  state.currentUser = null;
  state.currentProfile = null;
  state.currentConversationId = null;
  state.messageHistory = [];
  clearConversationUI();
  showLoginScreen();
}

async function onUserAuthenticated() {
  loginScreen.classList.add('hidden');

  try {
    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', state.currentUser.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error loading profile:', error);
    }

    state.currentProfile = profile;

    if (!profile || !profile.onboarding_completed) {
      await startOnboarding();
    } else {
      await enterChatApp();
    }
  } catch (error) {
    console.error('Error in onUserAuthenticated:', error);
    await startOnboarding();
  }
}

export async function checkAuthState() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    state.currentUser = session.user;
    await onUserAuthenticated();
  } else {
    showLoginScreen();
  }
}

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' && session) {
    state.currentUser = session.user;
    await onUserAuthenticated();
  } else if (event === 'SIGNED_OUT') {
    state.currentUser = null;
    state.currentProfile = null;
    showLoginScreen();
  }
});

// Listeners para navegación con teclado en el formulario de email
document.getElementById('emailInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('passwordInput').focus();
});

document.getElementById('passwordInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signInWithEmail();
});

window.signInWithGoogle = signInWithGoogle;
window.showEmailForm = showEmailForm;
window.hideEmailForm = hideEmailForm;
window.signInWithEmail = signInWithEmail;
window.signOut = signOut;
