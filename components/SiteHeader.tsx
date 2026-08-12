import { getCurrentUser, publicUser } from '@/lib/auth';

export async function SiteHeader({ pathname = '/' }: { pathname?: string }) {
  let user = null;
  try {
    user = publicUser(await getCurrentUser());
  } catch {
    user = null;
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="site-brand">
          <span className="site-brand-mark">ED</span>
          <span className="site-brand-name">EVENTS DENVER</span>
        </a>
        <nav className="site-nav">
          <a className={`site-nav-link${pathname === '/apply' ? ' active' : ''}`} href="/apply">
            Оставить заявку
          </a>
          {user ? (
            <a className="btn btn-primary btn-sm" href="/app/dashboard">В кабинет</a>
          ) : (
            <a className="btn btn-primary btn-sm" href="/api/auth/discord?consent=1">
              Войти через Discord
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
