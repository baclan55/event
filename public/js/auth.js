const Auth = {
  currentUser: null,
  config: { appTitle: 'Events Denver', appSubtitle: 'Ивент-отдел сервера', weeklyEventsTarget: 5, discordEnabled: false },

  // Настройка доступа к узким разделам личного кабинета по названию роли —
  // должна буквально совпадать с src/utils/roleAccess.js на бэкенде (это
  // лишь для UI: сайдбар/переходы, реальная проверка всегда на сервере).
  ROLE_GROUPS: {
    reprimands: ['Chief Event Helper', 'Dep.Chief Event Helper', 'Senior Event Helper', 'Chief Event', 'Dep.Chief Event', 'Technical Administrator'],
    applications: ['Chief Event Helper', 'Dep.Chief Event Helper', 'Chief Event', 'Dep.Chief Event', 'Technical Administrator'],
    // Кандидаты, ожидающие обзвона — более узкий раздел, чем «Заявки»:
    // сюда дополнительно входит Senior Event Helper, но саму анкету заявки
    // (личные данные, одобрение/отклонение) он не видит — см.
    // src/utils/roleAccess.js -> CANDIDATES_ROLES на бэкенде.
    candidates: ['Chief Event Helper', 'Dep.Chief Event Helper', 'Senior Event Helper', 'Chief Event', 'Dep.Chief Event', 'Technical Administrator'],
    owner: ['Chief Event', 'Dep.Chief Event', 'Technical Administrator'],
    // Рассмотрение заявок на отпуск (одобрить/отклонить) — только эти три
    // роли; сам раздел "Отпуска" общий для всех с ролью (см. App.navItems в
    // app.js — у пункта 'vacations' нет `roles`). Совпадает с
    // src/utils/roleAccess.js -> VACATIONS_REVIEW_ROLES на бэкенде.
    vacationsReview: ['Chief Event Helper', 'Chief Event', 'Dep.Chief Event'],
    // Редактирование контента (FAQ/Регламент/Правила МП/Первые шаги/Состав) —
    // совпадает с src/utils/roleAccess.js -> EDIT_ROLES на бэкенде.
    edit: ['Chief Event', 'Dep.Chief Event', 'Technical Administrator'],
  },

  async bootstrap() {
    const [configResult, meResult] = await Promise.allSettled([
      api.get('/api/config'),
      api.get('/api/auth/me'),
    ]);
    if (configResult.status === 'fulfilled') Auth.config = configResult.value;
    if (meResult.status === 'fulfilled') {
      Auth.currentUser = meResult.value.user;
    } else {
      Auth.currentUser = null;
    }
  },

  isAdmin() { return !!(Auth.currentUser && (Auth.currentUser.isAdmin || Auth.currentUser.isOwner)); },
  isOwner() { return !!(Auth.currentUser && Auth.currentUser.isOwner); },

  // Граница тира "администраторы" по priority роли — должна совпадать с
  // ADMIN_TIER_MAX_PRIORITY в src/utils/tier.js на бэкенде. Используется
  // только для UI (например, скрыть вкладку "Event Administrator" в
  // FAQ/Регламенте для тира "хелперы") — реальная защита данных всегда на
  // сервере (см. src/routes/content.js).
  ADMIN_TIER_MAX_PRIORITY: 5,
  isAdminTier() {
    if (!Auth.currentUser) return false;
    if (Auth.currentUser.isOwner) return true;
    const p = Auth.currentUser.rolePriority;
    return p != null && p <= Auth.ADMIN_TIER_MAX_PRIORITY;
  },

  // Есть ли у пользователя хоть какая-то назначенная роль — от этого зависит,
  // виден ли личный кабинет вообще (сотрудники "Без роли" не видят ничего,
  // кроме публичного сайта, пока администратор не назначит роль в «Составе»).
  hasRole() {
    return !!(Auth.currentUser && (Auth.currentUser.roleId || Auth.currentUser.isOwner));
  },

  // Есть ли у пользователя одна из перечисленных ролей (владелец — всегда).
  // Сотрудник может иметь сразу несколько ролей (см. user_roles на
  // бэкенде) — доступ даёт ЛЮБАЯ из них, попавшая в список.
  hasRoleIn(roles) {
    if (!Auth.currentUser) return false;
    if (Auth.currentUser.isOwner) return true;
    const names = Auth.currentUser.roles && Auth.currentUser.roles.length
      ? Auth.currentUser.roles
      : (Auth.currentUser.roleName ? [Auth.currentUser.roleName] : []);
    return names.some((n) => roles.includes(n));
  },

  // Вход в личный кабинет — только через Discord. Первый вход одновременно
  // является регистрацией аккаунта, поэтому согласие на обработку
  // персональных данных запрашивается прямо здесь, перед переходом в Discord.
  openLoginModal() {
    const overlay = Modal.open(`
      <div class="auth-card">
        <div class="auth-seal-wrap"><div class="auth-seal"><span>ED</span></div></div>
        <h2 class="auth-title">Личный кабинет</h2>
        <div class="auth-sub">Вход для сотрудников ивент-отдела</div>
        <p style="text-align:center;color:var(--text-muted);font-size:12.5px;margin:0 0 16px;">
          Регистрация и вход выполняются только через ваш аккаунт Discord.
        </p>
        <label class="qform-check-label" for="consentCheck">
          <input type="checkbox" id="consentCheck">
          <span>Я даю согласие на обработку моих персональных данных (Discord ID, никнейм, аватар), указанных в личном кабинете, в соответствии с законодательством РФ, Украины, Казахстана и Беларуси о персональных данных.<span class="qform-required">*</span></span>
        </label>
        ${Auth.config.discordEnabled
          ? `<button type="button" class="btn btn-discord" id="discordBtn" disabled>${ICONS.discord()} Войти через Discord</button>`
          : `<button type="button" class="btn btn-discord" id="discordBtn" style="opacity:.55;cursor:not-allowed;">${ICONS.discord()} Войти через Discord</button>`
        }
        <div id="discordNote" class="field-hint" style="text-align:center;margin-top:12px;"></div>
      </div>`, { overlayClass: 'auth-modal-overlay' });

    const consentEl = overlay.querySelector('#consentCheck');
    const discordBtn = overlay.querySelector('#discordBtn');

    // Кнопка активна только когда согласие отмечено (если вход через
    // Discord вообще настроен на сервере — иначе кнопка и так неактивна,
    // но клик по ней по-прежнему объясняет причину, см. ниже).
    if (Auth.config.discordEnabled) {
      consentEl.addEventListener('change', () => { discordBtn.disabled = !consentEl.checked; });
    }

    discordBtn.addEventListener('click', () => {
      if (!Auth.config.discordEnabled) {
        overlay.querySelector('#discordNote').textContent =
          'Вход через Discord не настроен администратором сайта (см. README.md).';
        return;
      }
      if (!consentEl.checked) return;
      window.location.href = '/api/auth/discord?consent=1';
    });
  },

  async logout() {
    try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
    Auth.currentUser = null;
    App.navigate('home');
  },
};
