// ============================================================================
// Еженедельный сброс счётчика "МП в неделю" (users.weekly_events).
//
// Идея: раз в минуту проверяем, не началась ли новая календарная неделя
// (понедельник 00:00 по времени из WEEKLY_RESET_TZ) с момента последнего
// сброса. Момент последнего сброса хранится в таблице weekly_reset_state
// (см. schema.sql) — то есть не в памяти процесса, а в базе. Это важно по
// двум причинам:
//   1) сервер может перезапускаться (деплой, падение) — без сохранения в
//      базе после каждого рестарта счётчик сбрасывался бы заново;
//   2) на бесплатном тарифе Render сервис засыпает при отсутствии трафика —
//      если граница недели наступит, пока сервис спит, обычный setTimeout
//      никогда не сработает. Проверка при каждом старте процесса и раз в
//      минуту, пока он жив, гарантирует, что сброс произойдёт — максимум с
//      небольшой задержкой (пока сервис не проснётся/не перезапустится).
//
// Часовой пояс задаётся переменной окружения WEEKLY_RESET_TZ (IANA-имя,
// например "Europe/Moscow"), по умолчанию — Europe/Moscow. Часовой пояс
// нужен, потому что "00:00 понедельника" — понятие, привязанное к
// конкретному месту, а не к UTC.
// ============================================================================

const DEFAULT_TZ = 'Europe/Moscow';
const CHECK_INTERVAL_MS = 60 * 1000; // раз в минуту — достаточно точно для границы "00:00 понедельника"

// Соответствие короткого английского названия дня недели (см. formatToParts
// ниже) числу дней, на которое эта дата отстоит от понедельника той же
// недели (понедельник = 0).
const DAYS_SINCE_MONDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function resolveTimeZone() {
  const tz = (process.env.WEEKLY_RESET_TZ || '').trim() || DEFAULT_TZ;
  try {
    // Intl бросит RangeError, если имя часового пояса некорректно —
    // проверяем это один раз при старте, а не при каждой проверке.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch (err) {
    console.error(
      `[weekly-reset] Некорректное значение WEEKLY_RESET_TZ="${process.env.WEEKLY_RESET_TZ}" ` +
      `(${err.message}). Использую часовой пояс по умолчанию: ${DEFAULT_TZ}.`
    );
    return DEFAULT_TZ;
  }
}

// Части даты/времени (год, месяц, день, час, минута, секунда, день недели)
// в указанном часовом поясе для заданного момента времени.
function partsInZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return parts;
}

// Переводит "настенное" время (год-месяц-день час:минута:секунда), которое
// должно означать именно это время В УКАЗАННОМ ЧАСОВОМ ПОЯСЕ, в реальный
// момент UTC. Стандартный приём без внешних библиотек: сначала трактуем эти
// цифры как UTC (первое приближение), смотрим, какими цифрами это
// приближение окажется в целевом поясе, и на разницу (смещение пояса)
// корректируем результат.
function zonedTimeToUtc(y, m, d, h, min, s, timeZone) {
  const guessUtcMs = Date.UTC(y, m - 1, d, h, min, s);
  const partsAtGuess = partsInZone(new Date(guessUtcMs), timeZone);
  const asUtcIfLocal = Date.UTC(
    Number(partsAtGuess.year), Number(partsAtGuess.month) - 1, Number(partsAtGuess.day),
    Number(partsAtGuess.hour), Number(partsAtGuess.minute), Number(partsAtGuess.second)
  );
  const offsetMs = asUtcIfLocal - guessUtcMs; // насколько "локальное время в TZ" опережает UTC
  return new Date(guessUtcMs - offsetMs);
}

// Момент времени (UTC), соответствующий 00:00:00 понедельника ТЕКУЩЕЙ (по
// часовому поясу timeZone) недели — то есть граница, с которой начинается
// новый недельный отсчёт "МП".
function currentWeekMondayBoundaryUtc(timeZone, now) {
  const parts = partsInZone(now, timeZone);
  const daysSinceMonday = DAYS_SINCE_MONDAY[parts.weekday] ?? 0;

  // Простая календарная арифметика (без часовых поясов) — берём дату этой
  // недели и отступаем назад до понедельника.
  const mondayCalendar = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  mondayCalendar.setUTCDate(mondayCalendar.getUTCDate() - daysSinceMonday);

  return zonedTimeToUtc(
    mondayCalendar.getUTCFullYear(), mondayCalendar.getUTCMonth() + 1, mondayCalendar.getUTCDate(),
    0, 0, 0, timeZone
  );
}

// Проверяет, наступила ли новая неделя с момента последнего сброса, и если
// да — обнуляет weekly_events всем сотрудникам и запоминает момент сброса.
// Безопасно вызывать сколько угодно часто (в т.ч. параллельно из нескольких
// процессов) — при отсутствии необходимости в сбросе делает только один
// лёгкий SELECT.
async function checkAndResetWeeklyEvents(pool, timeZone) {
  const boundary = currentWeekMondayBoundaryUtc(timeZone, new Date());

  const { rows } = await pool.query(
    'SELECT last_reset_at FROM weekly_reset_state WHERE id = 1'
  );
  const lastResetAt = rows.length && rows[0].last_reset_at ? new Date(rows[0].last_reset_at) : null;

  if (lastResetAt && lastResetAt >= boundary) {
    return { reset: false };
  }

  const result = await pool.query('UPDATE users SET weekly_events = 0 WHERE weekly_events != 0');
  await pool.query(
    `INSERT INTO weekly_reset_state (id, last_reset_at) VALUES (1, now())
     ON CONFLICT (id) DO UPDATE SET last_reset_at = now()`
  );
  console.log(
    `[weekly-reset] Начало новой недели (${timeZone}) — счётчик "МП в неделю" ` +
    `сброшен у ${result.rowCount} сотрудников.`
  );
  return { reset: true, affected: result.rowCount };
}

// Запускает периодическую проверку. Вызывается один раз при старте сервера.
function startWeeklyResetScheduler(pool) {
  const timeZone = resolveTimeZone();

  const run = () => {
    checkAndResetWeeklyEvents(pool, timeZone).catch((err) => {
      console.error('[weekly-reset] Ошибка при проверке/сбросе:', err.message);
    });
  };

  run(); // сразу при старте — на случай, если граница недели прошла, пока сервис не работал
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = {
  startWeeklyResetScheduler,
  checkAndResetWeeklyEvents,
  currentWeekMondayBoundaryUtc,
};
