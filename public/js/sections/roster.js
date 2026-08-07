window.Sections = window.Sections || {};
window.Sections.roster = {
  async render(container) {
    let members = [], roles = [], target = 5;
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

    let activeTab = 'with'; // 'with' — С ролями, 'without' — Без ролей, 'candidates' — Кандидаты
    paint();

    function eventsBadge(count) {
      const cls = count >= target ? 'badge-green' : 'badge-red';
      return `<span class="badge ${cls} events-count">${count} / нед.</span>`;
    }

    function tabsHTML(withCount, withoutCount, candidatesCount) {
      return `
        <div class="segmented roster-tabs">
          <button type="button" data-tab="with" class="${activeTab === 'with' ? 'active' : ''}">С ролями · ${withCount}</button>
          <button type="button" data-tab="without" class="${activeTab === 'without' ? 'active' : ''}">Без ролей · ${withoutCount}</button>
          <button type="button" data-tab="candidates" class="${activeTab === 'candidates' ? 'active' : ''}">Кандидаты · ${candidatesCount}</button>
        </div>`;
    }

    function paint() {
      const admin = Auth.hasRoleIn(Auth.ROLE_GROUPS.edit);

      // Кандидаты (одобренные заявки, ждущие обзвона) — отдельная категория:
      // у них тоже нет role_id, но их не показываем во вкладке "Без ролей",
      // чтобы не путать с обычными сотрудниками без роли.
      const candidates = members.filter((m) => m.status === 'candidate');
      const withoutRole = members.filter((m) => !m.role_id && m.status !== 'candidate');
      const withRole = members.filter((m) => m.role_id);

      // Группируем участников с ролями по роли, сохраняя порядок приоритета
      // (высшая -> низшая). Участники без роли показываются отдельной вкладкой.
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

      function memberRowHTML(m) {
        const actions = admin ? (
          '<div class="row-actions">' +
            `<button type="button" class="icon-btn" data-edit="${m.id}" title="Редактировать">${ICONS.edit()}</button>` +
            `<button type="button" class="icon-btn danger" data-del="${m.id}" title="Удалить">${ICONS.trash()}</button>` +
          '</div>'
        ) : '';
        return `
          <div class="roster-row" data-id="${m.id}">
            <div class="who">
              ${avatarHTML(m.avatar_url || m.avatar_image_id, m.nickname, 38)}
              <div>
                <div class="nickname">${esc(m.nickname)}</div>
                <div class="role-tag">${esc(m.role_name || 'Без роли')}${m.discord_username ? ' · ' + esc(m.discord_username) : ''}</div>
              </div>
            </div>
            ${eventsBadge(m.weekly_events)}
            ${actions}
          </div>`;
      }

      // Кандидаты пока ничего не решают в "Составе" — статус (прошёл/не
      // прошёл обзвон) выставляется в разделе "Заявки" → вкладка
      // "Кандидаты", отсюда просто ссылка-подсказка.
      function candidateRowHTML(m) {
        return `
          <div class="roster-row" data-id="${m.id}">
            <div class="who">
              ${avatarHTML(m.avatar_url || m.avatar_image_id, m.nickname, 38)}
              <div>
                <div class="nickname">${esc(m.nickname)}</div>
                <div class="role-tag">Кандидат${m.discord_username ? ' · ' + esc(m.discord_username) : ''}</div>
              </div>
            </div>
            <span class="badge badge-amber">Ожидает обзвона</span>
          </div>`;
      }

      function groupHTML(g) {
        return `
          <div class="role-group-label">${esc(g.label)} · ${g.items.length}</div>
          ${g.items.map(memberRowHTML).join('')}`;
      }

      let bodyHTML;
      if (activeTab === 'without') {
        bodyHTML = withoutRole.length
          ? withoutRole.map(memberRowHTML).join('')
          : `<div class="empty-state"><h3>Здесь никого нет</h3><p>Все участники состава уже с ролью.</p></div>`;
      } else if (activeTab === 'candidates') {
        bodyHTML = candidates.length
          ? `<div class="rp-legend">Решение по обзвону — в разделе «Заявки» → вкладка «Кандидаты».</div>${candidates.map(candidateRowHTML).join('')}`
          : `<div class="empty-state"><h3>Кандидатов нет</h3><p>Они появляются здесь после одобрения заявки в разделе «Заявки».</p></div>`;
      } else {
        bodyHTML = groups.length
          ? groups.map(groupHTML).join('')
          : `<div class="empty-state"><h3>Здесь никого нет</h3><p>Назначьте роль кому-нибудь из вкладки «Без ролей».</p></div>`;
      }

      container.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">${members.length} участников · норма ${target}+ мероприятий в неделю</div>
          ${admin ? `<div class="toolbar-right"><button type="button" class="btn btn-primary btn-sm" id="addMemberBtn">${ICONS.plus()} Добавить участника</button></div>` : ''}
        </div>
        ${tabsHTML(withRole.length, withoutRole.length, candidates.length)}
        ${bodyHTML}`;

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
          ${member && (member.avatar_url || member.avatar_image_id) ? `<div style="margin-bottom:10px;">${avatarHTML(member.avatar_url || member.avatar_image_id, member.nickname, 56)}</div>` : ''}
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
      Modal.confirm({
        title: 'Удалить этого участника из состава?',
        message: 'Действие нельзя отменить.',
        confirmText: 'Удалить',
        onConfirm: async () => { await api.del(`/api/roster/${id}`); reload(); },
      });
    }

    async function reload() {
      const data = await api.get('/api/roster');
      members = data.members;
      target = data.target;
      paint();
    }
  },
};
