import { supabaseClient, WORKER_URL } from './supabase.js';
import { state } from './state.js';
import { getTime, formatText, escapeHtml, scrollToBottom } from './utils.js';
import { renderVerdictCardC2 } from './verdict.js';

const conversation = document.getElementById('conversation');
const avatar = document.getElementById('avatar');
const headerName = document.getElementById('headerName');
const headerStatus = document.getElementById('headerStatus');
const sendBtn = document.getElementById('sendBtn');
const input = document.getElementById('inputField');

export function clearConversationUI() {
  conversation.innerHTML = '<div class="day-marker">Hoy</div>';
}

export function setAgentState(agentState) {
  avatar.classList.remove('thinking', 'error');
  if (agentState === 'thinking') {
    avatar.classList.add('thinking');
    headerStatus.textContent = '● Pensando...';
  } else if (agentState === 'error') {
    avatar.classList.add('error');
    headerStatus.textContent = '● Error de conexión';
  } else {
    headerStatus.textContent = '● En línea';
  }
}

export function renderUserMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'msg msg-user';
  msg.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div><div class="msg-time">${getTime()}</div>`;
  conversation.appendChild(msg);
  scrollToBottom();
}

export function createAgentBubble() {
  const msg = document.createElement('div');
  msg.className = 'msg msg-agent';
  msg.innerHTML = `<div class="msg-bubble"><span class="msg-content"></span><span class="streaming-cursor"></span></div><div class="msg-time">${getTime()}</div>`;
  conversation.appendChild(msg);
  scrollToBottom();
  return { container: msg, content: msg.querySelector('.msg-content'), cursor: msg.querySelector('.streaming-cursor') };
}

function showTypingDots() {
  const t = document.createElement('div');
  t.className = 'typing';
  t.id = 'typingIndicator';
  t.innerHTML = '<span></span><span></span><span></span>';
  conversation.appendChild(t);
  scrollToBottom();
}

function removeTypingDots() {
  const t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

function renderError(message) {
  const msg = document.createElement('div');
  msg.className = 'msg msg-agent msg-error';
  msg.innerHTML = `<div class="msg-bubble">⚠ ${escapeHtml(message)}</div><div class="msg-time">${getTime()}</div>`;
  conversation.appendChild(msg);
  scrollToBottom();
}

// Marcador oculto de molestia. El usuario nunca lo ve; alimenta la tabla `aches`.
const ACHE_RE = /<<<ACHE\s*([\s\S]+?)\s*ACHE>>>/g;

// Devuelve la primera molestia parseada del texto (o null). No muta nada.
export function extractAcheData(text) {
  const m = text.match(/<<<ACHE\s*([\s\S]+?)\s*ACHE>>>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    if (!data || !data.body_zone) return null;
    return data;
  } catch (e) {
    console.warn('ACHE parse error:', e);
    return null;
  }
}

// Quita todos los bloques ACHE del texto para que nunca se rendericen.
function stripAcheMarkers(text) {
  return text.replace(ACHE_RE, '').trim();
}

export function processCompleteResponse(fullText, agentBubble) {
  fullText = stripAcheMarkers(fullText);
  if (fullText.includes('<<<VERDICT')) {
    try {
      const verdictMatch = fullText.match(/<<<VERDICT\s*([\s\S]+?)\s*VERDICT>>>/);
      if (!verdictMatch) throw new Error('VERDICT markers not properly closed');
      const verdictData = JSON.parse(verdictMatch[1]);
      const beforeText = fullText.substring(0, fullText.indexOf('<<<VERDICT')).trim();
      const afterText = fullText.substring(fullText.indexOf('VERDICT>>>') + 'VERDICT>>>'.length).trim();
      if (beforeText) {
        agentBubble.content.innerHTML = formatText(beforeText);
      } else {
        agentBubble.container.remove();
      }
      agentBubble.cursor.remove();
      renderVerdictCardC2(verdictData);
      if (afterText) {
        const afterBubble = createAgentBubble();
        afterBubble.content.innerHTML = formatText(afterText);
        afterBubble.cursor.remove();
      }
      return fullText;
    } catch (e) {
      console.warn('VERDICT parse error:', e);
      agentBubble.content.innerHTML = formatText(fullText);
      agentBubble.cursor.remove();
    }
  } else {
    agentBubble.content.innerHTML = formatText(fullText);
    agentBubble.cursor.remove();
  }
  return fullText;
}

export async function saveMessageToDb(role, content) {
  if (!state.currentConversationId || !state.currentUser) return;
  try {
    const { error: insertError } = await supabaseClient.from('messages').insert({
      conversation_id: state.currentConversationId,
      role: role,
      content: content
    });
    if (insertError) {
      console.error('saveMessageToDb insert error:', insertError);
      console.error('Failed payload:', { conversation_id: state.currentConversationId, role: role, content_length: content?.length });
    }
    const { error: updateError } = await supabaseClient.from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', state.currentConversationId);
    if (updateError) {
      console.error('Conversation update error:', updateError);
    }
  } catch (error) {
    console.error('Error saving message:', error);
  }
}

export async function createNewConversation() {
  const { data, error } = await supabaseClient
    .from('conversations')
    .insert({ user_id: state.currentUser.id })
    .select()
    .single();
  if (error) throw error;
  state.currentConversationId = data.id;
  return data;
}

export async function loadMessages(conversationId) {
  const { data, error } = await supabaseClient
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) { console.error('Error loading messages:', error); return; }

  state.messageHistory = data.map(m => ({ role: m.role, content: m.content }));

  for (const msg of state.messageHistory) {
    if (msg.role === 'user' && !msg.content.startsWith('[SISTEMA:')) {
      renderUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      const bubble = createAgentBubble();
      processCompleteResponse(msg.content, bubble);
    }
  }
}

// ── Navegación histórica: cargar una conversación pasada en modo solo lectura ──
function showHistoricalBanner(dateLabel) {
  let banner = document.getElementById('historical-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'historical-banner';
    banner.className = 'historical-banner';
    banner.innerHTML = `<span>← Esta es una conversación pasada</span><button onclick="returnToToday()">Volver al chat de hoy</button>`;
    conversation.parentNode.insertBefore(banner, conversation);
  }
  banner.style.display = 'flex';
  input.disabled = true;
  sendBtn.disabled = true;
  input.placeholder = dateLabel
    ? `Conversación del ${dateLabel} — solo lectura`
    : 'Conversación pasada — solo lectura';
}

// Carga los mensajes de una conversación. Si isHistorical, la muestra en modo
// solo lectura con banner; NO toca state.currentConversationId ni messageHistory
// (la conversación de hoy queda intacta para cuando el usuario vuelva).
export async function loadConversation(conversationId, isHistorical = false) {
  if (!conversationId) return;

  if (!isHistorical) {
    await loadMessages(conversationId);
    return;
  }

  state.viewingHistorical = true;
  clearConversationUI();

  const { data, error } = await supabaseClient
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error loading historical conversation:', error);
    return;
  }

  for (const msg of (data || [])) {
    if (msg.role === 'user' && !msg.content.startsWith('[SISTEMA:')) {
      renderUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      const bubble = createAgentBubble();
      processCompleteResponse(msg.content, bubble);
    }
  }

  const dateLabel = (data && data.length)
    ? new Date(data[0].created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  showHistoricalBanner(dateLabel);
}

// Vuelve al chat del día actual desde una conversación histórica.
export async function returnToToday() {
  const banner = document.getElementById('historical-banner');
  if (banner) banner.remove();
  state.viewingHistorical = false;
  input.disabled = false;
  input.placeholder = 'Escribí tu mensaje...';
  clearConversationUI();
  if (state.currentConversationId) {
    await loadMessages(state.currentConversationId);
  }
  sendBtn.disabled = input.value.trim() === '';
}

export function buildSystemContextMessage() {
  if (!state.currentProfile) {
    return '[SISTEMA: Es el primer mensaje del usuario. Saluda brevemente y haz tu primera pregunta del check-in del día.]';
  }

  const name = state.currentProfile.name || 'el usuario';
  const age = state.currentProfile.age ? `${state.currentProfile.age} años` : null;
  const freq = state.currentProfile.frequency_per_week || null;

  const disciplinesContext = state.onboardingData.disciplines.length > 0
    ? state.onboardingData.disciplines.map(d => d.name).join(', ')
    : null;

  const experienceDescription = {
    '<1': 'principiante (menos de 1 año practicando, necesita explicaciones claras y sin tecnicismos)',
    '1-3': 'intermedio (1 a 3 años, ya domina lo básico)',
    '3-7': 'amateur serio (3 a 7 años, deportista comprometido con buena base técnica, hablale con criterio sin sobre-explicar)',
    '+7': 'avanzado (más de 7 años, podés ser técnico y directo, respeta su autonomía)'
  };
  const experienceContext = experienceDescription[state.onboardingData.experience] || null;

  let context = `[SISTEMA: Primera vez del usuario en la app. Datos del onboarding:`;
  context += `\n- Nombre: ${name}`;
  if (age) context += `\n- Edad: ${age}`;
  if (disciplinesContext) context += `\n- Disciplinas: ${disciplinesContext}`;
  if (experienceContext) context += `\n- Nivel: ${experienceContext}`;
  if (freq) context += `\n- Frecuencia: ${freq} veces/semana`;
  context += `\n\nSaluda usando el nombre del usuario, menciona brevemente que ves sus disciplinas y frecuencia (sin enumerar todo, integralo natural), y hacé tu primera pregunta del check-in del día (cómo se siente, cómo durmió, qué tal el cuerpo hoy). Adaptá el tono y profundidad al nivel del deportista. Sé breve, cálido y directo.]`;

  return context;
}

export function triggerFirstMessage() {
  const systemMsg = buildSystemContextMessage();
  callAgent(systemMsg);
}

export async function callAgent(userMessage) {
  state.messageHistory.push({ role: 'user', content: userMessage });
  await saveMessageToDb('user', userMessage);

  setAgentState('thinking');
  state.isStreaming = true;
  sendBtn.disabled = true;
  showTypingDots();

  let agentBubble = null;
  let fullText = '';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const authToken = session?.access_token ?? null;

    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.messageHistory,
        userId: state.currentUser?.id ?? null,
        authToken,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Error ${response.status}`);
    }

    removeTypingDots();
    agentBubble = createAgentBubble();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const chunk = event.delta.text;
            fullText += chunk;
            // Cortar el texto visible en el primer marcador oculto (VERDICT o ACHE).
            const markerIdxs = [fullText.indexOf('<<<VERDICT'), fullText.indexOf('<<<ACHE')]
              .filter(i => i !== -1);
            if (markerIdxs.length === 0) {
              agentBubble.content.innerHTML = formatText(fullText);
              scrollToBottom(false);
            } else {
              const idx = Math.min(...markerIdxs);
              const visibleText = fullText.substring(0, idx).trim();
              agentBubble.content.innerHTML = formatText(visibleText);
              agentBubble.cursor.style.background = 'var(--yellow)';
            }
          }
        } catch (e) {}
      }
    }

    processCompleteResponse(fullText, agentBubble);
    state.messageHistory.push({ role: 'assistant', content: fullText });
    await saveMessageToDb('assistant', fullText);

    // Persistir el veredicto en Supabase si la respuesta contiene uno
    if (fullText.includes('<<<VERDICT') && state.currentUser) {
      try {
        const verdictMatch = fullText.match(/<<<VERDICT\s*([\s\S]+?)\s*VERDICT>>>/);
        if (verdictMatch) {
          const verdictData = JSON.parse(verdictMatch[1]);
          const { error: verdictError } = await supabaseClient.from('verdicts').insert({
            user_id: state.currentUser.id,
            conversation_id: state.currentConversationId,
            recommendation: verdictData.reasoning ?? null,
            load_level: verdictData.label ?? null,
            rest_days: verdictData.rest_days ?? 0,
            raw_json: verdictData,
          });
          if (verdictError) console.error('Error saving verdict to DB:', verdictError);
        }
      } catch (e) {
        console.error('Verdict parse/save error:', e);
      }
    }

    // Persistir molestias reportadas (bloques ACHE) en la tabla aches.
    // Esto alimenta detectAndUpdatePatterns() en el Worker -> tabla patterns.
    if (fullText.includes('<<<ACHE') && state.currentUser) {
      const matches = [...fullText.matchAll(ACHE_RE)];
      for (const match of matches) {
        try {
          const ache = JSON.parse(match[1]);
          if (!ache || !ache.body_zone) continue;
          const intensity = Number.isInteger(ache.intensity) ? ache.intensity : null;
          const { error: acheError } = await supabaseClient.from('aches').insert({
            user_id: state.currentUser.id,
            conversation_id: state.currentConversationId,
            body_zone: String(ache.body_zone).trim().toLowerCase(),
            intensity: intensity,
            description: ache.description ?? null,
          });
          if (acheError) console.error('Error saving ache to DB:', acheError);
        } catch (e) {
          console.error('Ache parse/save error:', e);
        }
      }
    }

    setAgentState('online');

  } catch (error) {
    console.error('Error:', error);
    removeTypingDots();
    if (agentBubble) agentBubble.container.remove();
    let errorMsg = 'No pude conectar con el agente. ';
    if (error.message.includes('Failed to fetch')) errorMsg += 'Revisa tu conexión a internet.';
    else errorMsg += error.message;
    renderError(errorMsg);
    setAgentState('error');
    state.messageHistory.pop();
  } finally {
    state.isStreaming = false;
    sendBtn.disabled = input.value.trim() === '';
  }
}

