const Auth = {
  currentUser: null,
  config: { appTitle: 'Events Denver', appSubtitle: 'Ивент-отдел сервера', weeklyEventsTarget: 5, discordEnabled: false },

  async bootstrap() {
    try { Auth.config = await api.get('/api/config'); } catch (e) { /* используем значения по умолчанию */ }
    try {
      const { user } = await api.get('/api/auth/me');
      Auth.currentUser = user;
    } catch (e) {
      Auth.currentUser = null;
    }
  },

  isAdmin() { return !!(Auth.currentUser && (Auth.currentUser.isAdmin || Auth.currentUser.isOwner)); },
  isOwner() { return !!(Auth.currentUser && Auth.currentUser.isOwner); },

  // Вход в личный кабинет — только через Discord.
  openLoginModal() {
    const overlay = Modal.open(`
      <div class="auth-card">
        <div class="auth-seal-wrap"><div class="auth-seal"><span>ED</span></div></div>
        <h2 class="auth-title">Личный кабинет</h2>
        <div class="auth-sub">Вход для сотрудников ивент-отдела</div>
        <p style="text-align:center;color:var(--text-muted);font-size:12.5px;margin:0 0 20px;">
          Регистрация и вход выполняются только через ваш аккаунт Discord.
        </p>
        ${Auth.config.discordEnabled
          ? `<button type="button" class="btn btn-discord" id="discordBtn">${ICONS.discord()} Войти через Discord</button>`
          : `<button type="button" class="btn btn-discord" id="discordBtn" style="opacity:.55;cursor:not-allowed;">${ICONS.discord()} Войти через Discord</button>`
        }
        <div id="discordNote" class="field-hint" style="text-align:center;margin-top:12px;"></div>
      </div>`, { overlayClass: 'auth-modal-overlay' });

    overlay.querySelector('#discordBtn').addEventListener('click', () => {
      if (!Auth.config.discordEnabled) {
        overlay.querySelector('#discordNote').textContent =
          'Вход через Discord не настроен администратором сайта (см. README.md).';
        return;
      }
      window.location.href = '/api/auth/discord';
    });
  },

  async logout() {
    try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
    Auth.currentUser = null;
    App.navigate('home');
  },
};
