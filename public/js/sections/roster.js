window.Sections = window.Sections || {};
window.Sections.roster = {
  async render(container) {
    let members = [], roles = [], target = 5;
    try {
      const rosterData = await api.get('/api/roster');
      members = rosterData.members;
      target = rosterData.target;
      roles = rosterData.roles || [];
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
      // Те же роли, что видят раздел «Система выговоров» (см.
      // src/utils/roleAccess.js -> REPRIMANDS_ROLES), дополнительно могут
      // открыть профиль сотрудника прямо из «Состава» — удобно посмотреть
      // историю его выговоров и сразу выдать новый, не уходя в общий раздел
      // (см. public/js/memberProfile.js).
      const canOpenProfile = Auth.hasRoleIn(Auth.ROLE_GROUPS.reprimands);

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
        const blockedBadge = m.is_blocked ? `<span class="badge badge-red">${ICONS.lock()}Заблокирован</span>` : '';
        return `
          <div class="roster-row" data-id="${m.id}">
            <div class="who${canOpenProfile ? ' who-clickable' : ''}"${canOpenProfile ? ` data-profile="${m.id}" role="button" tabindex="0" title="Открыть профиль"` : ''}>
              ${avatarHTML(m.avatar_url || m.avatar_image_id, m.nickname, 38)}
              <div>
                <div class="nickname">${esc(m.nickname)}</div>
                <div class="role-tag">${esc(m.roles && m.roles.length ? m.roles.map((r) => r.name).join(' · ') : 'Без роли')}${m.discord_username ? ' · ' + esc(m.discord_username) : ''}</div>
              </div>
            </div>
            ${blockedBadge}
            ${eventsBadge(m.weekly_events)}
            ${actions}
          </div>`;
      }

      // Кандидаты пока ничего не решают в "Составе" — статус (прошёл/не
      // прошёл обзвон) выставляется в отдельном разделе "Кандидаты",
      // отсюда просто ссылка-подсказка.
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
          ? `<div class="rp-legend">Решение по обзвону — в разделе «Кандидаты».</div>${candidates.map(candidateRowHTML).join('')}`
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
      container.querySelectorAll('[data-profile]').forEach((el) => {
        el.addEventListener('click', () => MemberProfile.open(el.dataset.profile));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); MemberProfile.open(el.dataset.profile); }
        });
      });
      container.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.edit;
          // Подтягиваем свежие данные перед открытием формы редактирования.
          // Если вкладка "Состав" была открыта давно (например, ещё до
          // последнего деплоя, или пока бот успел начислить новые МП),
          // members в памяти браузера мог устареть. Сохранение формы с
          // устаревшим числом в поле "Мероприятий за неделю" затёрло бы
          // актуальный счётчик в базе (см. PUT /api/roster/:id) — то есть
          // выглядело бы как "счётчик МП сбросился" после самого обычного
          // редактирования, например смены роли или исправления ника.
          try {
            const data = await api.get('/api/roster');
            members = data.members;
            target = data.target;
          } catch (e) { /* сеть подвела — откроем форму с тем, что уже есть */ }
          openEditModal(members.find((m) => String(m.id) === id));
        });
      });
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeMember(btn.dataset.del));
      });
    }

    function roleCheckboxesHTML(selectedIds) {
      const selected = new Set((selectedIds || []).map(String));
      return roles.map((r) =>
        `<label class="role-check-item">
          <input type="checkbox" value="${r.id}" ${selected.has(String(r.id)) ? 'checked' : ''}>
          <span>${esc(r.name)}</span>
        </label>`
      ).join('');
    }

    function openEditModal(member) {
      const isNew = !member;
      const overlay = Modal.open(`
        <h2>${isNew ? 'Новый участник' : 'Редактирование участника'}</h2>
        <div class="error-text" id="memberErr"></div>
        <div class="field"><label>Никнейм</label><input class="input" id="mNickname" value="${escAttr(member ? member.nickname : '')}"></div>
        <div class="form-row-2">
          <div class="field"><label>Роли (можно выбрать несколько)</label>
            <div class="role-checklist" id="mRoles">${roleCheckboxesHTML(member ? (member.roles || []).map((r) => r.id) : [])}</div>
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
        const roleIds = Array.from(overlay.querySelectorAll('#mRoles input[type="checkbox"]:checked')).map((cb) => cb.value);
        const weeklyEvents = overlay.querySelector('#mEvents').value;
        const note = overlay.querySelector('#mNote').value;
        const err = overlay.querySelector('#memberErr');
        try {
          let id = member ? member.id : null;
          if (isNew) {
            const res = await api.post('/api/roster', { nickname, roleIds, weeklyEvents, note });
            id = res.id;
          } else {
            await api.put(`/api/roster/${id}`, { nickname, roleIds, weeklyEvents, note });
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
