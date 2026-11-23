// ANATA · Hoja inferior (bottom sheet) para formularios cortos.
export function openSheet(title, contentEl) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.id = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head">
        <h2 class="card-title" id="sheet-title">${title}</h2>
        <button class="sheet-close" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="sheet-body"></div>
    </div>`;
  overlay.querySelector('.sheet-body').appendChild(contentEl);
  overlay.querySelector('.sheet-close').onclick = closeSheet;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSheet(); });
  document.getElementById('appMain').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return closeSheet;
}

export function closeSheet() {
  document.getElementById('sheet-overlay')?.remove();
}
