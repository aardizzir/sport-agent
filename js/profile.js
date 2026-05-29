import { supabaseClient } from './supabase.js';
import { state } from './state.js';

export async function loadProfile() {
  const container = document.getElementById('profile-content');
  if (!container || !state.currentUser) return;

  container.innerHTML = '<div class="empty-state"><p>Cargando...</p></div>';

  try {
    const userId = state.currentUser.id;
    const email = state.currentUser.email || '';

    const [pRes, dRes] = await Promise.all([
      supabaseClient.from('profiles').select('*').eq('id', userId).single(),
      supabaseClient
        .from('user_disciplines')
        .select('*, disciplines(name, category)')
        .eq('user_id', userId)
    ]);

    const profile = pRes.data || state.currentProfile || {};
    const disciplines = dRes.data || [];

    const name = profile.name || email.split('@')[0] || 'Usuario';
    const initials = name.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const fields = [
      { label: 'Nombre', value: profile.name || '—' },
      { label: 'Edad', value: profile.age ? `${profile.age} años` : '—' },
      { label: 'Peso', value: profile.weight_kg ? `${profile.weight_kg} kg` : '—' },
      { label: 'Frecuencia', value: profile.frequency_per_week ? `${profile.frequency_per_week}x / semana` : '—' },
    ];

    let html = `
      <div class="profile-header-block">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-name">${name}</div>
        <div class="profile-email">${email}</div>
      </div>

      <div class="section-head">Mis datos</div>
      <div class="profile-section">
        ${fields.map(f => `
          <div class="field-row">
            <span class="field-label">${f.label}</span>
            <span class="field-value">${f.value}</span>
          </div>`).join('')}
      </div>`;

    if (disciplines.length > 0) {
      html += `
        <div class="section-head">Disciplinas</div>
        <div class="profile-section">
          ${disciplines.map(ud => `
            <div class="field-row">
              <span class="field-value">${ud.disciplines?.name || '—'}</span>
              <span class="discipline-badge">${ud.level || ud.experience || '—'}</span>
            </div>`).join('')}
        </div>`;
    }

    html += `
      <div class="profile-signout-wrap">
        <button class="profile-signout-btn" id="profileSignoutBtn">Cerrar sesión</button>
      </div>`;

    container.innerHTML = html;

    document.getElementById('profileSignoutBtn')?.addEventListener('click', async () => {
      if (!confirm('¿Cerrar sesión?')) return;
      await supabaseClient.auth.signOut();
    });

  } catch (err) {
    const c = document.getElementById('profile-content');
    if (c) c.innerHTML = `<p class="screen-error">Error al cargar perfil: ${err.message}</p>`;
  }
}

export function initProfile() {}
