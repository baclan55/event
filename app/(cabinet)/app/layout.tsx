import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { userHasAnyRole, userHasPermission } from '@/lib/roleAccess';
import { CabinetShellServer } from '@/components/CabinetShellServer';

export const dynamic = 'force-dynamic';

const TITLES: Record<string, string> = {
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

const SUBTITLES: Record<string, string> = {
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

function titleForPath(pathname: string) {
  if (pathname.startsWith('/app/profile/') && pathname !== '/app/profile') return 'Профиль сотрудника';
  if (pathname.startsWith('/app/gmp/') && pathname !== '/app/gmp') return 'ГМП';
  if (pathname.match(/^\/app\/payouts\/\d+\/log$/)) return 'Лог выплат';
  if (pathname.match(/^\/app\/payouts\/\d+$/)) return 'Таблица выплат';
  return TITLES[pathname] || 'Кабинет';
}

function subtitleForPath(pathname: string, appTitle: string) {
  if (pathname.startsWith('/app/profile/') && pathname !== '/app/profile') {
    return `Карточка сотрудника · ${appTitle}`;
  }
  if (pathname.startsWith('/app/gmp/') && pathname !== '/app/gmp') {
    return `Карточка мероприятия · ${appTitle}`;
  }
  if (pathname.match(/^\/app\/payouts\/\d+/)) {
    return `Недельная ведомость · ${appTitle}`;
  }
  return `${SUBTITLES[pathname] || runtimeEnv('APP_SUBTITLE') || 'Ивент-отдел сервера'} · ${appTitle}`;
}

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  let user = null;
  try {
    user = publicUser(await getCurrentUser());
  } catch (err) {
    console.error('[cabinet]', (err as Error).message);
  }
  if (!user) redirect('/');

  const pathname = (await headers()).get('x-pathname') || '/app/dashboard';

  if (user.isBlocked && pathname !== '/app/blocked') {
    redirect('/app/blocked');
  }
  const roleCtx = {
    role_id: user.roleId,
    is_owner: user.isOwner,
    roleNames: user.roles,
    permissions: user.permissions,
    editPermissions: user.editPermissions,
    gmpCaps: user.gmpCaps,
    eventCaps: user.eventCaps,
    statsCaps: user.statsCaps,
  };
  const hasRole = userHasAnyRole(roleCtx);
  if (!user.isBlocked && !hasRole && pathname !== '/app/pending') {
    redirect('/app/pending');
  }
  // Роль уже есть — со страницы ожидания сразу на главную.
  if (!user.isBlocked && hasRole && pathname === '/app/pending') {
    redirect('/app/dashboard');
  }

  const bare = user.isBlocked || !hasRole;
  if (bare) {
    return <div className="site"><div className="bg-decor" />{children}</div>;
  }

  if (pathname === '/app/owner') {
    redirect(userHasPermission(roleCtx, 'manage_roles') ? '/app/roles' : '/app/profile');
  }

  let isGmpStaff = false;
  if (!userHasPermission(roleCtx, 'manage_gmp')) {
    try {
      const staffHit = await query('SELECT 1 FROM gmp_staff WHERE user_id=$1 LIMIT 1', [user.id]);
      isGmpStaff = staffHit.rows.length > 0;
    } catch {
      isGmpStaff = false;
    }
  }
  const canSeeGmpNav = userHasPermission(roleCtx, 'manage_gmp') || isGmpStaff;

  const protectedRoutes: Array<[string, Parameters<typeof userHasPermission>[1]]> = [
    ['/app/reprimands', 'reprimands'],
    ['/app/applications', 'applications'],
    ['/app/application-history', 'application_history'],
    ['/app/candidates', 'candidates'],
    ['/app/events', 'manage_events'],
    ['/app/roles', 'manage_roles'],
    ['/app/blacklist', 'manage_blacklist'],
    ['/app/achievements', 'manage_achievements'],
    ['/app/profile-moderation', 'moderate_profile'],
    ['/app/payouts', 'manage_payouts'],
  ];
  for (const [route, perm] of protectedRoutes) {
    if ((pathname === route || pathname.startsWith(`${route}/`)) && route === '/app/payouts') {
      if (!userHasPermission(roleCtx, perm)) redirect('/app/dashboard');
      continue;
    }
    if (pathname === route && !userHasPermission(roleCtx, perm)) {
      redirect('/app/dashboard');
    }
  }
  // Список ГМП: manage_gmp или участие в staff. Карточка /app/gmp/[id] — по API.
  if (pathname === '/app/gmp' && !canSeeGmpNav) {
    redirect('/app/dashboard');
  }
  if (pathname === '/app/statistics' || pathname.startsWith('/app/statistics/')) {
    if (!userHasPermission(roleCtx, 'view_statistics')) {
      redirect('/app/dashboard');
    }
  }

  const canSeeStatistics = userHasPermission(roleCtx, 'view_statistics');

  const navGroups = [
    {
      label: 'Кабинет',
      items: [
        ['dashboard', 'Главная', true],
        ['profile', 'Моя страница', true],
        ['statistics', 'Статистика', canSeeStatistics],
      ],
    },
    {
      label: 'Материалы',
      items: [
        ['faq', 'FAQ', true],
        ['rules', 'Правила МП', true],
        ['regulations', 'Регламент', true],
        ['first-steps', 'Первые шаги', true],
      ],
    },
    {
      label: 'Команда',
      items: [
        ['roster', 'Состав', true],
        ['vacations', 'Отпуска', true],
        ['events', 'Мероприятия', userHasPermission(roleCtx, 'manage_events')],
        ['gmp', userHasPermission(roleCtx, 'manage_gmp') ? 'ГМП' : 'Мои ГМП', canSeeGmpNav],
        ['reprimands', 'Система выговоров', userHasPermission(roleCtx, 'reprimands')],
      ],
    },
    {
      label: 'Набор',
      items: [
        ['applications', 'Заявки', userHasPermission(roleCtx, 'applications')],
        ['application-history', 'История заявок', userHasPermission(roleCtx, 'application_history')],
        ['candidates', 'Кандидаты', userHasPermission(roleCtx, 'candidates')],
      ],
    },
    {
      label: 'Управление',
      items: [
        ['roles', 'Роли и доступы', userHasPermission(roleCtx, 'manage_roles')],
        ['blacklist', 'Чёрный список', userHasPermission(roleCtx, 'manage_blacklist')],
        ['achievements', 'Достижения', userHasPermission(roleCtx, 'manage_achievements')],
        ['payouts', 'Выплаты', userHasPermission(roleCtx, 'manage_payouts')],
        ['profile-moderation', 'Модерация профиля', userHasPermission(roleCtx, 'moderate_profile')],
      ],
    },
  ]
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter((item) => item[2])
        .map(([key, label]) => ({ key: key as string, label: label as string })),
    }))
    .filter((group) => group.items.length > 0);

  const appTitle = runtimeEnv('APP_TITLE') || 'Events Denver';
  const title = titleForPath(pathname);
  const subtitle = subtitleForPath(pathname, appTitle);

  return (
    <CabinetShellServer
      user={user}
      navGroups={navGroups}
      title={title}
      subtitle={subtitle}
      pathname={pathname}
    >
      {children}
    </CabinetShellServer>
  );
}
