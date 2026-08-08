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

  // Пошаговый гайд "Как найти свой Discord ID" — открывается модалкой рядом
  // с полем Discord в заявке, чтобы заявитель не гадал, где взять ID.
  openDiscordIdGuide() {
    Modal.open(`
      <h2>Как узнать свой Discord ID</h2>
      <div class="modal-sub">3 шага в приложении Discord</div>
      <div class="dc-guide-steps">
        <div class="dc-guide-step">
          <div class="dc-guide-num">1</div>
          <div class="dc-guide-text">В нижнем левом углу Discord нажмите на <b>шестерёнку</b> рядом с вашим никнеймом.</div>
        </div>
        <div class="dc-guide-step">
          <div class="dc-guide-num">2</div>
          <div class="dc-guide-text">Пролистайте левое меню вниз до раздела <b>«Разработчик»</b> и включите <b>«Режим разработчика»</b>.</div>
        </div>
        <div class="dc-guide-step">
          <div class="dc-guide-num">3</div>
          <div class="dc-guide-text">Кликните на своё имя внизу слева → нажмите <b>«Копировать ID пользователя»</b>.</div>
        </div>
      </div>
      <div class="dc-guide-done">
        ${ICONS.checkCircle()}
        <div class="dc-guide-done-text"><b>Готово!</b> Ваш Discord ID скопирован — вставьте его сочетанием <b>Ctrl+V</b> в поле формы.</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-modal-close>Понятно</button>
      </div>`);
  },

  renderApply(container) {
    const QUESTIONS = [
      {
        id: 'discord',
        label: 'Ваш Discord',
        hint: 'Укажите Discord ID — тогда в уведомлении будет кликабельное упоминание',
        placeholder: '000000000000000000',
        guide: true,
      },
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
      <form class="qform" id="applyForm" novalidate>
        ${QUESTIONS.map((q) => `
          <div class="qform-card">
            <label class="qform-label" for="q_${q.id}">${esc(q.label)}<span class="qform-required">*</span></label>
            ${q.hint ? `
              <div class="qform-hint-row">
                <div class="qform-hint">${esc(q.hint)}</div>
                ${q.guide ? `<button type="button" class="qform-hint-link" data-guide="${q.id}">${ICONS.discord()} Как найти?</button>` : ''}
              </div>` : ''}
            ${q.area
              ? `<textarea class="input" id="q_${q.id}" rows="4" placeholder="Ваш ответ"></textarea>`
              : `<input class="input" id="q_${q.id}" placeholder="${q.placeholder ? escAttr(q.placeholder) : 'Ваш ответ'}">`}
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
    container.querySelectorAll('[data-guide]').forEach((btn) => {
      btn.addEventListener('click', () => Site.openDiscordIdGuide());
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
