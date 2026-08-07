window.Sections = window.Sections || {};
window.Sections.owner = {
  async render(container) {
    if (!Auth.hasRoleIn(Auth.ROLE_GROUPS.owner)) {
      container.innerHTML = `<div class="empty-state"><h3>Доступ ограничен</h3><p>Раздел виден только ролям Chief Event и Dep.Chief Event.</p></div>`;
      return;
    }

    let users = [], roles = [];
    try {
      const [uData, rData] = await Promise.all([
        api.get('/api/owner/users'),
        api.get('/api/roster/roles'),
      ]);
      users = uData.users;
      roles = rData.roles;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить пользователей</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    paint();

    function paint() {
      const rowsHTML = users.map((u) => `
        <div class="roster-row" data-id="${u.id}">
          <div class="who">
            ${avatarHTML(null, u.nickname, 38)}
            <div>
              <div class="nickname">${esc(u.nickname)} ${u.is_owner ? '<span class="badge badge-purple">Владелец</span>' : ''} ${u.is_admin && !u.is_owner ? '<span class="badge badge-purple">Админ</span>' : ''}</div>
              <div class="role-tag">${esc(u.role_name || 'Без роли')}${u.discord_username ? ' · Discord: ' + esc(u.discord_username) : ''}</div>
            </div>
          </div>
          <div class="row-actions">
            <button type="button" class="icon-btn" data-edit="${u.id}" title="Редактировать">${ICONS.edit()}</button>
            <button type="button" class="icon-btn danger" data-del="${u.id}" title="Удалить">${ICONS.trash()}</button>
          </div>
        </div>`).join('');

      container.innerHTML = `
        <div class="toolbar"><div class="toolbar-left">${users.length} учётных записей</div></div>
        ${rowsHTML}`;

      container.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => openEditModal(users.find((u) => String(u.id) === btn.dataset.edit)));
      });
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeUser(btn.dataset.del));
      });
    }

    function roleOptionsHTML(selectedId) {
      return `<option value="">Без роли</option>` + roles.map((r) =>
        `<option value="${r.id}" ${String(r.id) === String(selectedId) ? 'selected' : ''}>${esc(r.name)}</option>`
      ).join('');
    }

    function openEditModal(user) {
      const overlay = Modal.open(`
        <h2>Редактирование пользователя</h2>
        <div class="error-text" id="uErr"></div>
        <div class="field"><label>Никнейм</label><input class="input" id="uNickname" value="${escAttr(user.nickname)}"></div>
        <div class="field"><label>Роль</label><select class="input" id="uRole">${roleOptionsHTML(user.role_id)}</select></div>
        <div class="field" style="display:flex;gap:20px;">
          <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;color:var(--text-body);">
            <input type="checkbox" id="uIsAdmin" ${user.is_admin ? 'checked' : ''}> Администратор (может редактировать разделы)
          </label>
        </div>
        <div class="field" style="display:flex;gap:20px;">
          <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;color:var(--text-body);">
            <input type="checkbox" id="uIsOwner" ${user.is_owner ? 'checked' : ''}> Владелец (полный доступ)
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveUserBtn">Сохранить</button>
        </div>`, { wide: true });

      overlay.querySelector('#saveUserBtn').addEventListener('click', async () => {
        const nickname = overlay.querySelector('#uNickname').value.trim();
        const roleId = overlay.querySelector('#uRole').value || null;
        const isAdmin = overlay.querySelector('#uIsAdmin').checked;
        const isOwner = overlay.querySelector('#uIsOwner').checked;
        const err = overlay.querySelector('#uErr');
        try {
          await api.put(`/api/owner/users/${user.id}`, { nickname, roleId, isAdmin, isOwner });
          Modal.close();
          reload();
        } catch (e) { err.textContent = e.message; }
      });
    }

    async function removeUser(id) {
      Modal.confirm({
        title: 'Удалить пользователя безвозвратно?',
        message: 'Учётную запись нельзя будет восстановить.',
        confirmText: 'Удалить',
        onConfirm: async () => { await api.del(`/api/owner/users/${id}`); reload(); },
      });
    }

    async function reload() {
      const data = await api.get('/api/owner/users');
      users = data.users;
      paint();
    }
  },
};
