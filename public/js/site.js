// Публичный сайт: Главная страница и форма заявки на роль Event Helper.
// Обе страницы доступны без входа в личный кабинет.
const Site = {
  discordInvite: 'https://discord.gg/eventsdenver',

  renderHome(container) {
    container.innerHTML = `
      <section class="site-hero">
        <h1>Events Denver</h1>
        <p class="site-hero-sub">Ивент-отдел сервера — команда, которая придумывает и проводит мероприятия для всех игроков.</p>
        <div class="site-hero-actions">
          <a class="btn btn-ghost" href="${Site.discordInvite}" target="_blank" rel="noopener noreferrer">${ICONS.discord()} Discord-сообщество</a>
          <a class="btn btn-primary" href="#/apply">Оставить заявку</a>
        </div>
      </section>

      <section class="site-section">
        <p class="site-lead">У Вас есть отличная возможность попробовать себя в роли Event Helper и внести свой вклад в развитие мероприятий!</p>

        <h2 class="site-h2">Что мы предлагаем вам?</h2>
        <ul class="site-list">
          <li>Опыт работы в команде мероприятий и помощь администрации в организации ивентов</li>
          <li>Возможность влиять на развитие мероприятий — предлагать новые форматы, идеи и концепции ивентов</li>
          <li>Возможность реализовывать собственные идеи и мероприятия</li>
          <li>Карьерный рост внутри команды</li>
          <li>Дружный и весёлый коллектив</li>
          <li>Поощрения за ваш труд и активность</li>
        </ul>

        <h2 class="site-h2">Что требуется от вас?</h2>
        <ul class="site-list">
          <li>Адекватность и стрессоустойчивость</li>
          <li>Креативное мышление и инициативность</li>
          <li>Желание помогать и развивать мероприятия</li>
        </ul>

        <div class="card card-pad site-callout">
          <h3>Важная информация</h3>
          <div class="site-callout-underline"></div>
          <ul class="site-list">
            <li><b>Event Helper не является администратором.</b> Вы можете состоять в семье, фракции и продолжать игровую деятельность</li>
            <li>Грамотная заявка — это ваша визитная карточка</li>
          </ul>
          <a href="#/apply" class="btn btn-primary">Оставить заявку →</a>
        </div>
      </section>

      <footer class="site-footer">
        <a href="${Site.discordInvite}" target="_blank" rel="noopener noreferrer">${ICONS.discord()} discord.gg/eventsdenver</a>
        <div>© ${new Date().getFullYear()} Events Denver · Ивент-отдел сервера</div>
      </footer>`;
  },

  // Экран предварительной авторизации перед подачей заявки: показывается
  // вместо формы, пока заявитель не вошёл через Discord (см. renderApply
  // ниже). Использует тот же OAuth-флоу, что и вход в личный кабинет
  // (см. Auth.openLoginModal), но с returnTo=apply, чтобы после Discord
  // вернуться обратно на форму заявки, а не в личный кабинет.
  renderApplyAuthGate(container) {
    container.innerHTML = `
      <div class="site-page-head">
        <h1>Заявка на Event Helper</h1>
        <p>Сначала авторизуйтесь через Discord — так к заявке автоматически прикрепится ваш настоящий Discord ID, без необходимости вводить его вручную.</p>
      </div>
      <div class="qform" style="max-width:440px;">
        <div class="qform-card" style="text-align:center;">
          <label class="qform-check-label" for="applyConsentCheck" style="text-align:left;">
            <input type="checkbox" id="applyConsentCheck">
            <span>Я даю согласие на обработку моих персональных данных (Discord ID, никнейм, аватар), указанных при авторизации, в соответствии с законодательством РФ, Украины, Казахстана и Беларуси о персональных данных.<span class="qform-required">*</span></span>
          </label>
          ${Auth.config.discordEnabled
            ? `<button type="button" class="btn btn-discord" id="applyDiscordBtn" disabled>${ICONS.discord()} Войти через Discord</button>`
            : `<button type="button" class="btn btn-discord" id="applyDiscordBtn" style="opacity:.55;cursor:not-allowed;">${ICONS.discord()} Войти через Discord</button>`}
          <div id="applyDiscordNote" class="field-hint" style="text-align:center;margin-top:12px;"></div>
        </div>
      </div>`;

    const consentEl = container.querySelector('#applyConsentCheck');
    const discordBtn = container.querySelector('#applyDiscordBtn');

    if (Auth.config.discordEnabled) {
      consentEl.addEventListener('change', () => { discordBtn.disabled = !consentEl.checked; });
    }

    discordBtn.addEventListener('click', () => {
      if (!Auth.config.discordEnabled) {
        container.querySelector('#applyDiscordNote').textContent =
          'Вход через Discord не настроен администратором сайта (см. README.md).';
        return;
      }
      if (!consentEl.checked) return;
      window.location.href = '/api/auth/discord?consent=1&returnTo=apply';
    });
  },

  async renderApply(container) {
    // Проверяем статус набора ДО отрисовки формы — если закрыт, форму вообще
    // не показываем (см. GET /api/applications/status). Сервер также
    // перепроверяет это при самой отправке (POST /api/applications), так что
    // ошибка сети здесь не даёт обойти закрытие набора — при неудаче просто
    // по умолчанию считаем набор открытым и показываем форму как обычно.
    let isOpen = true;
    try {
      const status = await api.get('/api/applications/status');
      isOpen = status.isOpen;
    } catch (e) { /* см. комментарий выше — не блокируем показ формы */ }

    if (!isOpen) {
      container.innerHTML = `
        <div class="site-page-head">
          <h1>Заявка на Event Helper</h1>
        </div>
        <div class="empty-state" style="padding-top:24px;">
          <h3>Набор закрыт</h3>
          <p>Информация об открытии набора будет в наших новостях.</p>
          <a href="#/home" class="btn btn-ghost" style="margin-top:16px;">На главную</a>
        </div>`;
      return;
    }

    // Раньше заявитель вписывал свой Discord ID вручную текстовым полем
    // (можно было ошибиться или указать чужой ID). Теперь вместо этого —
    // предварительная авторизация через Discord (см. ниже): её результат
    // (Auth.currentUser, обновляется в Auth.bootstrap при загрузке страницы)
    // и даёт нам настоящий Discord ID, поэтому отдельное поле для него в
    // форме больше не нужно.
    if (!Auth.currentUser) {
      Site.renderApplyAuthGate(container);
      return;
    }

    const QUESTIONS = [
      { id: 'nicknameStatic', label: 'Ваш игровой Nickname и StaticID' },
      { id: 'age', label: 'Ваш возраст' },
      { id: 'avgOnline', label: 'Какой у Вас среднесуточный онлайн?' },
      { id: 'timePeriod', label: 'В какой промежуток больше уделяете времени игре?' },
      { id: 'experience', label: 'Есть ли у Вас опыт в проведении мероприятий?', area: true },
      { id: 'ideas', label: 'Есть ли у Вас какие-либо идеи по новым мероприятиям?', area: true },
      { id: 'motivation', label: 'Почему именно Вы должны занять пост Event Helpera?', area: true },
    ];

    container.innerHTML = `
      <div class="site-page-head">
        <h1>Заявка на Event Helper</h1>
        <p>Заполните все поля формы — мы рассмотрим заявку и свяжемся с вами в Discord.</p>
      </div>
      <div class="qform" style="padding-bottom:0;">
        <div class="qform-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            <span style="color:#8b93f8;display:flex;">${ICONS.discord()}</span>
            <div style="min-width:0;">
              <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;">Авторизованы как ${esc(Auth.currentUser.discordUsername || Auth.currentUser.nickname)}</div>
              <div class="field-hint" style="margin-top:2px;">Ваш Discord ID автоматически прикрепится к заявке — вводить его вручную не нужно.</div>
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="applySwitchAccountBtn" style="flex-shrink:0;">Не вы?</button>
        </div>
      </div>
      <form class="qform" id="applyForm" novalidate>
        ${QUESTIONS.map((q) => `
          <div class="qform-card">
            <label class="qform-label" for="q_${q.id}">${esc(q.label)}<span class="qform-required">*</span></label>
            ${q.area
              ? `<textarea class="input" id="q_${q.id}" rows="4" placeholder="Ваш ответ"></textarea>`
              : `<input class="input" id="q_${q.id}" placeholder="Ваш ответ">`}
          </div>`).join('')}
        <div class="qform-card">
          <label class="qform-check-label" for="q_consent">
            <input type="checkbox" id="q_consent">
            <span>Я даю согласие на обработку моих персональных данных, указанных в этой заявке, в соответствии с законодательством РФ, Украины, Казахстана и Беларуси о персональных данных.<span class="qform-required">*</span></span>
          </label>
        </div>
        <div class="error-text" id="applyErr"></div>
        <button type="submit" class="btn btn-primary btn-block" id="applySubmitBtn">Отправить</button>
      </form>`;

    const form = container.querySelector('#applyForm');
    container.querySelector('#applySwitchAccountBtn').addEventListener('click', async () => {
      try { await api.post('/api/auth/logout'); } catch (e) { /* игнорируем — всё равно сбрасываем локально */ }
      Auth.currentUser = null;
      App.renderSite('apply');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = container.querySelector('#applyErr');
      errEl.textContent = '';

      const payload = {};
      for (const q of QUESTIONS) payload[q.id] = container.querySelector(`#q_${q.id}`).value.trim();

      const missing = QUESTIONS.filter((q) => !payload[q.id]);
      if (missing.length) {
        errEl.textContent = 'Заполните все поля формы.';
        return;
      }

      const consentEl = container.querySelector('#q_consent');
      if (!consentEl.checked) {
        errEl.textContent = 'Необходимо дать согласие на обработку персональных данных.';
        return;
      }

      const btn = container.querySelector('#applySubmitBtn');
      btn.disabled = true;
      try {
        await api.post('/api/applications', { ...payload, consent: true });
        container.innerHTML = `
          <div class="empty-state" style="padding-top:64px;">
            <h3>Заявка отправлена</h3>
            <p>Спасибо! Мы рассмотрим вашу заявку и свяжемся с вами в Discord.</p>
            <a href="#/home" class="btn btn-ghost" style="margin-top:16px;">На главную</a>
          </div>`;
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  },
};
