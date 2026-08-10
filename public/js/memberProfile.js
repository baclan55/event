// ============================================================================
// «Профиль сотрудника» — модалка, открываемая кликом по сотруднику в
// «Составе». Показывает карточку (аватар, роли, счётчик МП, блокировка) и
// полную историю его выговоров, с возможностью сразу выдать новый или
// удалить существующий — не открывая отдельно весь раздел «Система
// выговоров» и не фильтруя его вручную.
//
// Доступ — те же роли, что видят весь раздел «Система выговоров»
// (Auth.ROLE_GROUPS.reprimands на фронте / REPRIMANDS_ROLES на бэкенде, см.
// src/utils/roleAccess.js): Chief Event, Dep.Chief Event, Technical
// Administrator, Chief Event Helper, Dep.Chief Event Helper, Senior Event
// Helper. Проверка здесь — только для UX (не рисовать точку входа тем, кому
// всё равно откажет сервер); реальная защита — на бэкенде
// (GET /api/reprimands/user/:id, requireRoleIn(REPRIMANDS_ROLES)).
//
// Право ВЫДАТЬ выговор конкретному человеку (роль не выше своей) — как и в
// src/routes/reprimands.js — проверяется тут же на фронте только для UX
// (скрыть/задизейблить кнопку заранее), реальная защита всегда на сервере.
// ============================================================================
window.MemberProfile = {
  async open(userId) {
    if (!Auth.hasRoleIn(Auth.ROLE_GROUPS.reprimands)) return;

    const overlay = Modal.open(
      `<div id="mpBody"><div class="empty-state"><h3>Загрузка…</h3></div></div>`,
      { wide: true }
    );
    const body = overlay.querySelector('#mpBody');

    let data = null;

    async function load() {
      try {
        data = await api.get(`/api/reprimands/user/${userId}`);
        return true;
      } catch (e) {
        body.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить профиль</h3><p>${esc(e.message)}</p></div>`;
        return false;
      }
    }

    function myPriority() {
      return Auth.currentUser ? Auth.currentUser.rolePriority : null;
    }

    // Совпадает с правилом на бэкенде (POST /api/reprimands в
    // src/routes/reprimands.js): нельзя выдать выговор сотруднику с ролью
    // выше своей (число priority меньше); равная роль — можно; владелец —
    // исключение, может всегда.
    function canIssue() {
      if (Auth.currentUser && Auth.currentUser.isOwner) return true;
      const mine = myPriority();
      const target = data.user.role_priority;
      if (mine == null || target == null) return true;
      return target >= mine;
    }

    function limitBadge(count, limit, label) {
      const cls = count >= limit ? 'badge-red' : 'badge-purple';
      return `<span class="badge ${cls}">${esc(label)}: ${count}/${limit}</span>`;
    }

    function typeBadge(e) {
      if (e.type === 'verbal') {
        return e.converted
          ? `<span class="badge badge-muted">Устный · объединён</span>`
          : `<span class="badge badge-purple">Устный</span>`;
      }
      if (e.type === 'strict') {
        return e.auto_generated
          ? `<span class="badge badge-red">Строгий · авто</span>`
          : `<span class="badge badge-red">Строгий</span>`;
      }
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
      const dimmed = (e.type === 'point' && !e.active) || (e.type === 'verbal' && e.converted);
      return `
        <div class="roster-row rp-entry ${dimmed ? 'rp-expired' : ''}" data-id="${e.id}">
          <div class="who">
            <div>
              <div class="nickname" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600;">
                ${typeBadge(e)}<span>${esc(e.reason)}</span>
              </div>
              <div class="role-tag">${dateLine}${e.issued_by_nickname ? ' · выдал ' + esc(e.issued_by_nickname) : ''}</div>
            </div>
          </div>
          <div class="row-actions">
            <button type="button" class="icon-btn danger" data-del="${e.id}" title="Удалить">${ICONS.trash()}</button>
          </div>
        </div>`;
    }

    function renderProfile() {
      const u = data.user;
      const tier = data.tier;
      const limits = data.limits;
      const items = data.reprimands;

      let summaryBadgesHTML, legendHTML;
      if (tier === 'admin') {
        const active = items.filter((e) => e.type === 'point' && e.active);
        const nextExpiry = active.reduce((min, e) => (!min || e.expires_at < min ? e.expires_at : min), null);
        summaryBadgesHTML = limitBadge(active.length, limits.admin.points, 'Баллов') +
          (nextExpiry ? `<span class="badge badge-muted">ближайший спишется ${formatDateOnly(nextExpiry)}</span>` : '');
        legendHTML = `<div class="rp-legend">Максимум <b>${limits.admin.points} баллов</b> — при достижении учётная запись блокируется автоматически. Каждый балл автоматически перестаёт учитываться через <b>${limits.admin.decayDays} дней</b> после выдачи.</div>`;
      } else {
        const verbalActive = items.filter((e) => e.type === 'verbal' && !e.converted).length;
        const verbalConverted = items.filter((e) => e.type === 'verbal' && e.converted).length;
        const strict = items.filter((e) => e.type === 'strict').length;
        const points = verbalActive * limits.helper.verbalPoints + strict * limits.helper.strictPoints;
        summaryBadgesHTML = limitBadge(points, limits.helper.blockPoints, 'Баллы') +
          `<span class="badge badge-muted">Устных: ${verbalActive}${verbalConverted ? ` (+${verbalConverted} объединено)` : ''}</span>` +
          `<span class="badge badge-muted">Строгих: ${strict}</span>`;
        legendHTML = `<div class="rp-legend">Устный = <b>${limits.helper.verbalPoints} балл</b>, строгий = <b>${limits.helper.strictPoints} балла</b>. При <b>${limits.helper.blockPoints} баллах</b> учётная запись блокируется автоматически (не удаляется, история сохраняется). Каждые <b>${limits.helper.verbalToStrict} непогашенных устных</b> автоматически объединяются в 1 строгий.</div>`;
      }

      const entriesHTML = items.length
        ? items.map(entryRowHTML).join('')
        : `<div class="empty-state"><h3>Выговоров нет</h3><p>У сотрудника нет дисциплинарных записей.</p></div>`;

      const blockedBadge = u.is_blocked
        ? `<span class="badge badge-red" title="${u.blocked_at ? 'с ' + esc(formatDate(u.blocked_at)) : ''}">${ICONS.lock()}Заблокирован</span>`
        : '';

      const eligible = !u.is_blocked && canIssue();
      let addTitle = '';
      if (u.is_blocked) addTitle = 'Учётная запись заблокирована — сначала разблокируйте, чтобы выдать новый выговор.';
      else if (!eligible) addTitle = 'Нельзя выдать выговор сотруднику с ролью выше вашей.';

      const target = Auth.config.weeklyEventsTarget;
      const events = u.weekly_events || 0;
      const onTarget = events >= target;

      body.innerHTML = `
        <div class="card card-pad" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:20px;">
          ${avatarHTML(u.avatar_url || u.avatar_image_id, u.nickname, 64)}
          <div style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div style="font-size:19px;font-weight:800;color:var(--text-heading);">${esc(u.nickname)}</div>
              ${blockedBadge}
            </div>
            <div class="role-tag" style="font-size:12.5px;margin-top:2px;">${esc(u.roles && u.roles.length ? u.roles.map((r) => r.name).join(' · ') : 'Без роли')}${u.discord_username ? ' · ' + esc(u.discord_username) : ''}</div>
          </div>
          <div style="text-align:right;">
            <div class="stat-value" style="font-size:28px;">${events}</div>
            <div class="stat-label">мп за неделю</div>
            <div style="margin-top:8px;"><span class="badge ${onTarget ? 'badge-green' : 'badge-red'}">${onTarget ? 'норма выполнена' : `ниже нормы · цель ${target}`}</span></div>
          </div>
        </div>

        <div class="card-header">
          <h3>История выговоров</h3>
          <div class="rp-group-badges">${summaryBadgesHTML}</div>
        </div>
        ${legendHTML}
        <div class="modal-actions" style="justify-content:space-between;margin:16px 0 18px;">
          <div>${u.is_blocked ? `<button type="button" class="btn btn-ghost btn-sm" id="mpUnblockBtn">${ICONS.unlock()}Разблокировать</button>` : ''}</div>
          <button type="button" class="btn btn-primary btn-sm" id="mpAddBtn" ${eligible ? '' : 'disabled'} ${addTitle ? `title="${escAttr(addTitle)}"` : ''}>${ICONS.plus()} Добавить выговор</button>
        </div>
        <div class="rp-group-entries">${entriesHTML}</div>`;

      body.querySelector('#mpAddBtn')?.addEventListener('click', () => { if (eligible) renderAddForm(); });
      body.querySelector('#mpUnblockBtn')?.addEventListener('click', unblock);
      body.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeItem(btn.dataset.del));
      });
    }

    // -----------------------------------------------------------------
    // Форма выдачи выговора — тот же функционал, что в openAddModal раздела
    // «Система выговоров» (src/routes/reprimands.js -> POST '/'), но
    // сотрудник уже зафиксирован (это и есть удобство "прямо через
    // профиль") и рисуется в той же модалке вместо отдельного окна.
    // -----------------------------------------------------------------
    function renderAddForm() {
      const u = data.user;
      const tier = data.tier;
      const limits = data.limits;
      const items = data.reprimands;

      const verbalActive = items.filter((e) => e.type === 'verbal' && !e.converted).length;
      const strict = items.filter((e) => e.type === 'strict').length;
      const helperPoints = verbalActive * limits.helper.verbalPoints + strict * limits.helper.strictPoints;
      const adminPoints = items.filter((e) => e.type === 'point' && e.active).length;

      body.innerHTML = `
        <h2>Новый выговор</h2>
        <div class="modal-sub">${esc(u.nickname)} · ${tier === 'helper' ? 'Тир: Хелперы' : 'Тир: Администраторы'}</div>
        <div class="error-text" id="mpAddErr"></div>
        <div id="mpTypeArea"></div>
        <div class="field"><label>Причина</label><textarea class="input" id="mpReason" rows="4" placeholder="Опишите причину выговора"></textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="mpBackBtn">Назад</button>
          <button type="button" class="btn btn-primary" id="mpSaveBtn">Добавить</button>
        </div>`;

      const typeArea = body.querySelector('#mpTypeArea');
      const saveBtn = body.querySelector('#mpSaveBtn');

      if (tier === 'helper') {
        typeArea.innerHTML = `
          <div class="field"><label>Тип выговора</label>
            <select class="input" id="mpType">
              <option value="verbal">Устный (+${limits.helper.verbalPoints} балл)</option>
              <option value="strict">Строгий (+${limits.helper.strictPoints} балла)</option>
            </select>
          </div>
          <div class="field-hint" style="margin-bottom:16px;">
            Сейчас у сотрудника <b>${helperPoints} из ${limits.helper.blockPoints}</b> баллов
            (устных: ${verbalActive}, строгих: ${strict}).
            При достижении ${limits.helper.blockPoints} баллов учётная запись блокируется автоматически.
            ${verbalActive >= 1 ? `Если добавить ещё один устный — оба объединятся в 1 строгий автоматически.` : ''}
          </div>`;
      } else {
        const pointsLeft = limits.admin.points - adminPoints;
        const maxed = pointsLeft <= 0;
        typeArea.innerHTML = `
          <div class="field-hint" style="margin-bottom:16px;">
            ${maxed
              ? `<span style="color:var(--red);">Достигнут максимум баллов (${limits.admin.points} из ${limits.admin.points}) — учётная запись уже должна быть заблокирована. Новый балл нельзя добавить, пока не спишется один из текущих (${limits.admin.decayDays} дней с момента выдачи) или не снимут блокировку.</span>`
              : `Будет добавлен 1 балл. Сейчас у сотрудника ${adminPoints} из ${limits.admin.points}. При достижении ${limits.admin.points} учётная запись блокируется автоматически. Балл автоматически перестанет учитываться через ${limits.admin.decayDays} дней после выдачи.`}
          </div>`;
        saveBtn.disabled = maxed;
      }

      body.querySelector('#mpBackBtn').addEventListener('click', renderProfile);

      saveBtn.addEventListener('click', async () => {
        const reason = body.querySelector('#mpReason').value.trim();
        const err = body.querySelector('#mpAddErr');
        if (!reason) { err.textContent = 'Укажите причину выговора.'; return; }
        const payload = { userId, reason };
        if (tier === 'helper') payload.type = body.querySelector('#mpType').value;
        saveBtn.disabled = true;
        try {
          const result = await api.post('/api/reprimands', payload);
          if (await load()) renderProfile();
          if (result && result.blocked) {
            alert('У сотрудника набран максимум баллов — учётная запись автоматически заблокирована. История выговоров сохранена, разблокировать можно кнопкой в карточке сотрудника.');
          }
        } catch (e) {
          err.textContent = e.message;
          saveBtn.disabled = false;
        }
      });
    }

    function removeItem(id) {
      Modal.confirm({
        title: 'Удалить эту запись?',
        message: 'Действие нельзя отменить. Если это автоматический строгий (объединение 2 устных), устные снова станут активными.',
        confirmText: 'Удалить',
        onConfirm: async () => {
          await api.del(`/api/reprimands/${id}`);
          // Modal.confirm — отдельная модалка (Modal хранит только одно
          // окно за раз), после успешного onConfirm она закрывает сама
          // себя. Открываем профиль заново уже после этого (setTimeout,
          // чтобы сработать ПОСЛЕ синхронного Modal.close() внутри Modal.confirm).
          setTimeout(() => window.MemberProfile.open(userId), 0);
        },
      });
    }

    function unblock() {
      Modal.confirm({
        title: 'Разблокировать сотрудника?',
        message: 'Учётная запись снова получит доступ к личному кабинету. История выговоров не меняется и не удаляется.',
        confirmText: 'Разблокировать',
        pendingText: 'Разблокировка…',
        danger: false,
        onConfirm: async () => {
          await api.post(`/api/reprimands/users/${userId}/unblock`, {});
          setTimeout(() => window.MemberProfile.open(userId), 0);
        },
      });
    }

    if (await load()) renderProfile();
  },
};
