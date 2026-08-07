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
    let limits = { helper: { verbal: 4, strict: 2 }, admin: { points: 3, decayDays: 10 } };
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

    // Роли с "Helper" в названии не могут выдавать выговоры сотрудникам с
    // ролью выше Chief Event Helper — то есть тиру "администраторы" (см.
    // ту же проверку на бэкенде в src/routes/reprimands.js). Дублируем на
    // фронте только для UX: реальная защита — на сервере.
    function isHelperRoleUser() {
      return !!(Auth.currentUser && !Auth.currentUser.isOwner &&
        Auth.currentUser.roleName && Auth.currentUser.roleName.includes('Helper'));
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
            entries: [],
          });
        }
        map.get(it.user_id).entries.push(it);
      }
      return [...map.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru'));
    }

    function helperSummary(entries) {
      return {
        verbal: entries.filter((e) => e.type === 'verbal').length,
        strict: entries.filter((e) => e.type === 'strict').length,
      };
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
        <div class="roster-row rp-entry ${e.type === 'point' && !e.active ? 'rp-expired' : ''}" data-id="${e.id}">
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
        ? limitBadge(summary.verbal, limits.helper.verbal, 'Устных') + limitBadge(summary.strict, limits.helper.strict, 'Строгих')
        : limitBadge(summary.points, limits.admin.points, 'Баллов') +
          (summary.nextExpiry ? `<span class="badge badge-muted">ближайший спишется ${formatDateOnly(summary.nextExpiry)}</span>` : '');

      return `
        <div class="rp-group">
          <div class="rp-group-head">
            <div class="who">
              ${avatarHTML(g.avatar, g.nickname, 34)}
              <div>
                <div class="nickname">${esc(g.nickname)}</div>
                <div class="role-tag">${esc(g.role || 'Без роли')}</div>
              </div>
            </div>
            <div class="rp-group-badges">${badgesHTML}</div>
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
        ? `<div class="rp-legend">Максимум <b>${limits.helper.strict} строгих</b> и <b>${limits.helper.verbal} устных</b> выговора на сотрудника. Они <b>не снимаются</b> по времени.</div>`
        : `<div class="rp-legend">Максимум <b>${limits.admin.points} баллов</b> на администратора. Каждый балл автоматически перестаёт учитываться через <b>${limits.admin.decayDays} дней</b> после выдачи.</div>`;
    }

    function paint() {
      const groups = buildGroups(activeTab);
      const bodyHTML = groups.length
        ? groups.map((g) => groupHTML(g, activeTab)).join('')
        : `<div class="empty-state"><h3>Выговоров нет</h3><p>${activeTab === 'helper' ? 'У хелперов пока нет выговоров.' : 'У администраторов пока нет баллов.'}</p></div>`;

      const addBlocked = activeTab === 'admin' && isHelperRoleUser();
      container.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">${items.length} записей всего</div>
          <div class="toolbar-right">
            <button type="button" class="btn btn-primary btn-sm" id="addBtn" ${addBlocked ? 'disabled' : ''}
              ${addBlocked ? 'title="Роли с \'Helper\' в названии не могут выдавать выговоры сотрудникам с ролью выше Chief Event Helper."' : ''}
            >${ICONS.plus()} Добавить выговор</button>
          </div>
        </div>
        ${tabsHTML()}
        ${addBlocked ? `<div class="rp-legend">Вашей роли недоступна выдача выговоров сотрудникам с ролью выше <b>Chief Event Helper</b>.</div>` : ''}
        ${legendHTML()}
        ${bodyHTML}`;

      container.querySelector('#addBtn').addEventListener('click', () => openAddModal(activeTab));
      container.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => { activeTab = btn.dataset.tab; paint(); });
      });
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', () => removeItem(btn.dataset.del));
      });
    }

    // -----------------------------------------------------------------
    // Модалка добавления — форма адаптируется под тир вкладки, с которой
    // её открыли: у хелперов выбор устный/строгий с остатком лимита, у
    // администраторов — сразу балл, с проверкой лимита.
    // -----------------------------------------------------------------
    function openAddModal(tier) {
      if (tier === 'admin' && isHelperRoleUser()) {
        alert('Роли с "Helper" в названии не могут выдавать выговоры сотрудникам с ролью выше Chief Event Helper.');
        return;
      }
      const tierMembers = members.filter((m) => m.tier === tier);
      if (!tierMembers.length) {
        alert(tier === 'helper'
          ? 'В составе нет сотрудников тира «Хелперы».'
          : 'В составе нет сотрудников тира «Администраторы».');
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
          return {
            verbal: own.filter((e) => e.type === 'verbal').length,
            strict: own.filter((e) => e.type === 'strict').length,
          };
        }
        return { points: own.filter((e) => e.type === 'point' && e.active).length };
      }

      function paintTypeArea() {
        const counts = currentCounts(userSelect.value);

        if (tier === 'helper') {
          const verbalLeft = limits.helper.verbal - counts.verbal;
          const strictLeft = limits.helper.strict - counts.strict;
          typeArea.innerHTML = `
            <div class="field"><label>Тип выговора</label>
              <select class="input" id="rpType">
                <option value="verbal" ${verbalLeft <= 0 ? 'disabled' : ''}>Устный (осталось ${Math.max(verbalLeft, 0)} из ${limits.helper.verbal})</option>
                <option value="strict" ${strictLeft <= 0 ? 'disabled' : ''}>Строгий (осталось ${Math.max(strictLeft, 0)} из ${limits.helper.strict})</option>
              </select>
            </div>`;
          const typeSelect = typeArea.querySelector('#rpType');
          if (verbalLeft <= 0 && strictLeft > 0) typeSelect.value = 'strict';
          const bothMaxed = verbalLeft <= 0 && strictLeft <= 0;
          saveBtn.disabled = bothMaxed;
          saveBtn.title = bothMaxed ? 'У сотрудника уже максимум и устных, и строгих выговоров' : '';
        } else {
          const pointsLeft = limits.admin.points - counts.points;
          const maxed = pointsLeft <= 0;
          typeArea.innerHTML = `
            <div class="field-hint" style="margin-bottom:16px;">
              ${maxed
                ? `<span style="color:var(--red);">Достигнут максимум баллов (${limits.admin.points} из ${limits.admin.points}). Новый нельзя добавить, пока не спишется один из текущих (${limits.admin.decayDays} дней с момента выдачи).</span>`
                : `Будет добавлен 1 балл. Сейчас у сотрудника ${counts.points} из ${limits.admin.points}. Балл автоматически перестанет учитываться через ${limits.admin.decayDays} дней после выдачи.`}
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
          await api.post('/api/reprimands', payload);
          Modal.close();
          reload();
        } catch (e) { err.textContent = e.message; }
      });
    }

    async function removeItem(id) {
      Modal.confirm({
        title: 'Удалить эту запись?',
        message: 'Действие нельзя отменить.',
        confirmText: 'Удалить',
        onConfirm: async () => { await api.del(`/api/reprimands/${id}`); reload(); },
      });
    }

    async function reload() {
      const data = await api.get('/api/reprimands');
      items = data.reprimands;
      limits = data.limits;
      paint();
    }
  },
};
