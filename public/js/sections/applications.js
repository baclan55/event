window.Sections = window.Sections || {};
window.Sections.applications = {
  async render(container) {
    if (!Auth.currentUser) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Нужно войти</h3>
          <p>Чтобы подать заявку, войдите в личный кабинет.</p>
          <button type="button" class="btn btn-primary btn-sm" id="goLoginBtn" style="margin-top:14px;">Войти</button>
        </div>`;
      container.querySelector('#goLoginBtn').addEventListener('click', () => Auth.openLoginModal('login'));
      return;
    }

    if (Auth.isAdmin()) {
      return Sections.applications._renderAdmin(container);
    }
    return Sections.applications._renderForm(container);
  },

  _renderForm(container) {
    container.innerHTML = `
      <div class="card card-pad" style="max-width:520px;">
        <div class="card-header"><h3>Подать заявку</h3></div>
        <div class="error-text" id="appErr"></div>
        <div class="field"><label>Контакт (Discord, телефон и т.п.)</label><input class="input" id="appContact"></div>
        <div class="field"><label>Сообщение</label><textarea class="input" id="appMessage" rows="5" placeholder="Опишите суть заявки"></textarea></div>
        <button type="button" class="btn btn-primary" id="sendAppBtn">Отправить заявку</button>
        <div id="appSuccess" class="field-hint" style="color:var(--green);margin-top:10px;"></div>
      </div>`;

    container.querySelector('#sendAppBtn').addEventListener('click', async () => {
      const contact = container.querySelector('#appContact').value.trim();
      const message = container.querySelector('#appMessage').value.trim();
      const err = container.querySelector('#appErr');
      const ok = container.querySelector('#appSuccess');
      err.textContent = ''; ok.textContent = '';
      try {
        await api.post('/api/applications', { contact, message });
        ok.textContent = 'Заявка отправлена. Администратор рассмотрит её в ближайшее время.';
        container.querySelector('#appMessage').value = '';
      } catch (e) { err.textContent = e.message; }
    });
  },

  async _renderAdmin(container) {
    let items = [];
    try {
      const data = await api.get('/api/applications');
      items = data.applications;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить заявки</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    paint();

    function paint() {
      const listHTML = items.length ? items.map((a) => `
        <div class="rule-card" data-id="${a.id}">
          <div class="rule-body">
            <h4>${esc(a.applicant_name)} ${statusBadge(a.status)}</h4>
            <div class="rule-text">${esc(a.message)}</div>
            <div class="meta-line">
              ${a.contact ? 'Контакт: ' + esc(a.contact) + ' · ' : ''}${formatDate(a.created_at)}
              ${a.reviewed_by_nickname ? ' · рассмотрел ' + esc(a.reviewed_by_nickname) : ''}
            </div>
          </div>
          <div class="rule-actions" style="flex-direction:column;gap:6px;align-items:stretch;">
            ${a.status !== 'approved' ? `<button type="button" class="btn btn-ghost btn-sm" data-approve="${a.id}">Одобрить</button>` : ''}
            ${a.status !== 'rejected' ? `<button type="button" class="btn btn-ghost btn-sm" data-reject="${a.id}">Отклонить</button>` : ''}
            <button type="button" class="btn btn-danger btn-sm" data-del="${a.id}">Удалить</button>
          </div>
        </div>`).join('')
        : `<div class="empty-state"><h3>Заявок нет</h3><p>Здесь появятся заявки сотрудников.</p></div>`;

      container.innerHTML = `
        <div class="toolbar"><div class="toolbar-left">${items.length} заявок</div></div>
        ${listHTML}`;

      container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.approve, 'approved')));
      container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.reject, 'rejected')));
      container.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => removeItem(btn.dataset.del)));
    }

    async function setStatus(id, status) {
      try { await api.put(`/api/applications/${id}`, { status }); reload(); }
      catch (e) { alert(e.message); }
    }
    async function removeItem(id) {
      if (!confirm('Удалить заявку?')) return;
      try { await api.del(`/api/applications/${id}`); reload(); }
      catch (e) { alert(e.message); }
    }
    async function reload() {
      const data = await api.get('/api/applications');
      items = data.applications;
      paint();
    }
  },
};
