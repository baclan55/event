'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function SiteHeader() {
  const pathname = usePathname();
  const { user } = useAuth();
  const enter = () => { window.location.href = user ? '/app/dashboard' : '/api/auth/discord?consent=1'; };
  return <header className="site-header"><div className="site-header-inner">
    <Link href="/" className="site-brand"><span className="site-brand-mark">ED</span><span className="site-brand-name">EVENTS DENVER</span></Link>
    <nav className="site-nav"><Link className={`site-nav-link${pathname === '/apply' ? ' active' : ''}`} href="/apply">Оставить заявку</Link>
      <button className="btn btn-primary btn-sm" onClick={enter}>{user ? 'В кабинет' : 'Войти через Discord'}</button>
    </nav>
  </div></header>;
}
