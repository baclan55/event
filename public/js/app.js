const App = {
  // Разделы личного кабинета (внутренний портал для сотрудников).
  navItems: [
    { key: 'faq', label: 'FAQ', icon: 'faq', title: 'FAQ', sub: 'Последовательность проведения мероприятий' },
    { key: 'roster', label: 'Состав', icon: 'roster', title: 'Состав', sub: 'Иерархия сотрудников и мероприятия за неделю' },
    { key: 'rules', label: 'Правила МП', icon: 'rules', title: 'Правила МП', sub: 'Правила проведения мероприятий и их суть' },
    { key: 'regulations', label: 'Регламент', icon: 'regulations', title: 'Регламент', sub: 'Регламент работы по ролям' },
    { key: 'firstSteps', label: 'Первые шаги', icon: 'firstSteps', title: 'Первые шаги', sub: 'С чего начать новому сотруднику' },
    { key: 'reprimands', label: 'Система выговоров', icon: 'reprimands', title: 'Система выговоров', sub: 'Учёт дисциплинарных взысканий', adminOnly: true },
    { key: 'applications', label: 'Заявки', icon: 'applications', title: 'Заявки', sub: 'Заявки на роль Event Helper', adminOnly: true },
  ],
  ownerItem: { key: 'owner', label: 'Панель владельца', icon: 'owner', title: 'Панель владельца', sub: 'Управление пользователями и правами' },

  // Публичные страницы сайта (не требуют входа) — своя, более простая шапка.
  siteKeys: ['home', 'apply'],

  currentKey: 'home',

  visibleNavItems() {
    return App.navItems.filter((item) => !item.adminOnly || Auth.isAdmin());
  },

  findItem(key) {
    if (key === 'owner') return App.ownerItem;
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

    let item = App.findItem(hash);
    if (!item) item = App.navItems[0];
    if (item.adminOnly && !Auth.isAdmin()) item = App.navItems[0];
    if (item.key === 'owner' && !Auth.isOwner()) item = App.navItems[0];
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
              <a href="#/home" class="site-nav-link ${key === 'home' ? 'active' : ''}">Главная</a>
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

    const ownerHTML = Auth.isOwner() ? `
      <div class="nav-group">
        <div class="nav-label">Владелец</div>
        <button type="button" class="nav-item" data-key="owner">
          ${ICONS.owner()}<span>${esc(App.ownerItem.label)}</span>
        </button>
      </div>` : '';

    const sidebarUserHTML = user ? `
      <div class="sidebar-user">
        ${avatarHTML(user.avatarImageId, user.nickname, 34)}
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
        <a href="#/home" class="nav-item" style="margin-bottom:14px;">${ICONS.home()}<span>На сайт</span></a>
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
  },

  accountWidgetHTML() {
    const user = Auth.currentUser;
    if (user) {
      return `
        <div class="account-widget" id="accountWidget">
          ${avatarHTML(user.avatarImageId, user.nickname, 32)}
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
      ${Auth.isOwner() ? `<button type="button" class="nav-item" style="width:100%" data-go="owner">${ICONS.owner()}<span>Панель владельца</span></button>` : ''}
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
