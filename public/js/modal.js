const Modal = {
  _overlay: null,

  open(innerHTML, opts) {
    opts = opts || {};
    Modal.close();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay' + (opts.overlayClass ? ' ' + opts.overlayClass : '');
    overlay.innerHTML =
      `<div class="modal-dialog${opts.wide ? ' wide' : ''}">` +
        `<button type="button" class="icon-btn modal-close" data-modal-close>${ICONS.close()}</button>` +
        innerHTML +
      `</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) Modal.close(); });
    overlay.querySelector('[data-modal-close]').addEventListener('click', Modal.close);
    document.addEventListener('keydown', Modal._escHandler);
    Modal._overlay = overlay;
    return overlay;
  },

  close() {
    if (Modal._overlay) {
      Modal._overlay.remove();
      Modal._overlay = null;
    }
    document.removeEventListener('keydown', Modal._escHandler);
  },

  // Замена нативному confirm()/alert() для необратимых действий (удаление
  // и т.п.) — оформлена в общем стиле остальных модалок. `onConfirm` может
  // быть async: пока он выполняется, кнопки блокируются, а на ошибку модалка
  // не закрывается и показывает её текстом внутри себя (как в формах
  // редактирования), вместо нативного alert().
  confirm(opts) {
    opts = opts || {};
    const danger = opts.danger !== false;

    const overlay = Modal.open(`
      <div class="confirm-icon${danger ? '' : ' confirm-icon-neutral'}">${ICONS.trash()}</div>
      <h2>${esc(opts.title || 'Вы уверены?')}</h2>
      ${opts.message ? `<div class="modal-sub">${esc(opts.message)}</div>` : ''}
      <div class="error-text" data-confirm-err></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-confirm-cancel>${esc(opts.cancelText || 'Отмена')}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok>${esc(opts.confirmText || 'Удалить')}</button>
      </div>
    `, { overlayClass: 'confirm-modal' });

    const cancelBtn = overlay.querySelector('[data-confirm-cancel]');
    const okBtn = overlay.querySelector('[data-confirm-ok]');
    const errEl = overlay.querySelector('[data-confirm-err]');
    const okLabel = okBtn.textContent;

    cancelBtn.addEventListener('click', () => {
      Modal.close();
      if (opts.onCancel) opts.onCancel();
    });

    okBtn.addEventListener('click', async () => {
      if (!opts.onConfirm) { Modal.close(); return; }
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      okBtn.textContent = opts.pendingText || 'Удаление…';
      errEl.textContent = '';
      try {
        await opts.onConfirm();
        Modal.close();
      } catch (e) {
        errEl.textContent = e.message;
        okBtn.disabled = false;
        cancelBtn.disabled = false;
        okBtn.textContent = okLabel;
      }
    });

    return overlay;
  },

  _escHandler(e) {
    if (e.key === 'Escape') Modal.close();
  },
};
