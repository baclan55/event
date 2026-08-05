window.Sections = window.Sections || {};
window.Sections.roster = {
  async render(container) {
    let members = [], roles = [], target = 5;
    let activeTab = 'with'; // 'with' | 'without'
    try {
      const [rosterData, rolesData] = await Promise.all([
        api.get('/api/roster'),
        api.get('/api/roster/roles'),
      ]);
      members = rosterData.members;
      target = rosterData.target;
      roles = rolesData.roles;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить состав</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    paint();

    function eventsBadge(count) {
      const cls = count >= target ? 'badge-green' : 'badge-red';
      return `<span class="badge ${cls} events-count">${count} / нед.</span>`;
    }

    function memberRowHTML(m, admin) {
      const actions = admin ? (
        '<div class="row-actions">' +
          `<button type="button" class="icon-btn" data-edit="${m.id}" title="Редактировать">${ICONS.edit()}</button>` +
          `<button type="button" class="icon-btn danger" data-del="${m.id}" title="Удалить">${ICONS.trash()}</button>` +
        '</div>'
      ) : '';
      return `
        <div class="roster-row" data-id="${m.id}">
          <div class="who">
            ${avatarHTML(m.avatar_image_id, m.nickname, 38)}
            <div>
              <div class="nickname">${esc(m.nickname)}</div>
              <div class="role-tag">${esc(m.role_name || 'Без роли')}${m.discord_username ? ' · ' + esc(m.discord_username) : ''}</div>
            </div>
          </div>
          ${eventsBadge(m.weekly_events)}
          ${actions}
        </div>`;
    }

    function paint() {
      const admin = Auth.isAdmin();
      const withRole = members.filter((m) => m.role_id);
      const withoutRole = members.filter((m) => !m.role_id);
      const visible = activeTab === 'with' ? withRole : withoutRole;

      let listHTML;
      if (activeTab === 'with') {
        // Группируем по роли, сохраняя порядок приоритета (высшая -> низшая)
        const groups = [];
        const byRole = new Map();
        for (const m of withRole) {
          const key = m.role_id;
          if (!byRole.has(key)) {
            byRole.set(key, { label: m.role_name || 'Без роли', priority: m.role_priority ?? 999, items: [] });
            groups.push(byRole.get(key));
          }
          byRole.get(key).items.push(m);
        }
        groups.sort((a, b) => a.priority - b.priority);
        listHTML = groups.length
          ? groups.map((g) => `
              <div class="role-group-label">${esc(g.label)} · ${g.items.length}</div>
              ${g.items.map((m) => memberRowHTML(m, admin)).join('')}`).join('')
          : `<div class="empty-state"><h3>Никому ещё не назначена роль</h3><p>Назначьте роль участникам во вкладке «Без ролей».</p></div>`;
      } else {
        listHTML = withoutRole.length
          ? withoutRole.map((m) => memberRowHTML(m, admin)).join('')
          : `<div class="empty-state"><h3>Все участники с ролями</h3><p>Новых сотрудников без роли сейчас нет.</p></div>`;
      }

      container.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">${visible.length} ${activeTab === 'with' ? 'участников с ролями' : 'участников без роли'} · норма ${target}+ мероприятий в неделю</div>
          ${admin ? `<div class="toolbar-right"><button type="button" class="btn btn-primary btn-sm" id="addMemberBtn">${ICONS.plus()} Добавить участника</button></div>` : ''}
        </div>
        <div class="segmented" style="margin-bottom:18px;">
          <button type="button" data-tab="with" class="${activeTab === 'with' ? 'active' : ''}">С ролями · ${withRole.length}</button>
          <button type="button" data-tab="without" class="${activeTab === 'without' ? 'active' : ''}">Без ролей · ${withoutRole.length}</button>
        </div>
        ${listHTML}`;

      container.querySelector('#addMemberBtn')?.addEventListener('click', () => openEditModal(null));
      container.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => { activeTab = btn.dataset.tab; paint(); });
      });
      container.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => openEditModal(members.find((m) => String(m.id) === btn.dataset.edit)));
      });
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeMember(btn.dataset.del));
      });
    }

    function roleOptionsHTML(selectedId) {
      return `<option value="">Без роли</option>` + roles.map((r) =>
        `<option value="${r.id}" ${String(r.id) === String(selectedId) ? 'selected' : ''}>${esc(r.name)}</option>`
      ).join('');
    }

    function openEditModal(member) {
      const isNew = !member;
      const overlay = Modal.open(`
        <h2>${isNew ? 'Новый участник' : 'Редактирование участника'}</h2>
        <div class="error-text" id="memberErr"></div>
        <div class="field"><label>Никнейм</label><input class="input" id="mNickname" value="${escAttr(member ? member.nickname : '')}"></div>
        <div class="form-row-2">
          <div class="field"><label>Роль</label>
            <select class="input" id="mRole">${roleOptionsHTML(member ? member.role_id : '')}</select>
          </div>
          <div class="field"><label>Мероприятий за неделю</label>
            <input class="input" type="number" min="0" id="mEvents" value="${member ? member.weekly_events : 0}">
          </div>
        </div>
        <div class="field"><label>Заметка (необязательно)</label><textarea class="input" id="mNote" rows="3">${esc(member ? member.note || '' : '')}</textarea></div>
        <div class="field">
          <label>Аватар</label>
          ${member && member.avatar_image_id ? `<div style="margin-bottom:10px;">${avatarHTML(member.avatar_image_id, member.nickname, 56)}</div>` : ''}
          <input type="file" accept="image/*" id="mAvatar" class="input">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveMemberBtn">Сохранить</button>
        </div>`, { wide: true });

      overlay.querySelector('#saveMemberBtn').addEventListener('click', async () => {
        const nickname = overlay.querySelector('#mNickname').value.trim();
        const roleId = overlay.querySelector('#mRole').value || null;
        const weeklyEvents = overlay.querySelector('#mEvents').value;
        const note = overlay.querySelector('#mNote').value;
        const err = overlay.querySelector('#memberErr');
        try {
          let id = member ? member.id : null;
          if (isNew) {
            const res = await api.post('/api/roster', { nickname, roleId, weeklyEvents, note });
            id = res.id;
          } else {
            await api.put(`/api/roster/${id}`, { nickname, roleId, weeklyEvents, note });
          }
          const file = overlay.querySelector('#mAvatar').files[0];
          if (file) {
            const fd = new FormData();
            fd.append('image', file);
            await api.upload(`/api/roster/${id}/avatar`, fd);
          }
          Modal.close();
          reload();
        } catch (e) { err.textContent = e.message; }
      });
    }

    async function removeMember(id) {
      if (!confirm('Удалить этого участника из состава?')) return;
      try { await api.del(`/api/roster/${id}`); reload(); }
      catch (e) { alert(e.message); }
    }

    async function reload() {
      const data = await api.get('/api/roster');
      members = data.members;
      target = data.target;
      paint();
    }
  },
};