export function setupUserHeader() {
  const displayName = state.currentProfile?.name || state.currentUser.email?.split('@')[0] || 'Usuario';
  headerName.textContent = displayName;
}

export async function loadOrCreateConversation() {
  try {
    const { data: conversations, error } = await supabaseClient
      .from('conversations')
      .select('id')
      .eq('user_id', state.currentUser.id)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (conversations && conversations.length > 0) {
      state.currentConversationId = conversations[0].id;
      await loadMessages(state.currentConversationId);
      if (state.messageHistory.length === 0) {
        setTimeout(() => triggerFirstMessage(), 400);
      }
    } else {
      await createNewConversation();
      setTimeout(() => triggerFirstMessage(), 400);
    }
  } catch (error) {
    console.error('Error loading conversation:', error);
  }
}

const onboarding = document.getElementById('onboarding');
const appMain = document.getElementById('appMain');

export async function enterChatApp(justFinishedOnboarding = false) {
  onboarding.classList.add('hidden');
  appMain.style.display = 'flex';
  appMain.classList.remove('hidden');

  setupUserHeader();

  if (justFinishedOnboarding) {
    await createNewConversation();
    setTimeout(() => triggerFirstMessage(), 600);
  } else {
    await loadOrCreateConversation();
  }
}

export async function resetChat() {
  if (!confirm('¿Reiniciar conversación? Empezás una nueva (la anterior queda guardada).')) return;
  try {
    await createNewConversation();
  } catch (error) {
    console.error('Error creating new conversation:', error);
  }
  state.messageHistory = [];
  conversation.innerHTML = '<div class="day-marker">Hoy</div>';
  setTimeout(() => {
    callAgent('[SISTEMA: El usuario reinició la conversación. Saluda brevemente variando la apertura y haz tu primera pregunta del check-in.]');
  }, 300);
}

export async function sendMessage() {
  const text = input.value.trim();
  if (!text || state.isStreaming) return;
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;
  renderUserMessage(text);
  await callAgent(text);
}

window.resetChat = resetChat;
window.sendMessage = sendMessage;
window.loadConversation = loadConversation;
window.returnToToday = returnToToday;
