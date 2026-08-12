'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { api } from '@/lib/client/api';
import { APPLICATIONS_ROLES, CANDIDATES_ROLES, OWNER_PANEL_ROLES, REPRIMANDS_ROLES, userHasRoleIn } from '@/lib/roleAccess';

const items = [
  ['dashboard', 'Главная'], ['profile', 'Моя страница'], ['faq', 'FAQ'], ['roster', 'Состав'], ['rules', 'Правила МП'],
  ['regulations', 'Регламент'], ['first-steps', 'Первые шаги'], ['vacations', 'Отпуска'],
  ['reprimands', 'Система выговоров', REPRIMANDS_ROLES], ['applications', 'Заявки', APPLICATIONS_ROLES], ['candidates', 'Кандидаты', CANDIDATES_ROLES],
] as const;

export function CabinetShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const { user, config, setUser } = useAuth();
  const logout = async () => { await api.post('/api/auth/logout'); setUser(null); router.replace('/'); };
  const visible = items.filter((item) => !item[2] || userHasRoleIn({ is_owner: user?.isOwner, roleNames: user?.roles }, item[2]));
  return <div id="app"><div className="bg-decor" /><aside className="sidebar">
    <div className="brand"><div className="brand-mark">ED</div><div className="brand-text"><div className="brand-title">Events Denver</div><div className="brand-sub">Department Portal</div></div></div>
    <Link href="/" className="nav-item">⌂ <span>На сайт</span></Link>
    <nav className="nav-group">{visible.map(([key, label]) => <Link key={key} href={`/app/${key}`} className={`nav-item${pathname === `/app/${key}` || (key === 'dashboard' && pathname === '/app') ? ' active' : ''}`}>{label}</Link>)}</nav>
    {userHasRoleIn({ is_owner: user?.isOwner, roleNames: user?.roles }, OWNER_PANEL_ROLES) && <div className="nav-group"><div className="nav-label">Владелец</div><Link href="/app/owner" className={`nav-item${pathname === '/app/owner' ? ' active' : ''}`}>Панель владельца</Link></div>}
    <div className="sidebar-spacer" /><div className="sidebar-user"><div className="avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.nickname || '?').slice(0, 1)}</div><div className="sidebar-user-info"><div className="sidebar-user-name">{user?.nickname}</div><div className="sidebar-user-role">{user?.roles.join(' · ') || 'Без роли'}</div></div><button className="icon-btn" onClick={() => void logout()}>↪</button></div>
  </aside><main className="main"><header className="topbar"><div className="topbar-titles"><h1>{items.find((item) => pathname.endsWith(item[0]))?.[1] ?? (pathname.endsWith('owner') ? 'Панель владельца' : 'Главная')}</h1><div className="sub">{config?.appSubtitle}</div></div><Link className="account-widget" href="/app/profile"><span className="name">{user?.nickname}</span></Link></header><div className="content">{children}</div></main></div>;
}
