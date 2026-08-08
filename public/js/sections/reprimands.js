window.Sections = window.Sections || {};
window.Sections.reprimands = {
  async render(container) {
    if (!Auth.hasRoleIn(Auth.ROLE_GROUPS.reprimands)) {
      container.innerHTML = `<div class="empty-state"><h3>Доступ ограничен</h3><p>Раздел виден только определённым ролям отдела.</p></div>`;
      return;
    }

    // Дефолтные лимиты — на случай, если запрос ещё не вернулся; реальные
    // значения приходят с бэкенда вместе со списком (см. /api/reprimands).
    let items = [], members = [];
    let limits = {
      helper: { verbalPoints: 1, strictPoints: 2, blockPoints: 4, verbalToStrict: 2 },
      admin: { points: 3, decayDays: 10 },
    };
    try {
      const [rpData, rosterData] = await Promise.all([
        api.get('/api/reprimands'),
        api.get('/api/roster'),
      ]);
      items = rpData.reprimands;
      limits = rpData.limits;
      members = rosterData.members;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить выговоры</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    let activeTab = 'helper'; // 'helper' | 'admin'

    // Общее правило: нельзя выдать выговор сотруднику с ролью выше своей
    // (число priority меньше — см. src/db/seed.js) — то же самое
    // проверяется на бэкенде в src/routes/reprimands.js. Дублируем на
    // фронте только для UX (скрыть недоступные цели/кнопку заранее);
    // реальная защита — на сервере.
    function myPriority() {
      return Auth.currentUser ? Auth.currentUser.rolePriority : null;
    }
    function canIssueTo(m) {
      if (Auth.currentUser && Auth.currentUser.isOwner) return true;
      const mine = myPriority();
      if (mine == null || m.role_priority == null) return true;
      return m.role_priority >= mine;
    }
    // Есть ли хоть одна доступная цель среди сотрудников тира — используется,
    // чтобы решить, показывать ли кнопку "Добавить выговор" активной на
    // вкладке этого тира.
    function tabHasEligibleTarget(tier) {
      return members.some((m) => m.tier === tier && !m.is_blocked && canIssueTo(m));
    }

    paint();

    // -----------------------------------------------------------------
    // Группировка записей по сотруднику внутри выбранного тира
    // -----------------------------------------------------------------
    function buildGroups(tier) {
      const map = new Map();
      for (const it of items) {
        if (it.tier !== tier) continue;
        if (!map.has(it.user_id)) {
          map.set(it.user_id, {
            user_id: it.user_id,
            nickname: it.user_nickname,
            avatar: it.avatar_url || it.avatar_image_id,
            role: it.role_name,
            isBlocked: it.is_blocked,
            blockedAt: it.blocked_at,
            entries: [],
          });
        }
        map.get(it.user_id).entries.push(it);
      }
      return [...map.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru'));
    }

    // Баллы хелпера: непогашенный (не объединённый) устный = verbalPoints,
    // строгий (в т.ч. автоматический) = strictPoints. Объединённые устные
    // остаются в истории, но в баллах уже не участвуют.
    function helperSummary(entries) {
      const verbalActive = entries.filter((e) => e.type === 'verbal' && !e.converted).length;
      const verbalConverted = entries.filter((e) => e.type === 'verbal' && e.converted).length;
      const strict = entries.filter((e) => e.type === 'strict').length;
      const points = verbalActive * limits.helper.verbalPoints + strict * limits.helper.strictPoints;
      return { verbalActive, verbalConverted, strict, points };
    }

    function adminSummary(entries) {
      const active = entries.filter((e) => e.type === 'point' && e.active);
      const nextExpiry = active.reduce((min, e) => (!min || e.expires_at < min ? e.expires_at : min), null);
      return { points: active.length, nextExpiry };
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

    function groupHTML(g, tier) {
      const summary = tier === 'helper' ? helperSummary(g.entries) : adminSummary(g.entries);
      const badgesHTML = tier === 'helper'
        ? limitBadge(summary.points, limits.helper.blockPoints, 'Баллы') +
          `<span class="badge badge-muted">Устных: ${summary.verbalActive}${summary.verbalConverted ? ` (+${summary.verbalConverted} объединено)` : ''}</span>` +
          `<span class="badge badge-muted">Строгих: ${summary.strict}</span>`
        : limitBadge(summary.points, limits.admin.points, 'Баллов') +
          (summary.nextExpiry ? `<span class="badge badge-muted">ближайший спишется ${formatDateOnly(summary.nextExpiry)}</span>` : '');

      const blockedBadgeHTML = g.isBlocked
        ? `<span class="badge badge-red" title="${g.blockedAt ? 'с ' + esc(formatDate(g.blockedAt)) : ''}">${ICONS.lock()}Заблокирован</span>`
        : '';
      const unblockBtnHTML = g.isBlocked
        ? `<button type="button" class="btn btn-ghost btn-sm" data-unblock="${g.user_id}">${ICONS.unlock()}Разблокировать</button>`
        : '';

      return `
        <div class="rp-group">
          <div class="rp-group-head">
            <div class="who">
              ${avatarHTML(g.avatar, g.nickname, 34)}
              <div>
                <div class="nickname" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${esc(g.nickname)}${blockedBadgeHTML}</div>
                <div class="role-tag">${esc(g.role || 'Без роли')}</div>
              </div>
            </div>
            <div class="rp-group-badges">${badgesHTML}${unblockBtnHTML}</div>
          </div>
          <div class="rp-group-entries">${g.entries.map(entryRowHTML).join('')}</div>
        </div>`;
    }

    function tabsHTML() {
      const helperCount = items.filter((i) => i.tier === 'helper').length;
      const adminCount = items.filter((i) => i.tier === 'admin').length;
      return `
        <div class="segmented roster-tabs">
          <button type="button" data-tab="helper" class="${activeTab === 'helper' ? 'active' : ''}">Хелперы · ${helperCount}</button>
          <button type="button" data-tab="admin" class="${activeTab === 'admin' ? 'active' : ''}">Администраторы · ${adminCount}</button>
        </div>`;
    }

    function legendHTML() {
      return activeTab === 'helper'
        ? `<div class="rp-legend">Устный = <b>${limits.helper.verbalPoints} балл</b>, строгий = <b>${limits.helper.strictPoints} балла</b>. При <b>${limits.helper.blockPoints} баллах</b> учётная запись блокируется автоматически (не удаляется, история сохраняется). Каждые <b>${limits.helper.verbalToStrict} непогашенных устных</b> автоматически объединяются в 1 строгий.</div>`
        : `<div class="rp-legend">Максимум <b>${limits.admin.points} баллов</b> на администратора — при достижении учётная запись тоже блокируется автоматически (не удаляется). Каждый балл автоматически перестаёт учитываться через <b>${limits.admin.decayDays} дней</b> после выдачи.</div>`;
    }

    function paint() {
      const groups = buildGroups(activeTab);
      const bodyHTML = groups.length
        ? groups.map((g) => groupHTML(g, activeTab)).join('')
        : `<div class="empty-state"><h3>Выговоров нет</h3><p>${activeTab === 'helper' ? 'У хелперов пока нет выговоров.' : 'У администраторов пока нет баллов.'}</p></div>`;

      const addBlocked = !tabHasEligibleTarget(activeTab);
      container.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">${items.length} записей всего</div>
          <div class="toolbar-right">
            <button type="button" class="btn btn-primary btn-sm" id="addBtn" ${addBlocked ? 'disabled' : ''}
              ${addBlocked ? 'title="Нельзя выдать выговор сотруднику с ролью выше вашей."' : ''}
            >${ICONS.plus()} Добавить выговор</button>
          </div>
        </div>
        ${tabsHTML()}
        ${addBlocked ? `<div class="rp-legend">Вы не можете выдавать выговоры сотрудникам с ролью выше вашей — среди доступных на этой вкладке подходящих целей нет.</div>` : ''}
        ${legendHTML()}
        ${bodyHTML}`;

      container.querySelector('#addBtn').addEventListener('click', () => openAddModal(activeTab));
      container.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => { activeTab = btn.dataset.tab; paint(); });
      });
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeItem(btn.dataset.del));
      });
      container.querySelectorAll('[data-unblock]').forEach((btn) => {
        btn.addEventListener('click', () => unblockMember(btn.dataset.unblock));
      });
    }

    // -----------------------------------------------------------------
    // Модалка добавления — форма адаптируется под тир вкладки, с которой
    // её открыли: у хелперов выбор устный/строгий с текущими баллами, у
    // администраторов — сразу балл, с проверкой лимита. Заблокированных
    // сотрудников в списке нет — им новые выговоры недоступны, пока
    // блокировка не снята (см. кнопку "Разблокировать" в группе).
    // -----------------------------------------------------------------
    function openAddModal(tier) {
      const tierMembers = members.filter((m) => m.tier === tier && !m.is_blocked && canIssueTo(m));
      if (!tierMembers.length) {
        alert('Нет доступных целей: либо в составе нет сотрудников этого тира (или все заблокированы), либо у всех роль выше вашей.');
        return;
      }

      const overlay = Modal.open(`
        <h2>Новый выговор</h2>
        <div class="modal-sub">${tier === 'helper' ? 'Тир: Хелперы' : 'Тир: Администраторы'}</div>
        <div class="error-text" id="rpErr"></div>
        <div class="field"><label>Сотрудник</label>
          <select class="input" id="rpUser">
            ${tierMembers.map((m) => `<option value="${m.id}">${esc(m.nickname)}${m.role_name ? ' — ' + esc(m.role_name) : ' — без роли'}</option>`).join('')}
          </select>
        </div>
        <div id="rpTypeArea"></div>
        <div class="field"><label>Причина</label><textarea class="input" id="rpReason" rows="4" placeholder="Опишите причину выговора"></textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveRpBtn">Добавить</button>
        </div>`);

      const userSelect = overlay.querySelector('#rpUser');
      const typeArea = overlay.querySelector('#rpTypeArea');
      const saveBtn = overlay.querySelector('#saveRpBtn');

      function currentCounts(userId) {
        const own = items.filter((it) => String(it.user_id) === String(userId));
        if (tier === 'helper') {
          const verbalActive = own.filter((e) => e.type === 'verbal' && !e.converted).length;
          const strict = own.filter((e) => e.type === 'strict').length;
          const points = verbalActive * limits.helper.verbalPoints + strict * limits.helper.strictPoints;
          return { verbalActive, strict, points };
        }
        return { points: own.filter((e) => e.type === 'point' && e.active).length };
      }

      function paintTypeArea() {
        const counts = currentCounts(userSelect.value);

        if (tier === 'helper') {
          typeArea.innerHTML = `
            <div class="field"><label>Тип выговора</label>
              <select class="input" id="rpType">
                <option value="verbal">Устный (+${limits.helper.verbalPoints} балл)</option>
                <option value="strict">Строгий (+${limits.helper.strictPoints} балла)</option>
              </select>
            </div>
            <div class="field-hint" style="margin-bottom:16px;">
              Сейчас у сотрудника <b>${counts.points} из ${limits.helper.blockPoints}</b> баллов
              (устных: ${counts.verbalActive}, строгих: ${counts.strict}).
              При достижении ${limits.helper.blockPoints} баллов учётная запись блокируется автоматически.
              ${counts.verbalActive >= 1 ? `Если добавить ещё один устный — оба объединятся в 1 строгий автоматически.` : ''}
            </div>`;
          saveBtn.disabled = false;
          saveBtn.title = '';
        } else {
          const pointsLeft = limits.admin.points - counts.points;
          const maxed = pointsLeft <= 0;
          typeArea.innerHTML = `
            <div class="field-hint" style="margin-bottom:16px;">
              ${maxed
                ? `<span style="color:var(--red);">Достигнут максимум баллов (${limits.admin.points} из ${limits.admin.points}) — учётная запись уже должна быть заблокирована. Новый балл нельзя добавить, пока не спишется один из текущих (${limits.admin.decayDays} дней с момента выдачи) или не снимут блокировку.</span>`
                : `Будет добавлен 1 балл. Сейчас у сотрудника ${counts.points} из ${limits.admin.points}. При достижении ${limits.admin.points} учётная запись блокируется автоматически. Балл автоматически перестанет учитываться через ${limits.admin.decayDays} дней после выдачи.`}
            </div>`;
          saveBtn.disabled = maxed;
        }
      }

      userSelect.addEventListener('change', paintTypeArea);
      paintTypeArea();

      saveBtn.addEventListener('click', async () => {
        const userId = userSelect.value;
        const reason = overlay.querySelector('#rpReason').value.trim();
        const err = overlay.querySelector('#rpErr');
        if (!reason) { err.textContent = 'Укажите причину выговора.'; return; }
        const payload = { userId, reason };
        if (tier === 'helper') payload.type = overlay.querySelector('#rpType').value;
        try {
          const result = await api.post('/api/reprimands', payload);
          Modal.close();
          await reload();
          if (result && result.blocked) {
            alert('У сотрудника набран максимум баллов — учётная запись автоматически заблокирована. История выговоров сохранена, разблокировать можно кнопкой в карточке сотрудника.');
          }
        } catch (e) { err.textContent = e.message; }
      });
    }

    async function removeItem(id) {
      Modal.confirm({
        title: 'Удалить эту запись?',
        message: 'Действие нельзя отменить. Если это автоматический строгий (объединение 2 устных), устные снова станут активными.',
        confirmText: 'Удалить',
        onConfirm: async () => { await api.del(`/api/reprimands/${id}`); reload(); },
      });
    }

    async function unblockMember(userId) {
      Modal.confirm({
        title: 'Разблокировать сотрудника?',
        message: 'Учётная запись снова получит доступ к личному кабинету. История выговоров не меняется и не удаляется.',
        confirmText: 'Разблокировать',
        pendingText: 'Разблокировка…',
        danger: false,
        onConfirm: async () => { await api.post(`/api/reprimands/users/${userId}/unblock`, {}); reload(); },
      });
    }

    async function reload() {
      const [rpData, rosterData] = await Promise.all([
        api.get('/api/reprimands'),
        api.get('/api/roster'),
      ]);
      items = rpData.reprimands;
      limits = rpData.limits;
      members = rosterData.members;
      paint();
    }
  },
};
