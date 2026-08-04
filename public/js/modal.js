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

  _escHandler(e) {
    if (e.key === 'Escape') Modal.close();
  },
};
