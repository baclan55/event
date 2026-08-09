window.Sections = window.Sections || {};
window.Sections.applications = {
  async render(container) {
    // Подача заявки теперь происходит на публичной странице «Оставить
    // заявку» (без входа) — здесь только рассмотрение администрацией.
    if (!Auth.hasRoleIn(Auth.ROLE_GROUPS.applications)) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Доступ ограничен</h3>
          <p>Раздел рассмотрения заявок виден только определённым ролям отдела.</p>
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

    // Одобренные заявки (кандидаты, ожидающие обзвона) теперь обзваниваются
    // из отдельного раздела «Кандидаты» (доступного шире — см.
    // Sections.candidates), но здесь по-прежнему видны — вместе со всеми
    // остальными заявками — на случай, если решение по ним нужно
    // пересмотреть (отклонить/удалить) до звонка.
    function paint() {
      const bodyHTML = items.length
        ? items.map(mainCardHTML).join('')
        : `<div class="empty-state"><h3>Заявок нет</h3><p>Здесь появятся заявки на роль Event Helper с публичной формы сайта.</p></div>`;

      container.innerHTML = `
        <div class="toolbar"><div class="toolbar-left">${items.length} заявок всего</div></div>
        ${bodyHTML}`;

      container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.approve, 'approved')));
      container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.reject, 'rejected')));
      container.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => removeItem(btn.dataset.del)));
    }

    async function setStatus(id, status) {
      try { await api.put(`/api/applications/${id}`, { status }); reload(); }
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
