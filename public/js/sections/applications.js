window.Sections = window.Sections || {};
window.Sections.applications = {
  async render(container) {
    // Подача заявки теперь происходит на публичной странице «Оставить
    // заявку» (без входа) — здесь только рассмотрение администрацией.
    if (!App.hasRole(ACCESS.APPLICATIONS_ROLES)) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Доступ ограничен</h3>
          <p>Раздел рассмотрения заявок виден только определённым ролям.</p>
        </div>`;
      return;
    }

    let items = [];
    try {
      const data = await api.get('/api/applications');
      items = data.applications;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить заявки</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    // 'main' — все заявки на рассмотрении/решённые, 'candidates' — одобренные
    // заявки, ожидающие результата обзвона (см. Sections.roster — те же люди
    // видны там во вкладке «Кандидаты»).
    let activeTab = 'main';
    paint();

    function field(label, value) {
      if (!value) return '';
      return `<div><span style="color:var(--text-faint);">${esc(label)}:</span> ${esc(value)}</div>`;
    }

    function mainCardHTML(a) {
      const canApprove = a.status !== 'call_passed' && a.status !== 'approved';
      const canReject = a.status !== 'rejected' && a.status !== 'call_passed';
      return `
        <div class="rule-card" data-id="${a.id}">
          <div class="rule-body">
            <h4>${esc(a.nickname_static || 'Без имени')} ${statusBadge(a.status)}</h4>
            <div class="rule-text" style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
              ${field('Discord', a.discord)}
              ${field('Возраст', a.age)}
              ${field('Среднесуточный онлайн', a.avg_online)}
              ${field('Промежуток времени в игре', a.time_period)}
            </div>
            <div class="rule-text"><b>Опыт:</b> ${esc(a.experience)}</div>
            <div class="rule-text" style="margin-top:8px;"><b>Идеи по мероприятиям:</b> ${esc(a.ideas)}</div>
            <div class="rule-text" style="margin-top:8px;"><b>Почему именно они:</b> ${esc(a.motivation)}</div>
            <div class="meta-line">
              ${formatDate(a.created_at)}
              ${a.reviewed_by_nickname ? ' · рассмотрел ' + esc(a.reviewed_by_nickname) : ''}
            </div>
          </div>
          <div class="rule-actions" style="flex-direction:column;gap:6px;align-items:stretch;">
            ${canApprove ? `<button type="button" class="btn btn-ghost btn-sm" data-approve="${a.id}">Одобрить</button>` : ''}
            ${canReject ? `<button type="button" class="btn btn-ghost btn-sm" data-reject="${a.id}">Отклонить</button>` : ''}
            <button type="button" class="btn btn-danger btn-sm" data-del="${a.id}">Удалить</button>
          </div>
        </div>`;
    }

    function candidateCardHTML(a) {
      return `
        <div class="rule-card" data-id="${a.id}">
          <div class="rule-body">
            <div class="who" style="margin-bottom:8px;">
              ${avatarHTML(a.candidate_avatar_image_id, a.candidate_nickname || a.nickname_static, 38)}
              <div>
                <div class="nickname">${esc(a.candidate_nickname || a.nickname_static || 'Без имени')}</div>
                <div class="role-tag">Discord: ${esc(a.discord || '—')}</div>
              </div>
            </div>
            <div class="meta-line">
              Одобрено ${formatDate(a.created_at)}
              ${a.reviewed_by_nickname ? ' · ' + esc(a.reviewed_by_nickname) : ''}
            </div>
          </div>
          <div class="rule-actions" style="flex-direction:column;gap:6px;align-items:stretch;">
            <button type="button" class="btn btn-primary btn-sm" data-call-pass="${a.id}">Прошёл обзвон</button>
            <button type="button" class="btn btn-danger btn-sm" data-call-fail="${a.id}">Не прошёл обзвон</button>
          </div>
        </div>`;
    }

    function tabsHTML(mainCount, candidatesCount) {
      return `
        <div class="segmented roster-tabs">
          <button type="button" data-tab="main" class="${activeTab === 'main' ? 'active' : ''}">Заявки · ${mainCount}</button>
          <button type="button" data-tab="candidates" class="${activeTab === 'candidates' ? 'active' : ''}">Кандидаты · ${candidatesCount}</button>
        </div>`;
    }

    function paint() {
      const candidates = items.filter((a) => a.status === 'approved');
      const main = items.filter((a) => a.status !== 'approved');

      let bodyHTML;
      if (activeTab === 'candidates') {
        bodyHTML = candidates.length
          ? `<div class="rp-legend">После обзвона кандидат либо получает роль <b>Mini Event Helper</b> и попадает в «Состав», либо снимается с рассмотрения.</div>${candidates.map(candidateCardHTML).join('')}`
          : `<div class="empty-state"><h3>Кандидатов нет</h3><p>Они появляются здесь после того, как вы одобрите заявку во вкладке «Заявки».</p></div>`;
      } else {
        bodyHTML = main.length
          ? main.map(mainCardHTML).join('')
          : `<div class="empty-state"><h3>Заявок нет</h3><p>Здесь появятся заявки на роль Event Helper с публичной формы сайта.</p></div>`;
      }

      container.innerHTML = `
        <div class="toolbar"><div class="toolbar-left">${items.length} заявок всего</div></div>
        ${tabsHTML(main.length, candidates.length)}
        ${bodyHTML}`;

      container.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => { activeTab = btn.dataset.tab; paint(); });
      });
      container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.approve, 'approved')));
      container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.reject, 'rejected')));
      container.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => removeItem(btn.dataset.del)));
      container.querySelectorAll('[data-call-pass]').forEach((btn) => btn.addEventListener('click', () => setCall(btn.dataset.callPass, true)));
      container.querySelectorAll('[data-call-fail]').forEach((btn) => btn.addEventListener('click', () => setCall(btn.dataset.callFail, false)));
    }

    async function setStatus(id, status) {
      try { await api.put(`/api/applications/${id}`, { status }); reload(); }
      catch (e) { alert(e.message); }
    }
    async function setCall(id, passed) {
      const msg = passed
        ? 'Отметить, что кандидат прошёл обзвон? Ему будет назначена роль Mini Event Helper.'
        : 'Отметить, что кандидат не прошёл обзвон? Он будет снят с рассмотрения.';
      if (!confirm(msg)) return;
      try { await api.post(`/api/applications/${id}/call`, { passed }); reload(); }
      catch (e) { alert(e.message); }
    }
    async function removeItem(id) {
      Modal.confirm({
        title: 'Удалить заявку?',
        message: 'Действие нельзя отменить.',
        confirmText: 'Удалить',
        onConfirm: async () => { await api.del(`/api/applications/${id}`); reload(); },
      });
    }
    async function reload() {
      const data = await api.get('/api/applications');
      items = data.applications;
      paint();
    }
  },
};
