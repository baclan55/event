'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function SiteHeader() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-brand">
          <span className="site-brand-mark">ED</span>
          <span className="site-brand-name">EVENTS DENVER</span>
        </Link>
        <nav className="site-nav">
          <Link className={`site-nav-link${pathname === '/apply' ? ' active' : ''}`} href="/apply">
            Оставить заявку
          </Link>
          {user ? (
            <Link className="btn btn-primary btn-sm" href="/app/dashboard">В кабинет</Link>
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
