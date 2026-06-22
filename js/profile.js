import { supabaseClient } from './supabase.js';
import { state } from './state.js';

// ── Configuración de campos editables ──
// raw = valor crudo para el input; format() = cómo se muestra en modo lectura;
// validate() devuelve { value } si es válido o { error } con el mensaje inline.
function buildFieldConfigs(profile) {
  return [
    {
      key: 'name',
      label: 'Nombre',
      type: 'text',
      raw: profile.name ?? '',
      format: v => v || '—',
      validate: v => {
        const s = String(v).trim();
        if (s.length < 2) return { error: 'Mínimo 2 caracteres' };
        return { value: s };
      },
    },
    {
      key: 'age',
      label: 'Edad',
      type: 'number',
      raw: profile.age ?? '',
      format: v => (v || v === 0) ? `${v} años` : '—',
      validate: v => {
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n)) return { error: 'Número entero' };
        if (n < 10 || n > 100) return { error: 'Entre 10 y 100' };
        return { value: n };
      },
    },
    {
      key: 'weight_kg',
      label: 'Peso',
      type: 'number',
      raw: profile.weight_kg ?? '',
      format: v => (v || v === 0) ? `${v} kg` : '—',
      validate: v => {
        const n = Number(v);
        if (!Number.isFinite(n)) return { error: 'Número inválido' };
        if (n < 20 || n > 300) return { error: 'Entre 20 y 300' };
        return { value: n };
      },
    },
    {
      key: 'frequency_per_week',
      label: 'Frecuencia',
      type: 'number',
      raw: profile.frequency_per_week ?? '',
      format: v => (v || v === 0) ? `${v}x / semana` : '—',
      validate: v => {
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n)) return { error: 'Número entero' };
        if (n < 1 || n > 14) return { error: 'Entre 1 y 14' };
        return { value: n };
      },
    },
  ];
}

function readRowHTML(field) {
  return `
    <span class="field-label">${field.label}</span>
    <div class="field-edit-wrap">
      <span class="field-value">${field.format(field.raw)}</span>
      <button class="field-edit-btn" data-action="edit" data-key="${field.key}">editar</button>
    </div>`;
}

function editRowHTML(field) {
  const inputmode = field.type === 'number' ? 'numeric' : 'text';
  return `
    <span class="field-label">${field.label}</span>
    <div class="field-edit-wrap editing">
      <input class="field-input" type="${field.type}" inputmode="${inputmode}" value="${String(field.raw ?? '')}" data-key="${field.key}">
      <button class="field-save-btn" data-action="save" data-key="${field.key}">✓ Guardar</button>
    </div>
    <div class="field-error" data-error-for="${field.key}"></div>`;
}

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

    const fields = buildFieldConfigs(profile);

    let html = `
      <div class="profile-header-block">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-name">${name}</div>
        <div class="profile-email">${email}</div>
      </div>

      <div class="section-head">Mis datos</div>
      <div class="profile-section">
        ${fields.map(f => `
          <div class="field-row" data-field-row="${f.key}">
            ${readRowHTML(f)}
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

    // ── Sección: Instalar ANATA (PWA) ──
    html += `
      <div class="section-head">Instalar ANATA</div>
      <div class="profile-section">
        <div class="install-block">
          <p class="install-copy">Para una mejor experiencia, agregá ANATA a tu pantalla de inicio.</p>
          <button class="install-instructions-btn" id="installInstructionsBtn">Ver instrucciones</button>
        </div>
        <div class="install-instructions hidden" id="installInstructions">
          <div class="install-step"><strong>En iPhone (Safari):</strong> tocá el ícono de compartir <span class="install-glyph">⬆</span> y elegí <em>"Agregar a pantalla de inicio"</em>.</div>
          <div class="install-step"><strong>En Android (Chrome):</strong> abrí el menú <span class="install-glyph">⋮</span> y elegí <em>"Instalar app"</em>.</div>
        </div>
      </div>`;

    html += `
      <div class="profile-signout-wrap">
        <button class="profile-signout-btn" id="profileSignoutBtn">Cerrar sesión</button>
      </div>`;

    container.innerHTML = html;

    // ── Estado vivo de los campos (raw value y config) para edición ──
    const fieldMap = new Map(fields.map(f => [f.key, f]));
    const userId2 = userId;

    function enterEditMode(key) {
      const row = container.querySelector(`[data-field-row="${key}"]`);
      const field = fieldMap.get(key);
      if (!row || !field) return;
      row.innerHTML = editRowHTML(field);
      const input = row.querySelector('.field-input');
      input?.focus();
      input?.select?.();
    }

    function exitToRead(key, flash) {
      const row = container.querySelector(`[data-field-row="${key}"]`);
      const field = fieldMap.get(key);
      if (!row || !field) return;
      row.innerHTML = readRowHTML(field);
      if (flash) {
        row.classList.add('field-saved-flash');
        setTimeout(() => row.classList.remove('field-saved-flash'), 800);
      }
    }

    async function saveField(key) {
      const row = container.querySelector(`[data-field-row="${key}"]`);
      const field = fieldMap.get(key);
      if (!row || !field) return;
      const input = row.querySelector('.field-input');
      const errEl = row.querySelector(`[data-error-for="${key}"]`);
      const saveBtn = row.querySelector('.field-save-btn');
      if (!input) return;

      const { value, error } = field.validate(input.value);
      if (error) {
        if (errEl) errEl.textContent = error;
        input.focus();
        return;
      }
      if (errEl) errEl.textContent = '';
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando…'; }

      const { error: dbError } = await supabaseClient
        .from('profiles')
        .update({ [key]: value })
        .eq('id', userId2);

      if (dbError) {
        if (errEl) errEl.textContent = dbError.message || 'No se pudo guardar';
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓ Guardar'; }
        return;
      }

      // Éxito: actualizar estado local + config + volver a lectura con flash
      field.raw = value;
      if (state.currentProfile) state.currentProfile[key] = value;
      exitToRead(key, true);
    }

    // Delegación de eventos (los nodos se re-renderizan por fila)
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const key = btn.dataset.key;
      if (btn.dataset.action === 'edit') enterEditMode(key);
      else if (btn.dataset.action === 'save') saveField(key);
    });

    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.field-input');
      if (!input) return;
      e.preventDefault();
      saveField(input.dataset.key);
    });

    // ── Instrucciones de instalación (toggle) ──
    document.getElementById('installInstructionsBtn')?.addEventListener('click', () => {
      document.getElementById('installInstructions')?.classList.toggle('hidden');
    });

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
