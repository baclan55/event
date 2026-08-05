const Auth = {
  currentUser: null,
  config: { appTitle: 'Event Department', appSubtitle: 'Внутренний портал', weeklyEventsTarget: 5, discordEnabled: false },

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

  openLoginModal(defaultTab) {
    let tab = defaultTab || 'login';

    function render() {
      return `
        <div class="auth-card">
          <div class="auth-seal-wrap"><div class="auth-seal"><span>ED</span></div></div>
          <h2 class="auth-title">Личный кабинет</h2>
          <div class="auth-sub">Вход для сотрудников ивент-отдела</div>
          ${Auth.config.discordEnabled
            ? `<button type="button" class="btn btn-discord" id="discordBtn">${ICONS.discord()} Войти через Discord</button>`
            : `<button type="button" class="btn btn-discord" id="discordBtn" style="opacity:.55;cursor:not-allowed;">${ICONS.discord()} Войти через Discord</button>`
          }
          <div class="auth-divider">или по логину и паролю</div>
          <div class="auth-tabs">
            <button type="button" class="auth-tab ${tab === 'login' ? 'active' : ''}" data-tab="login">Вход</button>
            <button type="button" class="auth-tab ${tab === 'register' ? 'active' : ''}" data-tab="register">Регистрация</button>
          </div>
          <div id="authFormMount"></div>
        </div>`;
    }

    function renderLoginForm() {
      return `
        <div class="error-text" id="authError"></div>
        <div class="field"><label>Логин</label><input class="input" id="loginLogin" autocomplete="username"></div>
        <div class="field"><label>Пароль</label><input class="input" type="password" id="loginPassword" autocomplete="current-password"></div>
        <button type="button" class="btn btn-primary btn-block" id="submitLogin">Войти</button>`;
    }

    function renderRegisterForm() {
      return `
        <div class="error-text" id="authError"></div>
        <div class="field"><label>Никнейм</label><input class="input" id="regNickname" autocomplete="nickname"></div>
        <div class="field"><label>Логин</label><input class="input" id="regLogin" autocomplete="username"></div>
        <div class="field"><label>Пароль</label><input class="input" type="password" id="regPassword" autocomplete="new-password"></div>
        <button type="button" class="btn btn-primary btn-block" id="submitRegister">Зарегистрироваться</button>`;
    }

    const overlay = Modal.open(render(), { overlayClass: 'auth-modal-overlay' });

    function mountForm() {
      const mount = overlay.querySelector('#authFormMount');
      mount.innerHTML = tab === 'login' ? renderLoginForm() : renderRegisterForm();
      overlay.querySelectorAll('.auth-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });

      if (tab === 'login') {
        const submit = async () => {
          const login = overlay.querySelector('#loginLogin').value.trim();
          const password = overlay.querySelector('#loginPassword').value;
          const errEl = overlay.querySelector('#authError');
          errEl.textContent = '';
          try {
            await api.post('/api/auth/login', { login, password });
            await Auth.bootstrap();
            Modal.close();
            App.renderShell();
            App.router();
          } catch (e) { errEl.textContent = e.message; }
        };
        overlay.querySelector('#submitLogin').addEventListener('click', submit);
        overlay.querySelector('#loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      } else {
        const submit = async () => {
          const nickname = overlay.querySelector('#regNickname').value.trim();
          const login = overlay.querySelector('#regLogin').value.trim();
          const password = overlay.querySelector('#regPassword').value;
          const errEl = overlay.querySelector('#authError');
          errEl.textContent = '';
          try {
            await api.post('/api/auth/register', { login, password, nickname });
            await Auth.bootstrap();
            Modal.close();
            App.renderShell();
            App.router();
          } catch (e) { errEl.textContent = e.message; }
        };
        overlay.querySelector('#submitRegister').addEventListener('click', submit);
        overlay.querySelector('#regPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      }
    }

    mountForm();

    overlay.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; mountForm(); });
    });

    overlay.querySelector('#discordBtn').addEventListener('click', () => {
      if (!Auth.config.discordEnabled) {
        const errBox = document.createElement('div');
        errBox.className = 'field-hint';
        errBox.style.textAlign = 'center';
        errBox.style.marginTop = '10px';
        errBox.textContent = 'Вход через Discord не настроен администратором сайта (см. README.md).';
        overlay.querySelector('.auth-card').appendChild(errBox);
        return;
      }
      window.location.href = '/api/auth/discord';
    });
  },

  async logout() {
    try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
    Auth.currentUser = null;
    App.renderShell();
    App.navigate('faq');
  },
};
