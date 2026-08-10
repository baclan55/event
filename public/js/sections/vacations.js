// =============================================================================
// Раздел "Отпуска": календарь на месяц (кто и когда в отпуске), подача
// собственной заявки (период дат + необязательная причина), рассмотрение
// заявок (Chief Event Helper, Chief Event, Dep.Chief Event —
// см. Auth.ROLE_GROUPS.vacationsReview / VACATIONS_REVIEW_ROLES на бэкенде)
// и личная история заявок ("Мои заявки"). Единый тип отпуска — без деления
// на плановый/внеплановый.
//
// "Слотов на день" (DAILY_CAPACITY) — чисто информационный ориентир (сколько
// человек одновременно в отпуске в этот день), как на референсном скрине:
// не блокирует создание/одобрение заявки сверх лимита, только подсвечивает
// загруженность дня при выборе периода и в самом календаре.
// =============================================================================
window.Sections = window.Sections || {};
window.Sections.vacations = (function () {
  const MAX_LANES = 3;
  const DAILY_CAPACITY = 5;

  const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // --- утилиты дат (всегда в локальном времени, без сдвигов часовых поясов —
  // сервер отдаёт DATE-поля в виде "YYYY-MM-DDT00:00:00.000Z", поэтому везде
  // при разборе берём только первые 10 символов) ---------------------------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
  function formatRu(d) { return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dayIndexInWeek(day, weekStart) { return Math.round((day - weekStart) / 86400000); }

  function daysWord(n) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return 'день';
    if ([2, 3, 4].includes(n10) && ![12, 13, 14].includes(n100)) return 'дня';
    return 'дней';
  }

  function vacStatusBadge(status) {
    const map = {
      pending: ['badge-amber', 'Ожидает'],
      approved: ['badge-green', 'Одобрено'],
      rejected: ['badge-red', 'Отклонено'],
      cancelled: ['badge-muted', 'Отменено'],
    };
    const entry = map[status] || map.pending;
    return `<span class="badge ${entry[0]}">${entry[1]}</span>`;
  }

  function normalizeAll(list) {
    return list.map((v) => ({ ...v, startD: parseISO(v.start_date), endD: parseISO(v.end_date) }));
  }

  // Строит сетку месяца: массив недель (Пн-Вс), каждая — 7 объектов Date,
  // включая "хвосты" соседних месяцев, чтобы сетка была прямоугольной.
  function buildMonthMatrix(year, month) {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // 0 = понедельник
    const gridStart = addDays(first, -startOffset);
    const last = new Date(year, month + 1, 0);
    const totalCells = Math.ceil((((last - gridStart) / 86400000) + 1) / 7) * 7;
    const weeks = [];
    let cursor = gridStart;
    for (let i = 0; i < totalCells; i += 7) {
      const week = [];
      for (let d = 0; d < 7; d++) { week.push(cursor); cursor = addDays(cursor, 1); }
      weeks.push(week);
    }
    return weeks;
  }

  return {
    async render(container) {
      let all = [];
      let mine = [];
      try {
        const [allData, mineData] = await Promise.all([
          api.get('/api/vacations'),
          api.get('/api/vacations/mine'),
        ]);
        all = allData.vacations;
        mine = mineData.vacations;
      } catch (e) {
        container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить отпуска</h3><p>${esc(e.message)}</p></div>`;
        return;
      }

      let vacNorm = normalizeAll(all);
      const canReview = Auth.hasRoleIn(Auth.ROLE_GROUPS.vacationsReview);
      const today = startOfDay(new Date());
      let viewYear = today.getFullYear();
      let viewMonth = today.getMonth();

      paint();

      // -----------------------------------------------------------------
      // Рендер
      // -----------------------------------------------------------------
      function paint() {
        const weeks = buildMonthMatrix(viewYear, viewMonth);
        const pendingItems = all.filter((v) => v.status === 'pending');

        const reviewHTML = canReview && pendingItems.length ? `
          <div class="card card-pad" style="margin-bottom:20px;">
            <div class="card-header"><h3>На рассмотрении</h3><span class="badge badge-amber">${pendingItems.length}</span></div>
            ${pendingItems.map(reviewCardHTML).join('')}
          </div>` : '';

        container.innerHTML = `
          ${reviewHTML}
          <div class="vac-layout">
            <div class="card card-pad vac-calendar-card">
              <div class="vac-cal-header">
                <button type="button" class="icon-btn" id="vacPrev">${ICONS.chevronLeft()}</button>
                <h3 class="vac-cal-title">${esc(MONTHS_NOM[viewMonth])} ${viewYear}</h3>
                <button type="button" class="icon-btn" id="vacNext">${ICONS.chevronRight()}</button>
                <div class="vac-cal-spacer"></div>
                <button type="button" class="btn btn-ghost btn-sm" id="vacTodayBtn">Сегодня</button>
              </div>
              <div class="vac-cal-scroll">
                <div class="vac-cal-inner">
                  <div class="vac-cal-weekdays">${WEEKDAYS_SHORT.map((w) => `<div>${w}</div>`).join('')}</div>
                  <div class="vac-cal-grid">${weeks.map(weekHTML).join('')}</div>
                </div>
              </div>
              <div class="vac-legend">
                <span class="vac-legend-item"><i class="vac-legend-dot status-pending"></i>Ожидает</span>
                <span class="vac-legend-item"><i class="vac-legend-dot status-approved"></i>Одобрено</span>
                <span class="vac-legend-item"><i class="vac-legend-dot status-rejected"></i>Отклонено</span>
                <span class="vac-legend-item"><i class="vac-legend-dot status-cancelled"></i>Отменено</span>
              </div>
            </div>
            <div class="vac-sidebar">
              <div class="card card-pad">
                <div class="vac-today-label">СЕГОДНЯ</div>
                <div class="vac-today-date">${todayLongLabel()}</div>
                <div class="vac-today-list">${todayListHTML()}</div>
                <button type="button" class="btn btn-primary btn-block" id="vacNewBtn" style="margin-top:14px;">+ Новый отпуск</button>
              </div>
            </div>
          </div>
          <div class="vac-mine" style="margin-top:24px;">
            <div class="card-header"><h3>Мои заявки</h3></div>
            ${mine.length ? mine.map(mineCardHTML).join('') : `
              <div class="empty-state"><h3>Заявок ещё нет</h3><p>Здесь появится история ваших заявок на отпуск.</p></div>`}
          </div>`;

        wire();
      }

      function weekHTML(week) {
        const weekStart = week[0], weekEnd = week[6];
        const overlapping = vacNorm
          .filter((v) => v.endD >= weekStart && v.startD <= weekEnd)
          .sort((a, b) => a.startD - b.startD || a.id - b.id);

        const laneEnds = [];
        const laneOf = new Map();
        overlapping.forEach((v) => {
          let lane = laneEnds.findIndex((endD) => endD < v.startD);
          if (lane === -1) { lane = laneEnds.length; laneEnds.push(v.endD); }
          else { laneEnds[lane] = v.endD; }
          laneOf.set(v.id, lane);
        });

        const laneRows = Math.max(Math.min(laneEnds.length, MAX_LANES), 1);
        const overflowByDay = [0, 0, 0, 0, 0, 0, 0];
        const activeByDay = [0, 0, 0, 0, 0, 0, 0];
        week.forEach((day, i) => {
          vacNorm.forEach((v) => {
            if (v.startD <= day && v.endD >= day) {
              if (v.status === 'pending' || v.status === 'approved') activeByDay[i]++;
              const lane = laneOf.get(v.id);
              if (lane !== undefined && lane >= MAX_LANES) overflowByDay[i]++;
            }
          });
        });

        const barsHTML = overlapping.filter((v) => laneOf.get(v.id) < MAX_LANES).map((v) => {
          const segStart = v.startD > weekStart ? v.startD : weekStart;
          const segEnd = v.endD < weekEnd ? v.endD : weekEnd;
          const colStart = dayIndexInWeek(segStart, weekStart) + 1;
          const colEnd = dayIndexInWeek(segEnd, weekStart) + 2;
          const lane = laneOf.get(v.id);
          const roundLeft = sameDay(segStart, v.startD);
          const roundRight = sameDay(segEnd, v.endD);
          const showLabel = roundLeft || dayIndexInWeek(segStart, weekStart) === 0;
          return `<div class="vac-bar status-${v.status} ${roundLeft ? 'round-l' : ''} ${roundRight ? 'round-r' : ''}"
                       style="grid-column:${colStart} / ${colEnd}; grid-row:${lane + 1};"
                       data-vac-id="${v.id}"
                       title="${escAttr(v.nickname)}: ${formatRu(v.startD)} – ${formatRu(v.endD)}">
                    ${showLabel ? `<span class="vac-bar-dot"></span><span class="vac-bar-label">${esc(v.nickname)}</span>` : ''}
                  </div>`;
        }).join('');

        const cellsHTML = week.map((day, i) => {
          const isOtherMonth = day.getMonth() !== viewMonth;
          const isToday = sameDay(day, today);
          const occ = activeByDay[i];
          const occClass = occ >= DAILY_CAPACITY ? 'is-full' : (occ >= DAILY_CAPACITY - 1 ? 'is-near' : '');
          return `
            <div class="vac-day-cell ${isOtherMonth ? 'is-muted' : ''}">
              <div class="vac-day-num ${isToday ? 'is-today' : ''}">${day.getDate()}</div>
              <div class="vac-day-bars-space"></div>
              <div class="vac-day-overflow">${overflowByDay[i] > 0 ? '+' + overflowByDay[i] : ''}</div>
              <div class="vac-day-occupancy ${occClass}">${occ > 0 ? occ + '/' + DAILY_CAPACITY : ''}</div>
            </div>`;
        }).join('');

        return `
          <div class="vac-week" style="--lanes:${laneRows};">
            <div class="vac-week-cells">${cellsHTML}</div>
            <div class="vac-week-bars" style="grid-template-rows:repeat(${laneRows}, 21px);">${barsHTML}</div>
          </div>`;
      }

      function todayLongLabel() {
        return `${WEEKDAYS_FULL[(today.getDay() + 6) % 7]}, ${today.getDate()} ${MONTHS_GEN[today.getMonth()]}`;
      }

      function todayListHTML() {
        const items = vacNorm
          .filter((v) => (v.status === 'pending' || v.status === 'approved') && v.startD <= today && v.endD >= today)
          .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ru'));
        if (!items.length) {
          return `<div class="empty-state" style="padding:20px 4px;"><p>Сегодня никто не в отпуске.</p></div>`;
        }
        return items.map((v) => `
          <div class="vac-today-row">
            <div class="vac-today-row-head">
              <span class="nickname">${esc(v.nickname)}</span>
              ${vacStatusBadge(v.status)}
            </div>
            <div class="vac-today-row-dates">${formatRu(v.startD)} – ${formatRu(v.endD)}</div>
          </div>`).join('');
      }

      function reviewCardHTML(v) {
        const start = parseISO(v.start_date), end = parseISO(v.end_date);
        const n = Math.round((end - start) / 86400000) + 1;
        return `
          <div class="rule-card" data-id="${v.id}">
            <div class="rule-body">
              <h4>${esc(v.nickname)} ${vacStatusBadge(v.status)}</h4>
              <div class="rule-text"><b>Период:</b> ${formatRu(start)} – ${formatRu(end)} (${n} ${daysWord(n)})</div>
              ${v.reason ? `<div class="rule-text" style="margin-top:6px;"><b>Причина:</b> ${esc(v.reason)}</div>` : ''}
              <div class="meta-line">Подано ${formatDate(v.created_at)}</div>
            </div>
            <div class="rule-actions" style="flex-direction:column;gap:6px;align-items:stretch;">
              <button type="button" class="btn btn-ghost btn-sm" data-approve="${v.id}">Одобрить</button>
              <button type="button" class="btn btn-danger btn-sm" data-reject="${v.id}">Отклонить</button>
            </div>
          </div>`;
      }

      function mineCardHTML(v) {
        const start = parseISO(v.start_date), end = parseISO(v.end_date);
        const canCancel = v.status === 'pending';
        return `
          <div class="rule-card" data-id="${v.id}">
            <div class="rule-body">
              <h4>${formatRu(start)} – ${formatRu(end)} ${vacStatusBadge(v.status)}</h4>
              ${v.reason
                ? `<div class="rule-text">${esc(v.reason)}</div>`
                : `<div class="rule-text" style="color:var(--text-faint);">Причина не указана</div>`}
              <div class="meta-line">
                Подано ${formatDate(v.created_at)}${v.reviewed_by_nickname ? ` · рассмотрел ${esc(v.reviewed_by_nickname)} · ${formatDate(v.reviewed_at)}` : ''}
              </div>
            </div>
            ${canCancel ? `
            <div class="rule-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-cancel="${v.id}">Отменить</button>
            </div>` : ''}
          </div>`;
      }

      // -----------------------------------------------------------------
      // Действия
      // -----------------------------------------------------------------
      function wire() {
        container.querySelector('#vacPrev').addEventListener('click', () => {
          viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } paint();
        });
        container.querySelector('#vacNext').addEventListener('click', () => {
          viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } paint();
        });
        container.querySelector('#vacTodayBtn').addEventListener('click', () => {
          viewYear = today.getFullYear(); viewMonth = today.getMonth(); paint();
        });
        container.querySelector('#vacNewBtn').addEventListener('click', openCreateModal);
        container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => reviewAction(btn.dataset.approve, 'approved')));
        container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => reviewAction(btn.dataset.reject, 'rejected')));
        container.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => cancelMine(btn.dataset.cancel)));
        container.querySelectorAll('.vac-bar[data-vac-id]').forEach((bar) => bar.addEventListener('click', () => openDetailModal(bar.dataset.vacId)));
      }

      async function reload() {
        const [allData, mineData] = await Promise.all([api.get('/api/vacations'), api.get('/api/vacations/mine')]);
        all = allData.vacations;
        mine = mineData.vacations;
        vacNorm = normalizeAll(all);
        paint();
      }

      async function reviewAction(id, status) {
        try { await api.put(`/api/vacations/${id}`, { status }); await reload(); }
        catch (e) { alert(e.message); }
      }

      function cancelMine(id) {
        Modal.confirm({
          title: 'Отменить заявку?',
          message: 'Заявка будет помечена как отменённая — это действие нельзя отменить обратно.',
          confirmText: 'Отменить заявку',
          onConfirm: async () => { await api.put(`/api/vacations/${id}`, { status: 'cancelled' }); await reload(); },
        });
      }

      function openDetailModal(id) {
        const v = vacNorm.find((x) => String(x.id) === String(id));
        if (!v) return;
        const isMine = Auth.currentUser && Auth.currentUser.id === v.user_id;
        const canAct = canReview && v.status === 'pending';
        const canSelfCancel = isMine && v.status === 'pending';

        const overlay = Modal.open(`
          <h2>${esc(v.nickname)}</h2>
          <div class="modal-sub">${formatRu(v.startD)} – ${formatRu(v.endD)} · ${vacStatusBadge(v.status)}</div>
          ${v.reason ? `<p class="rule-text" style="text-align:center;">${esc(v.reason)}</p>` : ''}
          <div class="error-text" data-vac-detail-err style="text-align:center;"></div>
          ${(canAct || canSelfCancel) ? `
          <div class="modal-actions" style="justify-content:center;flex-wrap:wrap;">
            ${canAct ? `
              <button type="button" class="btn btn-danger" data-detail-reject>Отклонить</button>
              <button type="button" class="btn btn-primary" data-detail-approve>Одобрить</button>` : ''}
            ${canSelfCancel ? `<button type="button" class="btn btn-ghost" data-detail-cancel>Отменить заявку</button>` : ''}
          </div>` : ''}
        `);

        async function act(status) {
          try { await api.put(`/api/vacations/${v.id}`, { status }); Modal.close(); await reload(); }
          catch (e) { overlay.querySelector('[data-vac-detail-err]').textContent = e.message; }
        }
        overlay.querySelector('[data-detail-approve]')?.addEventListener('click', () => act('approved'));
        overlay.querySelector('[data-detail-reject]')?.addEventListener('click', () => act('rejected'));
        overlay.querySelector('[data-detail-cancel]')?.addEventListener('click', () => act('cancelled'));
      }

      // -----------------------------------------------------------------
      // Модалка "Новый отпуск" — свой мини-календарь для выбора периода
      // (клик по полю "Период отпуска" открывает/закрывает его), список
      // занятости дней выбранного периода и необязательная причина.
      // -----------------------------------------------------------------
      function openCreateModal() {
        let rangeStart = null;
        let rangeEnd = null;
        let miniOpen = false;
        let miniYear = today.getFullYear();
        let miniMonth = today.getMonth();

        const overlay = Modal.open(`
          <h2>Новый отпуск</h2>
          <div class="field">
            <label>Период отпуска</label>
            <button type="button" class="vac-period-trigger" id="vacPeriodTrigger">
              ${ICONS.calendarDay()}
              <span id="vacPeriodText">Выберите даты</span>
              <span class="chev">${ICONS.chevronDown()}</span>
            </button>
            <div class="vac-period-days" id="vacPeriodDays"></div>
            <div class="vac-mini-cal" id="vacMiniCal" style="display:none;"></div>
          </div>
          <div class="field" id="vacSlotsField" style="display:none;">
            <label>Занято слотов отпуска на каждый день периода</label>
            <div class="vac-slots-list" id="vacSlotsList"></div>
          </div>
          <div class="field">
            <label>Причина (необязательно)</label>
            <textarea class="input" id="vacReasonInput" placeholder="Укажите причину отпуска" style="min-height:80px;"></textarea>
          </div>
          <div class="error-text" data-vac-form-err></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
            <button type="button" class="btn btn-primary" id="vacSubmitBtn">Создать</button>
          </div>
        `);

        const triggerBtn = overlay.querySelector('#vacPeriodTrigger');
        const periodText = overlay.querySelector('#vacPeriodText');
        const periodDays = overlay.querySelector('#vacPeriodDays');
        const miniCalEl = overlay.querySelector('#vacMiniCal');
        const slotsField = overlay.querySelector('#vacSlotsField');
        const slotsList = overlay.querySelector('#vacSlotsList');
        const errEl = overlay.querySelector('[data-vac-form-err]');
        const submitBtn = overlay.querySelector('#vacSubmitBtn');
        const reasonInput = overlay.querySelector('#vacReasonInput');

        triggerBtn.addEventListener('click', () => {
          miniOpen = !miniOpen;
          miniCalEl.style.display = miniOpen ? 'block' : 'none';
          if (miniOpen) paintMiniCal();
        });

        function miniDayHTML(day) {
          const isMuted = day.getMonth() !== miniMonth;
          const isToday = sameDay(day, today);
          let cls = 'vac-mini-day';
          if (isMuted) cls += ' is-muted';
          if (isToday) cls += ' is-today';
          const isStart = rangeStart && sameDay(day, rangeStart);
          const isEnd = rangeEnd ? sameDay(day, rangeEnd) : (rangeStart && sameDay(day, rangeStart));
          if (isStart) cls += ' range-start';
          if (isEnd) cls += ' range-end';
          if (rangeStart && rangeEnd && day > rangeStart && day < rangeEnd) cls += ' in-range';
          return `<div class="${cls}" data-date="${toISO(day)}">${day.getDate()}</div>`;
        }

        function paintMiniCal() {
          const weeks = buildMonthMatrix(miniYear, miniMonth);
          miniCalEl.innerHTML = `
            <div class="vac-mini-head">
              <button type="button" class="icon-btn" id="vacMiniPrev">${ICONS.chevronLeft()}</button>
              <b>${MONTHS_NOM[miniMonth]} ${miniYear}</b>
              <button type="button" class="icon-btn" id="vacMiniNext">${ICONS.chevronRight()}</button>
            </div>
            <div class="vac-mini-grid">
              ${WEEKDAYS_SHORT.map((w) => `<div class="vac-mini-wd">${w}</div>`).join('')}
              ${weeks.map((week) => week.map(miniDayHTML).join('')).join('')}
            </div>
            <div class="vac-mini-actions">
              <button type="button" class="btn btn-ghost btn-sm" id="vacMiniReset">Сбросить</button>
              <button type="button" class="btn btn-primary btn-sm" id="vacMiniDone" ${!rangeStart ? 'disabled' : ''}>Готово</button>
            </div>`;

          miniCalEl.querySelector('#vacMiniPrev').addEventListener('click', () => {
            miniMonth--; if (miniMonth < 0) { miniMonth = 11; miniYear--; } paintMiniCal();
          });
          miniCalEl.querySelector('#vacMiniNext').addEventListener('click', () => {
            miniMonth++; if (miniMonth > 11) { miniMonth = 0; miniYear++; } paintMiniCal();
          });
          miniCalEl.querySelectorAll('.vac-mini-day[data-date]').forEach((el) => {
            el.addEventListener('click', () => {
              const clicked = parseISO(el.dataset.date);
              if (!rangeStart || rangeEnd) { rangeStart = clicked; rangeEnd = null; }
              else if (clicked < rangeStart) { rangeEnd = rangeStart; rangeStart = clicked; }
              else { rangeEnd = clicked; }
              paintMiniCal();
            });
          });
          miniCalEl.querySelector('#vacMiniReset').addEventListener('click', () => {
            rangeStart = null; rangeEnd = null; paintMiniCal(); updateSummary();
          });
          miniCalEl.querySelector('#vacMiniDone').addEventListener('click', () => {
            if (!rangeStart) return;
            if (!rangeEnd) rangeEnd = rangeStart;
            miniOpen = false;
            miniCalEl.style.display = 'none';
            updateSummary();
          });
        }

        function updateSummary() {
          if (!rangeStart) {
            periodText.textContent = 'Выберите даты';
            periodDays.textContent = '';
            slotsField.style.display = 'none';
            return;
          }
          const end = rangeEnd || rangeStart;
          periodText.textContent = `${formatRu(rangeStart)} — ${formatRu(end)}`;
          const n = Math.round((end - rangeStart) / 86400000) + 1;
          periodDays.textContent = `${n} ${daysWord(n)}`;

          const rows = [];
          let cursor = new Date(rangeStart);
          while (cursor <= end) {
            const count = vacNorm.filter((v) =>
              (v.status === 'pending' || v.status === 'approved') && v.startD <= cursor && v.endD >= cursor
            ).length;
            rows.push({ date: new Date(cursor), count });
            cursor = addDays(cursor, 1);
          }
          slotsField.style.display = 'block';
          slotsList.innerHTML = rows.map((r) => {
            const cls = r.count >= DAILY_CAPACITY ? 'is-full' : (r.count >= DAILY_CAPACITY - 1 ? 'is-near' : '');
            return `<div class="vac-slot-row"><span>${formatRu(r.date)}</span><span class="${cls}">${r.count}/${DAILY_CAPACITY}</span></div>`;
          }).join('');
        }

        submitBtn.addEventListener('click', async () => {
          errEl.textContent = '';
          if (!rangeStart) { errEl.textContent = 'Выберите период отпуска.'; return; }
          const end = rangeEnd || rangeStart;
          const prevLabel = submitBtn.textContent;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Создание…';
          try {
            await api.post('/api/vacations', {
              startDate: toISO(rangeStart),
              endDate: toISO(end),
              reason: reasonInput.value.trim(),
            });
            Modal.close();
            await reload();
          } catch (e) {
            errEl.textContent = e.message;
            submitBtn.disabled = false;
            submitBtn.textContent = prevLabel;
          }
        });
      }
    },
  };
})();
