'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type PortalUser } from '@/components/AuthProvider';
import { api } from '@/lib/client/api';
import { userHasPermission, type Permission } from '@/lib/roleAccess';

const items: Array<[string, string, Permission | null]> = [
  ['dashboard', 'Главная', null],
  ['profile', 'Моя страница', null],
  ['faq', 'FAQ', null],
  ['roster', 'Состав', null],
  ['rules', 'Правила МП', null],
  ['regulations', 'Регламент', null],
  ['first-steps', 'Первые шаги', null],
  ['vacations', 'Отпуска', null],
  ['reprimands', 'Система выговоров', 'reprimands'],
  ['applications', 'Заявки', 'applications'],
  ['candidates', 'Кандидаты', 'candidates'],
  ['roles', 'Роли и доступы', 'manage_roles'],
];

export function CabinetShell({
  children,
  user: userProp,
}: {
  children: React.ReactNode;
  user?: PortalUser | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user: ctxUser, config, setUser } = useAuth();
  const user = userProp ?? ctxUser;
  const roleCtx = {
    is_owner: user?.isOwner,
    roleNames: user?.roles,
    permissions: user?.permissions,
  };
  const logout = async () => { await api.post('/api/auth/logout'); setUser(null); router.replace('/'); };
  const visible = items.filter((item) => !item[2] || userHasPermission(roleCtx, item[2]));
  return <div id="app"><div className="bg-decor" /><aside className="sidebar">
    <div className="brand"><div className="brand-mark">ED</div><div className="brand-text"><div className="brand-title">Events Denver</div><div className="brand-sub">Department Portal</div></div></div>
    <Link href="/" className="nav-item">⌂ <span>На сайт</span></Link>
    <nav className="nav-group">{visible.map(([key, label]) => <Link key={key} href={`/app/${key}`} className={`nav-item${pathname === `/app/${key}` || (key === 'dashboard' && pathname === '/app') ? ' active' : ''}`}>{label}</Link>)}</nav>
    <div className="sidebar-spacer" /><div className="sidebar-user"><div className="avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.nickname || '?').slice(0, 1)}</div><div className="sidebar-user-info"><div className="sidebar-user-name">{user?.nickname}</div><div className="sidebar-user-role">{user?.roles.join(' · ') || 'Без роли'}</div></div><button className="icon-btn" onClick={() => void logout()}>↪</button></div>
  </aside><main className="main"><header className="topbar"><div className="topbar-titles"><h1>{items.find((item) => pathname.endsWith(item[0]))?.[1] ?? 'Главная'}</h1><div className="sub">{config?.appSubtitle}</div></div><Link className="account-widget" href="/app/profile"><span className="name">{user?.nickname}</span></Link></header><div className="content">{children}</div></main></div>;
}
