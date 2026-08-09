window.Sections = window.Sections || {};
window.Sections.candidates = {
  async render(container) {
    // Раздел отдельный от «Заявки»: сюда дополнительно допущен Senior Event
    // Helper (см. Auth.ROLE_GROUPS.candidates / CANDIDATES_ROLES на
    // бэкенде), но саму анкету заявки он не видит — только то, что нужно
    // для звонка кандидату (см. GET /api/applications/candidates).
    if (!Auth.hasRoleIn(Auth.ROLE_GROUPS.candidates)) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Доступ ограничен</h3>
          <p>Раздел кандидатов на обзвон виден только определённым ролям отдела.</p>
        </div>`;
      return;
    }

    let items = [];
    try {
      const data = await api.get('/api/applications/candidates');
      items = data.candidates;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить кандидатов</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    paint();

    function candidateCardHTML(a) {
      return `
        <div class="rule-card" data-id="${a.id}">
          <div class="rule-body">
            <div class="who" style="margin-bottom:8px;">
              ${avatarHTML(a.candidate_avatar_url || a.candidate_avatar_image_id, a.candidate_nickname || a.nickname_static, 38)}
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

    function paint() {
      const bodyHTML = items.length
        ? `<div class="rp-legend">После обзвона кандидат либо получает роль <b>Mini Event Helper</b> и попадает в «Состав», либо снимается с рассмотрения.</div>${items.map(candidateCardHTML).join('')}`
        : `<div class="empty-state"><h3>Кандидатов нет</h3><p>Они появляются здесь после того, как заявку одобрят.</p></div>`;

      container.innerHTML = `
        <div class="toolbar"><div class="toolbar-left">${items.length} кандидатов ожидают обзвона</div></div>
        ${bodyHTML}`;

      container.querySelectorAll('[data-call-pass]').forEach((btn) => btn.addEventListener('click', () => setCall(btn.dataset.callPass, true)));
      container.querySelectorAll('[data-call-fail]').forEach((btn) => btn.addEventListener('click', () => setCall(btn.dataset.callFail, false)));
    }

    async function setCall(id, passed) {
      const msg = passed
        ? 'Отметить, что кандидат прошёл обзвон? Ему будет назначена роль Mini Event Helper.'
        : 'Отметить, что кандидат не прошёл обзвон? Он будет снят с рассмотрения.';
      if (!confirm(msg)) return;
      try { await api.post(`/api/applications/${id}/call`, { passed }); reload(); }
      catch (e) { alert(e.message); }
    }

    async function reload() {
      const data = await api.get('/api/applications/candidates');
      items = data.candidates;
      paint();
    }
  },
};
