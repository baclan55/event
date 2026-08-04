window.Sections = window.Sections || {};
window.Sections.reprimands = {
  async render(container) {
    if (!Auth.isAdmin()) {
      container.innerHTML = `<div class="empty-state"><h3>Доступ ограничен</h3><p>Раздел виден администраторам и владельцу отдела.</p></div>`;
      return;
    }

    let items = [], members = [];
    try {
      const [rpData, rosterData] = await Promise.all([
        api.get('/api/reprimands'),
        api.get('/api/roster'),
      ]);
      items = rpData.reprimands;
      members = rosterData.members;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить выговоры</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    paint();

    function paint() {
      const listHTML = items.length ? items.map((r) => `
        <div class="roster-row" data-id="${r.id}">
          <div class="who">
            ${avatarHTML(null, r.user_nickname, 38)}
            <div>
              <div class="nickname">${esc(r.user_nickname)}</div>
              <div class="role-tag">${esc(r.reason)}</div>
            </div>
          </div>
          <div class="meta-line" style="margin-top:0;white-space:nowrap;">
            ${formatDate(r.created_at)}${r.issued_by_nickname ? ' · ' + esc(r.issued_by_nickname) : ''}
          </div>
          <div class="row-actions">
            <button type="button" class="icon-btn danger" data-del="${r.id}" title="Удалить">${ICONS.trash()}</button>
          </div>
        </div>`).join('')
        : `<div class="empty-state"><h3>Выговоров нет</h3><p>Учёт дисциплинарных взысканий сотрудников отдела.</p></div>`;

      container.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">${items.length} записей</div>
          <div class="toolbar-right"><button type="button" class="btn btn-primary btn-sm" id="addBtn">${ICONS.plus()} Добавить выговор</button></div>
        </div>
        ${listHTML}`;

      container.querySelector('#addBtn').addEventListener('click', openAddModal);
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeItem(btn.dataset.del));
      });
    }

    function openAddModal() {
      const overlay = Modal.open(`
        <h2>Новый выговор</h2>
        <div class="error-text" id="rpErr"></div>
        <div class="field"><label>Сотрудник</label>
          <select class="input" id="rpUser">
            ${members.map((m) => `<option value="${m.id}">${esc(m.nickname)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Причина</label><textarea class="input" id="rpReason" rows="4" placeholder="Опишите причину выговора"></textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveRpBtn">Добавить</button>
        </div>`);

      overlay.querySelector('#saveRpBtn').addEventListener('click', async () => {
        const userId = overlay.querySelector('#rpUser').value;
        const reason = overlay.querySelector('#rpReason').value.trim();
        const err = overlay.querySelector('#rpErr');
        try {
          await api.post('/api/reprimands', { userId, reason });
          Modal.close();
          reload();
        } catch (e) { err.textContent = e.message; }
      });
    }

    async function removeItem(id) {
      if (!confirm('Удалить эту запись?')) return;
      try { await api.del(`/api/reprimands/${id}`); reload(); }
      catch (e) { alert(e.message); }
    }

    async function reload() {
      const data = await api.get('/api/reprimands');
      items = data.reprimands;
      paint();
    }
  },
};
