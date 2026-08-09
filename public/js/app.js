const App = {
  // Разделы личного кабинета (внутренний портал для сотрудников).
  // Разделы без поля `roles` — "общие": доступны любому сотруднику с
  // назначенной ролью (см. canAccessCabinet/canAccessItem ниже). Разделы с
  // `roles` — доступны только сотрудникам с одной из перечисленных ролей
  // (совпадает с Auth.ROLE_GROUPS / src/utils/roleAccess.js на бэкенде).
  navItems: [
    { key: 'profile', label: 'Моя страница', icon: 'user', title: 'Моя страница', sub: 'Ваши мероприятия за неделю и выговоры' },
    { key: 'faq', label: 'FAQ', icon: 'faq', title: 'FAQ', sub: 'Последовательность проведения мероприятий' },
    { key: 'roster', label: 'Состав', icon: 'roster', title: 'Состав', sub: 'Иерархия сотрудников и мероприятия за неделю' },
    { key: 'rules', label: 'Правила МП', icon: 'rules', title: 'Правила МП', sub: 'Правила проведения мероприятий и их суть' },
    { key: 'regulations', label: 'Регламент', icon: 'regulations', title: 'Регламент', sub: 'Регламент работы по ролям' },
    { key: 'firstSteps', label: 'Первые шаги', icon: 'firstSteps', title: 'Первые шаги', sub: 'С чего начать новому сотруднику' },
    { key: 'reprimands', label: 'Система выговоров', icon: 'reprimands', title: 'Система выговоров', sub: 'Учёт дисциплинарных взысканий', roles: Auth.ROLE_GROUPS.reprimands },
    { key: 'applications', label: 'Заявки', icon: 'applications', title: 'Заявки', sub: 'Заявки на роль Event Helper', roles: Auth.ROLE_GROUPS.applications },
    { key: 'candidates', label: 'Кандидаты', icon: 'candidates', title: 'Кандидаты', sub: 'Кандидаты, ожидающие результата обзвона', roles: Auth.ROLE_GROUPS.candidates },
  ],
  ownerItem: { key: 'owner', label: 'Панель владельца', icon: 'owner', title: 'Панель владельца', sub: 'Управление пользователями и правами', roles: Auth.ROLE_GROUPS.owner },
  // Вкладка "Главная" в личном кабинете — самая верхняя, сразу после ссылки
  // "На сайт". Отдельная от navItems, потому что рисуется в сайдбаре особо
  // (см. renderShell), а не в общем списке разделов.
  dashboardItem: { key: 'dashboard', label: 'Главная', icon: 'dashboard', title: 'Главная', sub: 'Обзор состава и присутствия на мероприятиях' },

  // Публичные страницы сайта (не требуют входа) — своя, более простая шапка.
  siteKeys: ['home', 'apply'],

  currentKey: 'home',

  // Личный кабинет целиком закрыт для сотрудников без роли — они не видят
  // ни одного раздела, пока администратор не назначит роль в «Составе».
  canAccessCabinet() {
    return Auth.hasRole();
  },

  canAccessItem(item) {
    if (!item || !App.canAccessCabinet()) return false;
    if (item.roles) return Auth.hasRoleIn(item.roles);
    return true;
  },

  visibleNavItems() {
    return App.navItems.filter((item) => App.canAccessItem(item));
  },

  findItem(key) {
    if (key === 'owner') return App.ownerItem;
    if (key === 'dashboard') return App.dashboardItem;
    return App.navItems.find((i) => i.key === key);
  },

  async init() {
    document.body.insertAdjacentHTML('afterbegin', '<div class="bg-decor"></div>');
    await Auth.bootstrap();
    window.addEventListener('hashchange', App.router);
    App.router();
  },

  navigate(key) { window.location.hash = '#/' + key; },

  router() {
    const hash = (window.location.hash || '#/home').replace('#/', '');

    if (App.siteKeys.includes(hash)) {
      App.currentKey = hash;
      App.renderSite(hash);
      return;
    }

    // Личный кабинет требует входа — не вошедших отправляем на главную
    // сайта вместо того, чтобы показывать им внутренние разделы.
    if (!Auth.currentUser) {
      window.location.hash = '#/home';
      return;
    }

    // Заблокированная учётная запись (см. система выговоров) не видит ни
    // одного раздела личного кабинета — сам аккаунт и вся история выговоров
    // при этом никуда не деваются, просто вход в кабинет закрыт до
    // разблокировки руководством отдела.
    if (Auth.currentUser.isBlocked) {
      App.currentKey = 'blocked';
      App.renderBlockedAccess();
      return;
    }

    // Сотрудники без роли не видят в личном кабинете ни одного раздела —
    // показываем отдельный экран "доступ появится после назначения роли"
    // вместо сайдбара с разделами.
    if (!App.canAccessCabinet()) {
      App.currentKey = 'pending';
      App.renderPendingAccess();
      return;
    }

    let item = App.findItem(hash);
    if (!App.canAccessItem(item)) {
      item = App.navItems.find((i) => App.canAccessItem(i));
    }
    App.currentKey = item.key;

    // Каркас личного кабинета (сайдбар) перестраивается только когда мы в
    // него заходим впервые (например, с публичного сайта) — переходы между
    // разделами внутри кабинета просто обновляют контент.
    if (!document.querySelector('.sidebar')) App.renderShell();

    App.renderTopbar(item);
    App.highlightNav(item.key);
    App.closeMobileSidebar();

    const mount = document.getElementById('content');
    mount.innerHTML = '<div class="empty-state">Загрузка…</div>';
    const section = window.Sections[item.key];
    if (section && typeof section.render === 'function') {
      section.render(mount);
    }
  },

  // Экран для вошедших сотрудников, у которых ещё нет ни одной роли —
  // видят только сообщение о том, что доступ откроется после назначения
  // роли, без сайдбара и разделов личного кабинета.
  renderPendingAccess() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="site">
        <header class="site-header">
          <div class="site-header-inner">
            <a href="#/home" class="site-brand">
              <span class="site-brand-mark">ED</span>
              <span class="site-brand-name">EVENTS DENVER</span>
            </a>
            <nav class="site-nav">
              <a href="#/home" class="site-nav-link">Главная</a>
              <button type="button" class="btn btn-ghost btn-sm" id="pendingLogoutBtn">Выйти</button>
            </nav>
          </div>
        </header>
        <main class="site-main">
          <div class="empty-state" style="max-width:480px;margin:64px auto;">
            <h3>Доступ пока закрыт</h3>
            <p>Личный кабинет открывается сотрудникам после того, как им назначат роль в «Составе». Обратитесь к руководству отдела — как только роль будет назначена, разделы личного кабинета станут доступны.</p>
          </div>
        </main>
      </div>`;
    document.getElementById('pendingLogoutBtn')?.addEventListener('click', Auth.logout);
  },

  // Экран для заблокированных сотрудников (см. система выговоров — учётная
  // запись блокируется автоматически при достижении максимума баллов).
  // Аккаунт и история выговоров сохраняются, просто личный кабинет закрыт
  // до разблокировки руководством отдела.
  renderBlockedAccess() {
    const app = document.getElementById('app');
    const blockedAt = Auth.currentUser.blockedAt ? formatDate(Auth.currentUser.blockedAt) : null;
    app.innerHTML = `
      <div class="site">
        <header class="site-header">
          <div class="site-header-inner">
            <a href="#/home" class="site-brand">
              <span class="site-brand-mark">ED</span>
              <span class="site-brand-name">EVENTS DENVER</span>
            </a>
            <nav class="site-nav">
              <a href="#/home" class="site-nav-link">Главная</a>
              <button type="button" class="btn btn-ghost btn-sm" id="blockedLogoutBtn">Выйти</button>
            </nav>
          </div>
        </header>
        <main class="site-main">
          <div class="empty-state" style="max-width:480px;margin:64px auto;">
            <div class="blocked-icon">${ICONS.lock()}</div>
            <h3>Учётная запись заблокирована</h3>
            <p>Личный кабинет закрыт — по системе выговоров у вас набран максимум баллов${blockedAt ? ` (блокировка с ${esc(blockedAt)})` : ''}. Аккаунт и вся история выговоров сохранены. Обратитесь к руководству отдела для разблокировки.</p>
          </div>
        </main>
      </div>`;
    document.getElementById('blockedLogoutBtn')?.addEventListener('click', Auth.logout);
  },

  highlightNav(key) {
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.key === key);
    });
  },

  renderTopbar(item) {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    bar.querySelector('#pageTitle').textContent = item.title;
    bar.querySelector('#pageSub').innerHTML =
      `${esc(item.sub)} <b>·</b> <b>${esc(Auth.config.appTitle)}</b>`;
  },

  closeMobileSidebar() {
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-scrim')?.classList.remove('show');
  },

  // ---------------------------------------------------------------------
  // Публичный сайт: Главная / Оставить заявку. Простая шапка со ссылкой
  // на Discord-сообщество и входом в личный кабинет.
  // ---------------------------------------------------------------------
  renderSite(key) {
    const app = document.getElementById('app');
    const loggedIn = !!Auth.currentUser;

    app.innerHTML = `
      <div class="site">
        <header class="site-header">
          <div class="site-header-inner">
            <a href="#/home" class="site-brand">
              <span class="site-brand-mark">ED</span>
              <span class="site-brand-name">EVENTS DENVER</span>
            </a>
            <nav class="site-nav">
              ${key !== 'home' ? `<a href="#/home" class="site-nav-link">Главная</a>` : ''}
              <a href="#/apply" class="site-nav-link ${key === 'apply' ? 'active' : ''}">Оставить заявку</a>
              <button type="button" class="btn btn-primary btn-sm" id="siteAccountBtn">
                ${loggedIn ? esc(Auth.currentUser.nickname) : 'Личный кабинет'}
              </button>
            </nav>
          </div>
        </header>
        <main class="site-main" id="siteMain"></main>
      </div>`;

    document.getElementById('siteAccountBtn').addEventListener('click', () => {
      if (Auth.currentUser) App.navigate('faq');
      else Auth.openLoginModal();
    });

    const mount = document.getElementById('siteMain');
    if (key === 'apply') Site.renderApply(mount);
    else Site.renderHome(mount);
  },

  // ---------------------------------------------------------------------
  // Личный кабинет: сайдбар + внутренние разделы портала.
  // ---------------------------------------------------------------------
  renderShell() {
    const user = Auth.currentUser;
    const app = document.getElementById('app');

    const navHTML = App.visibleNavItems().map((item) => `
      <button type="button" class="nav-item" data-key="${item.key}">
        ${ICONS[item.icon]()}<span>${esc(item.label)}</span>
      </button>`).join('');

    const ownerHTML = App.canAccessItem(App.ownerItem) ? `
      <div class="nav-group">
        <div class="nav-label">Владелец</div>
        <button type="button" class="nav-item" data-key="owner">
          ${ICONS.owner()}<span>${esc(App.ownerItem.label)}</span>
        </button>
      </div>` : '';

    const sidebarUserHTML = user ? `
      <div class="sidebar-user">
        ${avatarHTML(user.avatarUrl || user.avatarImageId, user.nickname, 34)}
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${esc(user.nickname)}</div>
          <div class="sidebar-user-role">${esc(user.roleName || 'Без роли')}</div>
        </div>
        <button type="button" class="icon-btn" id="logoutBtn" title="Выйти">${ICONS.logout()}</button>
      </div>` : `
      <button type="button" class="btn btn-primary btn-block sidebar-login-btn" id="sidebarLoginBtn">Войти</button>`;

    app.innerHTML = `
      <div class="sidebar-scrim"></div>
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">${ICONS.faq()}</div>
          <div class="brand-text">
            <div class="brand-title">Events</div>
            <div class="brand-sub">Denver · Department Portal</div>
          </div>
        </div>
        <a href="#/home" class="nav-item" style="margin-bottom:2px;">${ICONS.home()}<span>На сайт</span></a>
        <button type="button" class="nav-item" data-key="dashboard" style="margin-bottom:14px;">${ICONS.dashboard()}<span>${esc(App.dashboardItem.label)}</span></button>
        <nav class="nav-group">${navHTML}</nav>
        ${ownerHTML}
        <div class="sidebar-spacer"></div>
        ${sidebarUserHTML}
      </aside>
      <main class="main">
        <header class="topbar" id="topbar">
          <div class="topbar-titles" style="display:flex; align-items:center; gap:12px;">
            <button type="button" class="icon-btn menu-toggle" id="menuToggle">${ICONS.menu()}</button>
            <div>
              <h1 id="pageTitle">FAQ</h1>
              <div class="sub" id="pageSub"></div>
            </div>
          </div>
          ${App.accountWidgetHTML()}
        </header>
        <div class="content" id="content"></div>
      </main>`;

    app.querySelectorAll('.nav-item[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => App.navigate(btn.dataset.key));
    });
    document.getElementById('menuToggle')?.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('open');
      document.querySelector('.sidebar-scrim').classList.toggle('show');
    });
    document.querySelector('.sidebar-scrim')?.addEventListener('click', App.closeMobileSidebar);
    document.getElementById('logoutBtn')?.addEventListener('click', Auth.logout);
    document.getElementById('sidebarLoginBtn')?.addEventListener('click', () => Auth.openLoginModal());

    App.wireAccountWidget();
    App.highlightNav(App.currentKey);
    App.initTopbarAutoHide();
  },

  // ---------------------------------------------------------------------
  // Шапка раздела (.topbar) приклеена к верху (position:sticky), но при
  // прокрутке контента вниз уезжает наверх и освобождает место, а при
  // прокрутке вверх — даже на пару пикселей — мгновенно возвращается.
  // Рядом с самым верхом страницы всегда показывается, чтобы не дёргалась
  // от мелкого дрожания скролла. Слушатель вешаем один раз на renderShell
  // (сайдбар/топбар пересоздаются только при входе в кабинет заново — см.
  // комментарий в router()), поэтому сперва снимаем предыдущий, если он был.
  // -----------------------------------------------------------------------
  _lastScrollY: 0,
  _onTopbarScroll: null,
  initTopbarAutoHide() {
    if (App._onTopbarScroll) window.removeEventListener('scroll', App._onTopbarScroll);
    App._lastScrollY = window.scrollY || 0;
    let ticking = false;
    const REVEAL_ZONE = 80; // px от самого верха, где шапка всегда видна

    App._onTopbarScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const topbar = document.getElementById('topbar');
        if (topbar) {
          const y = window.scrollY || 0;
          const goingDown = y > App._lastScrollY;
          if (y <= REVEAL_ZONE || !goingDown) {
            topbar.classList.remove('topbar-hidden');
          } else {
            topbar.classList.add('topbar-hidden');
          }
          topbar.classList.toggle('topbar-scrolled', y > REVEAL_ZONE);
          App._lastScrollY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener('scroll', App._onTopbarScroll, { passive: true });
  },

  accountWidgetHTML() {
    const user = Auth.currentUser;
    if (user) {
      return `
        <div class="account-widget" id="accountWidget">
          ${avatarHTML(user.avatarUrl || user.avatarImageId, user.nickname, 32)}
          <span class="name">${esc(user.nickname)}</span>
          <span class="chev">${ICONS.chevronDown()}</span>
        </div>`;
    }
    return `<button type="button" class="btn btn-primary btn-sm" id="accountWidget">Войти</button>`;
  },

  wireAccountWidget() {
    const el = document.getElementById('accountWidget');
    if (!el) return;
    el.addEventListener('click', () => {
      if (Auth.currentUser) {
        App.openAccountMenu(el);
      } else {
        Auth.openLoginModal();
      }
    });
  },

  openAccountMenu(anchor) {
    document.querySelectorAll('.account-dropdown').forEach((n) => n.remove());
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'card account-dropdown';
    menu.style.cssText = `position:fixed; top:${rect.bottom + 8}px; right:${window.innerWidth - rect.right}px; z-index:60; min-width:190px; padding:8px;`;
    menu.innerHTML = `
      ${App.canAccessItem(App.ownerItem) ? `<button type="button" class="nav-item" style="width:100%" data-go="owner">${ICONS.owner()}<span>Панель владельца</span></button>` : ''}
      <button type="button" class="nav-item" style="width:100%" id="ddLogout">${ICONS.logout()}<span>Выйти</span></button>`;
    document.body.appendChild(menu);
    menu.querySelector('[data-go="owner"]')?.addEventListener('click', () => { menu.remove(); App.navigate('owner'); });
    menu.querySelector('#ddLogout').addEventListener('click', () => { menu.remove(); Auth.logout(); });
    setTimeout(() => {
      document.addEventListener('click', function onDoc(e) {
        if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('click', onDoc); }
      });
    });
  },
};

window.addEventListener('DOMContentLoaded', App.init);
