import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
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
  '/app/candidates': 'Кандидаты',
  '/app/roles': 'Роли и доступы',
  '/app/blacklist': 'Чёрный список',
  '/app/achievements': 'Достижения',
  '/app/profile-moderation': 'Модерация профиля',
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
  '/app/vacations': 'Календарь отпусков и подача заявки',
  '/app/reprimands': 'Учёт дисциплинарных взысканий',
  '/app/applications': 'Заявки на роль Event Helper',
  '/app/candidates': 'Кандидаты, ожидающие результата обзвона',
  '/app/roles': 'Создание ролей, доступы и вес в иерархии',
  '/app/blacklist': 'Запрет выдачи ролей и автоотклонение заявок',
  '/app/achievements': 'Создание достижений и триггеры',
  '/app/profile-moderation': 'Заявки на смену имени, фамилии и StaticID',
};

function titleForPath(pathname: string) {
  if (pathname.startsWith('/app/profile/') && pathname !== '/app/profile') return 'Профиль сотрудника';
  return TITLES[pathname] || 'Кабинет';
}

function subtitleForPath(pathname: string, appTitle: string) {
  if (pathname.startsWith('/app/profile/') && pathname !== '/app/profile') {
    return `Карточка сотрудника · ${appTitle}`;
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
  };
  const hasRole = userHasAnyRole(roleCtx);
  if (!user.isBlocked && !hasRole && pathname !== '/app/pending') {
    redirect('/app/pending');
  }

  const bare = user.isBlocked || !hasRole;
  if (bare) {
    return <div className="site"><div className="bg-decor" />{children}</div>;
  }

  if (pathname === '/app/owner') {
    redirect(userHasPermission(roleCtx, 'manage_roles') ? '/app/roles' : '/app/profile');
  }

  const protectedRoutes: Array<[string, Parameters<typeof userHasPermission>[1]]> = [
    ['/app/reprimands', 'reprimands'],
    ['/app/applications', 'applications'],
    ['/app/candidates', 'candidates'],
    ['/app/roles', 'manage_roles'],
    ['/app/blacklist', 'manage_blacklist'],
    ['/app/achievements', 'manage_achievements'],
    ['/app/profile-moderation', 'moderate_profile'],
  ];
  for (const [route, perm] of protectedRoutes) {
    if (pathname === route && !userHasPermission(roleCtx, perm)) {
      redirect('/app/dashboard');
    }
  }

  const navGroups = [
    {
      label: 'Кабинет',
      items: [
        ['dashboard', 'Главная', true],
        ['profile', 'Моя страница', true],
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
        ['reprimands', 'Система выговоров', userHasPermission(roleCtx, 'reprimands')],
      ],
    },
    {
      label: 'Набор',
      items: [
        ['applications', 'Заявки', userHasPermission(roleCtx, 'applications')],
        ['candidates', 'Кандидаты', userHasPermission(roleCtx, 'candidates')],
      ],
    },
    {
      label: 'Управление',
      items: [
        ['roles', 'Роли и доступы', userHasPermission(roleCtx, 'manage_roles')],
        ['blacklist', 'Чёрный список', userHasPermission(roleCtx, 'manage_blacklist')],
        ['achievements', 'Достижения', userHasPermission(roleCtx, 'manage_achievements')],
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
