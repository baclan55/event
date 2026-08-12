import type { PublicUser } from '@/lib/auth';
import { NavIcon } from '@/components/NavIcons';

type NavItem = { key: string; label: string };

/** Чистый HTML-шелл кабинета — без client JS / AuthProvider. */
export function CabinetShellServer({
  user,
  nav,
  showOwner,
  title,
  subtitle,
  pathname,
  children,
}: {
  user: PublicUser;
  nav: NavItem[];
  showOwner: boolean;
  title: string;
  subtitle: string;
  pathname: string;
  children: React.ReactNode;
}) {
  const active = (key: string) =>
    pathname === `/app/${key}` || (key === 'dashboard' && (pathname === '/app' || pathname === '/app/dashboard'));

  return (
    <div id="app">
      <div className="bg-decor" />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ED</div>
          <div className="brand-text">
            <div className="brand-title">Events Denver</div>
            <div className="brand-sub">Department Portal</div>
          </div>
        </div>
        <a href="/" className="nav-item">
          <NavIcon name="home" />
          <span>На сайт</span>
        </a>
        <nav className="nav-group">
          {nav.map((item) => (
            <a
              key={item.key}
              href={`/app/${item.key}`}
              className={`nav-item${active(item.key) ? ' active' : ''}`}
            >
              <NavIcon name={item.key} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        {showOwner ? (
          <div className="nav-group">
            <div className="nav-label">Владелец</div>
            <a href="/app/owner" className={`nav-item${pathname === '/app/owner' ? ' active' : ''}`}>
              <NavIcon name="owner" />
              <span>Панель владельца</span>
            </a>
          </div>
        ) : null}
        <div className="sidebar-spacer" />
        <div className="sidebar-user">
          <div className="avatar">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.nickname || '?').slice(0, 1)}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.nickname}</div>
            <div className="sidebar-user-role">{user.roles.join(' · ') || 'Без роли'}</div>
          </div>
          <a className="icon-btn" href="/api/auth/logout" title="Выйти">
            <NavIcon name="logout" />
          </a>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-titles">
            <h1>{title}</h1>
            <div className="sub">{subtitle}</div>
          </div>
          <a className="account-widget" href="/app/profile">
            <span className="name">{user.nickname}</span>
          </a>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
