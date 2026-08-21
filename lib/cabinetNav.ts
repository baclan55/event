export const CABINET_TITLES: Record<string, string> = {
  '/app': 'Главная',
  '/app/dashboard': 'Главная',
  '/app/profile': 'Моя страница',
  '/app/faq': 'FAQ',
  '/app/roster': 'Состав',
  '/app/rules': 'Правила МП',
  '/app/regulations': 'Регламент',
  '/app/first-steps': 'Первые шаги',
  '/app/vacations': 'Отпуска',
  '/app/reprimands': 'Система выговоров',
  '/app/applications': 'Заявки',
  '/app/application-history': 'История заявок',
  '/app/candidates': 'Кандидаты',
  '/app/roles': 'Роли и доступы',
  '/app/blacklist': 'Чёрный список',
  '/app/achievements': 'Достижения',
  '/app/props': 'Пропы',
  '/app/gmp': 'ГМП',
  '/app/events': 'Мероприятия',
  '/app/payouts': 'Выплаты',
  '/app/payouts/settings': 'Ставки выплат',
  '/app/profile-moderation': 'Модерация профиля',
  '/app/statistics': 'Статистика',
  '/app/statistics/events': 'Проведение мероприятий',
  '/app/statistics/users': 'Пользователи',
  '/app/statistics/achievements': 'Достижения',
  '/app/statistics/gmp': 'ГМП',
  '/app/statistics/applications': 'Заявки и набор',
  '/app/statistics/reprimands': 'Выговоры',
  '/app/blocked': 'Доступ закрыт',
  '/app/pending': 'Ожидание роли',
};

export const CABINET_SUBTITLES: Record<string, string> = {
  '/app': 'Обзор состава и присутствия на мероприятиях',
  '/app/dashboard': 'Обзор состава и присутствия на мероприятиях',
  '/app/profile': 'Ваши мероприятия за неделю, выговоры и журнал',
  '/app/faq': 'Последовательность проведения мероприятий',
  '/app/roster': 'Иерархия сотрудников и мероприятия за неделю',
  '/app/rules': 'Правила проведения мероприятий и их суть',
  '/app/regulations': 'Регламент работы по ролям',
  '/app/first-steps': 'С чего начать новому сотруднику',
  '/app/vacations': 'Календарь и заявки на отпуск',
  '/app/reprimands': 'Учёт дисциплинарных взысканий',
  '/app/applications': 'Заявки на роль Event Helper',
  '/app/application-history': 'Одобренные и отклонённые заявки с сайта',
  '/app/candidates': 'Кандидаты, ожидающие результата обзвона',
  '/app/roles': 'Создание ролей, доступы и вес в иерархии',
  '/app/blacklist': 'Запрет выдачи ролей и автоотклонение заявок',
  '/app/achievements': 'Создание достижений и триггеры',
  '/app/props': 'Картинки и ID пропов для спавна',
  '/app/gmp': 'Большие мероприятия: чекпоинты, staff и награды',
  '/app/events': 'Сборы МП из Discord: название, дата и участники',
  '/app/payouts': 'Недельные выплаты хелперам',
  '/app/payouts/settings': 'Цены МП/ГМП, минимум и штрафы по ролям',
  '/app/profile-moderation': 'Активные заявки и история решений по имени, фамилии и StaticID',
  '/app/statistics': 'Сводные показатели отдела',
  '/app/statistics/events': 'Проведение МП: объёмы и топы',
  '/app/statistics/users': 'Состав, роли и статусы',
  '/app/statistics/achievements': 'Выдачи и популярные достижения',
  '/app/statistics/gmp': 'Большие мероприятия',
  '/app/statistics/applications': 'Набор и заявки',
  '/app/statistics/reprimands': 'Дисциплинарная статистика',
};

/** Заголовок шапки кабинета для текущего пути. */
export function titleForCabinetPath(pathname: string): string {
  if (pathname.startsWith('/app/profile/') && pathname !== '/app/profile') return 'Профиль сотрудника';
  if (pathname.startsWith('/app/gmp/') && pathname !== '/app/gmp') return 'ГМП';
  if (/^\/app\/payouts\/\d+\/log$/.test(pathname)) return 'Лог выплат';
  if (/^\/app\/payouts\/\d+$/.test(pathname)) return 'Таблица выплат';
  return CABINET_TITLES[pathname] || 'Кабинет';
}

/** Подзаголовок шапки кабинета для текущего пути. */
export function subtitleForCabinetPath(pathname: string, appTitle: string, subtitleFallback: string): string {
  if (pathname.startsWith('/app/profile/') && pathname !== '/app/profile') {
    return `Карточка сотрудника · ${appTitle}`;
  }
  if (pathname.startsWith('/app/gmp/') && pathname !== '/app/gmp') {
    return `Карточка мероприятия · ${appTitle}`;
  }
  if (/^\/app\/payouts\/\d+/.test(pathname)) {
    return `Недельная ведомость · ${appTitle}`;
  }
  return `${CABINET_SUBTITLES[pathname] || subtitleFallback} · ${appTitle}`;
}
