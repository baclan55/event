import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { userHasAnyRole, userHasPermission } from '@/lib/roleAccess';
import { CabinetShellServer } from '@/components/CabinetShellServer';

export const dynamic = 'force-dynamic';

// Заголовок/подзаголовок шапки больше не считаются здесь на сервере: этот layout
// общий для всех страниц /app/*, и при клиентской навигации между ними Next.js
// его повторно не рендерит (переиспользует прошлый рендер), из-за чего пропсы
// "замерзали" на первом заходе — шапка и подсветка активного пункта переставали
// переключаться, хотя содержимое страницы обновлялось верно. Теперь это считает
// сам CabinetShellServer на клиенте через usePathname(), см. lib/cabinetNav.ts.

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
    ['/app/props', 'manage_props'],
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
        ['props', 'Пропы', userHasPermission(roleCtx, 'manage_props')],
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
  const subtitleFallback = runtimeEnv('APP_SUBTITLE') || 'Ивент-отдел сервера';

  return (
    <CabinetShellServer
      user={user}
      navGroups={navGroups}
      appTitle={appTitle}
      subtitleFallback={subtitleFallback}
    >
      {children}
    </CabinetShellServer>
  );
}
