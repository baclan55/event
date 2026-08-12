import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { userHasAnyRole, userHasRoleIn, APPLICATIONS_ROLES, CANDIDATES_ROLES, OWNER_PANEL_ROLES, REPRIMANDS_ROLES } from '@/lib/roleAccess';
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
  '/app/owner': 'Панель владельца',
  '/app/blocked': 'Доступ закрыт',
  '/app/pending': 'Ожидание роли',
};

const SUBTITLES: Record<string, string> = {
  '/app': 'Обзор состава и присутствия на мероприятиях',
  '/app/dashboard': 'Обзор состава и присутствия на мероприятиях',
  '/app/profile': 'Ваши мероприятия за неделю и выговоры',
  '/app/faq': 'Последовательность проведения мероприятий',
  '/app/roster': 'Иерархия сотрудников и мероприятия за неделю',
  '/app/rules': 'Правила проведения мероприятий и их суть',
  '/app/regulations': 'Регламент работы по ролям',
  '/app/first-steps': 'С чего начать новому сотруднику',
  '/app/vacations': 'Календарь отпусков и подача заявки',
  '/app/reprimands': 'Учёт дисциплинарных взысканий',
  '/app/applications': 'Заявки на роль Event Helper',
  '/app/candidates': 'Кандидаты, ожидающие результата обзвона',
  '/app/owner': 'Управление пользователями и правами',
};

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
  const hasRole = userHasAnyRole({
    role_id: user.roleId,
    is_owner: user.isOwner,
    roleNames: user.roles,
  });
  if (!user.isBlocked && !hasRole && pathname !== '/app/pending') {
    redirect('/app/pending');
  }

  const bare = user.isBlocked || !hasRole;
  if (bare) {
    return <div className="site"><div className="bg-decor" />{children}</div>;
  }

  const roleCtx = { is_owner: user.isOwner, roleNames: user.roles };
  const protectedRoutes: Record<string, readonly string[]> = {
    '/app/reprimands': REPRIMANDS_ROLES,
    '/app/applications': APPLICATIONS_ROLES,
    '/app/candidates': CANDIDATES_ROLES,
    '/app/owner': OWNER_PANEL_ROLES,
  };
  if (protectedRoutes[pathname] && !userHasRoleIn(roleCtx, protectedRoutes[pathname])) {
    redirect('/app/dashboard');
  }
  const nav = [
    ['dashboard', 'Главная', true],
    ['profile', 'Моя страница', true],
    ['faq', 'FAQ', true],
    ['roster', 'Состав', true],
    ['rules', 'Правила МП', true],
    ['regulations', 'Регламент', true],
    ['first-steps', 'Первые шаги', true],
    ['vacations', 'Отпуска', true],
    ['reprimands', 'Система выговоров', userHasRoleIn(roleCtx, REPRIMANDS_ROLES)],
    ['applications', 'Заявки', userHasRoleIn(roleCtx, APPLICATIONS_ROLES)],
    ['candidates', 'Кандидаты', userHasRoleIn(roleCtx, CANDIDATES_ROLES)],
  ].filter((item) => item[2]) as [string, string, boolean][];

  const showOwner = userHasRoleIn(roleCtx, OWNER_PANEL_ROLES);
  const title = TITLES[pathname] || 'Кабинет';
  const appTitle = runtimeEnv('APP_TITLE') || 'Events Denver';
  const subtitle = `${SUBTITLES[pathname] || runtimeEnv('APP_SUBTITLE') || 'Ивент-отдел сервера'} · ${appTitle}`;

  return (
    <CabinetShellServer
      user={user}
      nav={nav.map(([key, label]) => ({ key, label }))}
      showOwner={showOwner}
      title={title}
      subtitle={subtitle}
      pathname={pathname}
    >
      {children}
    </CabinetShellServer>
  );
}
