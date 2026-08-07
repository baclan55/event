window.Sections = window.Sections || {};
window.Sections.dashboard = {
  async render(container) {
    let members = [], target = 5;
    try {
      const data = await api.get('/api/roster');
      members = data.members;
      target = data.target;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить данные</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    const withRole = members.filter((m) => m.role_id);
    const candidates = members.filter((m) => m.status === 'candidate');
    const withoutRole = members.length - withRole.length - candidates.length;

    // Топ-3 по присутствию на мероприятиях — считаем по счётчику
    // "мероприятий за неделю" (тот же показатель, что и в разделе «Состав»),
    // это единственная цифра присутствия, которую хранит портал.
    const top3 = [...members]
      .filter((m) => m.weekly_events > 0)
      .sort((a, b) => b.weekly_events - a.weekly_events)
      .slice(0, 3);

    const medal = ['🥇', '🥈', '🥉'];

    const topHTML = top3.length ? top3.map((m, i) => `
      <div class="top-row">
        <div class="top-rank">${medal[i] || i + 1}</div>
        ${avatarHTML(m.avatar_url || m.avatar_image_id, m.nickname, 38)}
        <div style="min-width:0;flex:1;">
          <div class="nickname">${esc(m.nickname)}</div>
          <div class="role-tag">${esc(m.role_name || 'Без роли')}</div>
        </div>
        <span class="badge ${m.weekly_events >= target ? 'badge-green' : 'badge-amber'}">${m.weekly_events} мп / нед.</span>
      </div>`).join('')
      : `<div class="empty-state"><h3>Пока нет данных</h3><p>Как только у сотрудников появятся мероприятия за неделю в «Составе», здесь будет рейтинг.</p></div>`;

    container.innerHTML = `
      <div class="stat-grid stat-grid-4">
        <div class="card card-pad stat-card">
          <div class="stat-value">${members.length}</div>
          <div class="stat-label">Всего людей в составе</div>
        </div>
        <div class="card card-pad stat-card">
          <div class="stat-value">${withRole.length}</div>
          <div class="stat-label">Людей с ролями</div>
        </div>
        <div class="card card-pad stat-card">
          <div class="stat-value">${withoutRole}</div>
          <div class="stat-label">Без роли</div>
        </div>
        <div class="card card-pad stat-card">
          <div class="stat-value">${candidates.length}</div>
          <div class="stat-label">Кандидатов</div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:20px;">
        <div class="card-header"><h3>Топ-3 по мероприятиям за неделю</h3></div>
        ${topHTML}
      </div>`;
  },
};
