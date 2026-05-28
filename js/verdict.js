import { getTime, getDateLabel, escapeHtml, scrollToBottom } from './utils.js';

export function renderVerdictCardC2(data, parentEl) {
  if (!parentEl) parentEl = document.getElementById('conversation');

  const statusMap = {
    go: { color: '#D9F264', label: 'Luz verde' },
    caution: { color: '#FFB800', label: 'Luz amarilla' },
    stop: { color: '#FF4D4D', label: 'Luz roja' }
  };
  const colorSet = statusMap[data.status] || statusMap.caution;
  const mainColor = colorSet.color;
  const labelText = data.label || colorSet.label;

  const gaugeLength = 408.4;
  const intensity = Math.max(0, Math.min(100, data.intensity_percent || 0));
  const gaugeOffset = gaugeLength * (1 - intensity / 100);

  const loadWidth = Math.max(0, Math.min(100, data.load_percent || 0));
  const riskWidth = Math.max(0, Math.min(100, data.risk_percent || 0));

  const loadColor = loadWidth > 75 ? '#FF4D4D' : loadWidth > 50 ? '#FFB800' : loadWidth > 30 ? '#FFB800' : '#D9F264';
  const riskColor = riskWidth > 75 ? '#FF4D4D' : riskWidth > 50 ? '#FF4D4D' : riskWidth > 25 ? '#FFB800' : '#D9F264';

  const doItems = (data.do_items || []).slice(0, 4);
  const avoidItems = (data.avoid_items || []).slice(0, 4);

  const card = document.createElement('div');
  card.className = 'verdict';
  card.innerHTML = `
    <div class="v-header">
      <div class="v-status-pill">
        <div class="v-status-dot ${data.status}"></div>
        <span class="v-status-label">${escapeHtml(labelText)}</span>
      </div>
      <span class="v-timestamp">${getDateLabel()} · ${getTime()}</span>
    </div>
    <div class="v-gauge">
      <svg viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg">
        <path d="M 40 140 A 100 100 0 0 1 240 140" stroke="rgba(255,255,255,0.06)" stroke-width="10" fill="none" stroke-linecap="round"/>
        <path d="M 40 140 A 100 100 0 0 1 240 140" stroke="${mainColor}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${gaugeLength}" stroke-dashoffset="${gaugeOffset}" style="transition: stroke-dashoffset 0.8s ease;"/>
        <text x="140" y="105" text-anchor="middle" fill="${mainColor}" font-family="Outfit" font-weight="300" font-size="42" letter-spacing="-1">${intensity}<tspan font-size="20" dy="-12">%</tspan></text>
        <text x="140" y="135" text-anchor="middle" fill="#55524e" font-family="Outfit" font-weight="400" font-size="9" letter-spacing="1.5">INTENSIDAD MÁX</text>
      </svg>
    </div>
    <div class="v-metrics">
      <div class="v-metric">
        <span class="v-metric-label">Carga</span>
        <div class="v-metric-bar"><div class="v-metric-fill" style="width:${loadWidth}%; background:${loadColor};"></div></div>
        <span class="v-metric-value">${loadWidth}</span>
      </div>
      <div class="v-metric">
        <span class="v-metric-label">Riesgo</span>
        <div class="v-metric-bar"><div class="v-metric-fill" style="width:${riskWidth}%; background:${riskColor};"></div></div>
        <span class="v-metric-value">${riskWidth}</span>
      </div>
    </div>
    ${doItems.length > 0 ? `
      <div class="v-section">
        <div class="v-section-label">Hacer</div>
        <div class="v-list">${doItems.map(item => `<div class="v-item do">${escapeHtml(item)}</div>`).join('')}</div>
      </div>
    ` : ''}
    ${avoidItems.length > 0 ? `
      <div class="v-section">
        <div class="v-section-label">Evitar</div>
        <div class="v-list">${avoidItems.map(item => `<div class="v-item avoid">${escapeHtml(item)}</div>`).join('')}</div>
      </div>
    ` : ''}
    ${data.warning ? `<div class="v-warning">${escapeHtml(data.warning)}</div>` : ''}
  `;
  parentEl.appendChild(card);
  scrollToBottom();
}
