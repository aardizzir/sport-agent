import { supabaseClient } from './supabase.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { enterChatApp } from './chat.js';

const onboarding = document.getElementById('onboarding');

export async function startOnboarding() {
  onboarding.classList.remove('hidden');
  document.getElementById('appMain').style.display = 'none';

  const meta = state.currentUser.user_metadata || {};
  const suggestedName = meta.full_name || meta.name || state.currentUser.email?.split('@')[0] || '';
  document.getElementById('obName').value = suggestedName;
  state.onboardingData.name = suggestedName;

  await loadDisciplines();
  setupFrequencySlider();
  setupExperienceChips();

  state.onboardingStep = 0;
  showOnboardingStep(0);
}

async function loadDisciplines() {
  try {
    const { data, error } = await supabaseClient
      .from('disciplines')
      .select('id, name')
      .order('name');

    if (error) throw error;
    state.availableDisciplines = data || [];
    renderDisciplineChips();
  } catch (error) {
    console.error('Error loading disciplines:', error);
    state.availableDisciplines = [
      { id: 'fallback-1', name: 'Fútbol' }, { id: 'fallback-2', name: 'Running' },
      { id: 'fallback-3', name: 'Gimnasio' }, { id: 'fallback-4', name: 'Crossfit' },
      { id: 'fallback-5', name: 'Ciclismo/MTB' }, { id: 'fallback-6', name: 'Natación' }
    ];
    renderDisciplineChips();
  }
}

function renderDisciplineChips() {
  const container = document.getElementById('obDisciplines');
  container.innerHTML = state.availableDisciplines.map(d =>
    `<div class="ob-chip" data-discipline-id="${d.id}" data-discipline-name="${escapeHtml(d.name)}">${escapeHtml(d.name)}</div>`
  ).join('');

  container.querySelectorAll('.ob-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      updateOnboardingDisciplines();
      validateCurrentStep();
    });
  });
}

function updateOnboardingDisciplines() {
  const selected = document.querySelectorAll('#obDisciplines .ob-chip.selected');
  state.onboardingData.disciplines = Array.from(selected).map(chip => ({
    id: chip.dataset.disciplineId,
    name: chip.dataset.disciplineName
  }));
}

function setupExperienceChips() {
  const chips = document.querySelectorAll('[data-experience]');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      state.onboardingData.experience = chip.dataset.experience;
      validateCurrentStep();
    });
  });
}

function setupFrequencySlider() {
  const slider = document.getElementById('obFrequency');
  const valueDisplay = document.getElementById('obFreqValue');
  slider.addEventListener('input', () => {
    state.onboardingData.frequency_per_week = parseInt(slider.value);
    valueDisplay.textContent = slider.value;
  });
}

function showOnboardingStep(step) {
  document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
  document.querySelector(`.ob-step[data-step="${step}"]`).classList.add('active');

  document.querySelectorAll('.ob-progress-bar').forEach((bar, idx) => {
    bar.classList.toggle('active', idx <= step);
  });

  const btnNext = document.getElementById('obNext');
  const btnBack = document.getElementById('obBack');

  if (step === 0) {
    btnNext.textContent = 'Empezar';
    btnBack.classList.add('hidden');
  } else if (step === 3) {
    btnNext.textContent = 'Listo';
    btnBack.classList.remove('hidden');
  } else {
    btnNext.textContent = 'Continuar';
    btnBack.classList.remove('hidden');
  }

  validateCurrentStep();

  if (step === 1) {
    setTimeout(() => document.getElementById('obName').focus(), 200);
  }
}

export function validateCurrentStep() {
  const btn = document.getElementById('obNext');
  const errorEl = document.getElementById('obError');
  errorEl.textContent = '';
  btn.disabled = false;

  if (state.onboardingStep === 0) {
    btn.disabled = false;
  } else if (state.onboardingStep === 1) {
    const name = document.getElementById('obName').value.trim();
    const age = parseInt(document.getElementById('obAge').value);
    if (!name || !age || age < 14 || age > 100) {
      btn.disabled = true;
    }
  } else if (state.onboardingStep === 2) {
    if (state.onboardingData.disciplines.length === 0 || !state.onboardingData.experience) {
      btn.disabled = true;
    }
  } else if (state.onboardingStep === 3) {
    btn.disabled = false;
  }
}

export async function onboardingNext() {
  const errorEl = document.getElementById('obError');
  errorEl.textContent = '';

  if (state.onboardingStep === 1) {
    const name = document.getElementById('obName').value.trim();
    const age = parseInt(document.getElementById('obAge').value);
    const weight = parseFloat(document.getElementById('obWeight').value);
    if (!name) { errorEl.textContent = 'Necesito tu nombre'; return; }
    if (!age || age < 14 || age > 100) { errorEl.textContent = 'Edad inválida'; return; }
    state.onboardingData.name = name;
    state.onboardingData.age = age;
    state.onboardingData.weight_kg = weight && weight >= 30 && weight <= 200 ? weight : null;
  }

  if (state.onboardingStep < 3) {
    state.onboardingStep++;
    showOnboardingStep(state.onboardingStep);
  } else {
    await finishOnboarding();
  }
}

export function onboardingBack() {
  if (state.onboardingStep > 0) {
    state.onboardingStep--;
    showOnboardingStep(state.onboardingStep);
  }
}

async function finishOnboarding() {
  const btn = document.getElementById('obNext');
  const errorEl = document.getElementById('obError');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  errorEl.textContent = '';

  try {
    const profileData = {
      id: state.currentUser.id,
      email: state.currentUser.email,
      name: state.onboardingData.name,
      age: state.onboardingData.age,
      weight_kg: state.onboardingData.weight_kg,
      frequency_per_week: state.onboardingData.frequency_per_week,
      onboarding_completed: true,
      updated_at: new Date().toISOString()
    };

    const { error: profileError } = await supabaseClient
      .from('profiles')
      .upsert(profileData);

    if (profileError) throw profileError;

    if (state.onboardingData.disciplines.length > 0) {
      await supabaseClient
        .from('user_disciplines')
        .delete()
        .eq('user_id', state.currentUser.id);

      const experienceToLevel = {
        '<1': 'principiante',
        '1-3': 'intermedio',
        '3-7': 'amateur_serio',
        '+7': 'avanzado'
      };
      const levelValue = experienceToLevel[state.onboardingData.experience] || 'intermedio';

      const disciplinesData = state.onboardingData.disciplines.map((d, idx) => ({
        user_id: state.currentUser.id,
        discipline_id: d.id,
        is_primary: idx === 0,
        level: levelValue
      }));

      const { error: discError } = await supabaseClient
        .from('user_disciplines')
        .insert(disciplinesData);

      if (discError) {
        console.error('Error inserting disciplines:', discError);
      }
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', state.currentUser.id)
      .single();

    state.currentProfile = profile;

    await enterChatApp(true);

  } catch (error) {
    console.error('Error finishing onboarding:', error);
    errorEl.textContent = 'Hubo un error al guardar. Intentalo de nuevo.';
    btn.disabled = false;
    btn.textContent = 'Listo';
  }
}

// Listeners para validación en tiempo real de campos del onboarding
document.getElementById('obName').addEventListener('input', validateCurrentStep);
document.getElementById('obAge').addEventListener('input', validateCurrentStep);
document.getElementById('obWeight').addEventListener('input', validateCurrentStep);

window.onboardingNext = onboardingNext;
window.onboardingBack = onboardingBack;
