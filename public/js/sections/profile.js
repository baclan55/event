window.Sections = window.Sections || {};
window.Sections.profile = {
  async render(container) {
    if (!Auth.currentUser) {
      container.innerHTML = `<div class="empty-state"><h3>Нужно войти</h3><p>Личная страница доступна только вошедшим сотрудникам.</p></div>`;
      return;
    }

    let user = Auth.currentUser;
    let reprimands = [];
    let tier = 'helper';
    // Дефолтные лимиты — на случай, если запрос ещё не вернулся; реальные
    // значения приходят с бэкенда вместе со списком (см. /api/reprimands/me).
    let limits = { helper: { verbal: 4, strict: 2 }, admin: { points: 3, decayDays: 10 } };

    try {
      // Подтягиваем свежие данные о себе (счётчик мероприятий мог измениться
      // после входа в кабинет) и свои выговоры отдельным self-service роутом —
      // обычный /api/reprimands виден только администраторам.
      const [meData, rpData] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/reprimands/me'),
      ]);
      user = meData.user;
      Auth.currentUser = user;
      reprimands = rpData.reprimands;
      limits = rpData.limits;
      tier = rpData.tier;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить страницу</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    const target = Auth.config.weeklyEventsTarget;
    const events = user.weeklyEvents || 0;
    const onTarget = events >= target;

    function typeBadge(e) {
      if (e.type === 'verbal') return `<span class="badge badge-purple">Устный</span>`;
      if (e.type === 'strict') return `<span class="badge badge-red">Строгий</span>`;
      return e.active
        ? `<span class="badge badge-amber">Балл</span>`
        : `<span class="badge badge-muted">Балл · списан</span>`;
    }

    function entryRowHTML(e) {
      let dateLine = formatDate(e.created_at);
      if (e.type === 'point') {
        dateLine += e.active
          ? ` · спишется ${formatDateOnly(e.expires_at)}`
          : ` · списан ${formatDateOnly(e.expires_at)}`;
      }
      return `
        <div class="roster-row rp-entry ${e.type === 'point' && !e.active ? 'rp-expired' : ''}">
          <div class="who">
            <div>
              <div class="nickname" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600;">
                ${typeBadge(e)}<span>${esc(e.reason)}</span>
              </div>
              <div class="role-tag">${dateLine}${e.issued_by_nickname ? ' · выдал ' + esc(e.issued_by_nickname) : ''}</div>
            </div>
          </div>
        </div>`;
    }

    function limitBadge(count, limit, label) {
      const cls = count >= limit ? 'badge-red' : 'badge-purple';
      return `<span class="badge ${cls}">${esc(label)}: ${count}/${limit}</span>`;
    }

    let summaryBadgesHTML, legendHTML;
    if (tier === 'admin') {
      const active = reprimands.filter((e) => e.type === 'point' && e.active);
      const nextExpiry = active.reduce((min, e) => (!min || e.expires_at < min ? e.expires_at : min), null);
      summaryBadgesHTML = limitBadge(active.length, limits.admin.points, 'Баллов') +
        (nextExpiry ? `<span class="badge badge-muted">ближайший спишется ${formatDateOnly(nextExpiry)}</span>` : '');
      legendHTML = `<div class="rp-legend">Максимум <b>${limits.admin.points} баллов</b>. Каждый балл автоматически перестаёт учитываться через <b>${limits.admin.decayDays} дней</b> после выдачи.</div>`;
    } else {
      const verbal = reprimands.filter((e) => e.type === 'verbal').length;
      const strict = reprimands.filter((e) => e.type === 'strict').length;
      summaryBadgesHTML = limitBadge(verbal, limits.helper.verbal, 'Устных') + limitBadge(strict, limits.helper.strict, 'Строгих');
      legendHTML = `<div class="rp-legend">Максимум <b>${limits.helper.strict} строгих</b> и <b>${limits.helper.verbal} устных</b> выговора. Они <b>не снимаются</b> по времени.</div>`;
    }

    const entriesHTML = reprimands.length
      ? reprimands.map(entryRowHTML).join('')
      : `<div class="empty-state"><h3>Выговоров нет</h3><p>Записей о дисциплинарных взысканиях на вас нет.</p></div>`;

    container.innerHTML = `
      <div class="card card-pad" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
        ${avatarHTML(user.avatarImageId, user.nickname, 64)}
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="font-size:19px;font-weight:800;color:var(--text-heading);">${esc(user.nickname)}</div>
            <button type="button" class="icon-btn" id="editNicknameBtn" title="Изменить никнейм">${ICONS.edit()}</button>
          </div>
          <div class="role-tag" style="font-size:12.5px;margin-top:2px;">${esc(user.roleName || 'Без роли')}${user.discordUsername ? ' · ' + esc(user.discordUsername) : ''}</div>
        </div>
        <div style="text-align:right;">
          <div class="stat-value" style="font-size:28px;">${events}</div>
          <div class="stat-label">мп за неделю</div>
          <div style="margin-top:8px;"><span class="badge ${onTarget ? 'badge-green' : 'badge-red'}">${onTarget ? 'норма выполнена' : `ниже нормы · цель ${target}`}</span></div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:20px;">
        <div class="card-header">
          <h3>Мои выговоры</h3>
          <div class="rp-group-badges">${summaryBadgesHTML}</div>
        </div>
        ${legendHTML}
        <div class="rp-group-entries">${entriesHTML}</div>
      </div>`;

    container.querySelector('#editNicknameBtn').addEventListener('click', openEditNicknameModal);

    // -----------------------------------------------------------------
    // Смена собственного никнейма — доступна любому сотруднику для самого
    // себя (не меняет роль/права/счётчики, только nickname).
    // -----------------------------------------------------------------
    function openEditNicknameModal() {
      const overlay = Modal.open(`
        <h2>Изменить никнейм</h2>
        <div class="error-text" id="nickErr"></div>
        <div class="field"><label>Никнейм</label><input class="input" id="nickInput" value="${escAttr(user.nickname)}" maxlength="60"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveNickBtn">Сохранить</button>
        </div>`);

      const input = overlay.querySelector('#nickInput');
      input.focus();
      input.select();

      overlay.querySelector('#saveNickBtn').addEventListener('click', async () => {
        const nickname = input.value.trim();
        const err = overlay.querySelector('#nickErr');
        if (!nickname) { err.textContent = 'Введите никнейм.'; return; }
        try {
          const { user: updated } = await api.put('/api/auth/me/nickname', { nickname });
          Auth.currentUser = updated;
          user = updated;
          Modal.close();
          // Никнейм показывается ещё в сайдбаре и в виджете аккаунта наверху —
          // обновляем их точечно, не перестраивая всю страницу.
          document.querySelectorAll('.sidebar-user-name').forEach((el) => { el.textContent = updated.nickname; });
          document.querySelectorAll('#accountWidget .name').forEach((el) => { el.textContent = updated.nickname; });
          window.Sections.profile.render(container);
        } catch (e) { err.textContent = e.message; }
      });
    }
  },
};
