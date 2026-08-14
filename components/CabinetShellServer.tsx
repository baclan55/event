'use client';

import { useEffect, useState } from 'react';
import type { PublicUser } from '@/lib/authShared';
import { NavIcon } from '@/components/NavIcons';
import { ProfileGate } from '@/components/ProfileGate';
import { ConfirmHost } from '@/components/cabinet/interactive/shared';

type NavItem = { key: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

/** Чистый HTML-шелл кабинета — без client JS / AuthProvider. */
export function CabinetShellServer({
  user,
  navGroups,
  title,
  subtitle,
  pathname,
  children,
}: {
  user: PublicUser;
  navGroups: NavGroup[];
  title: string;
  subtitle: string;
  pathname: string;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [topbarHidden, setTopbarHidden] = useState(false);
  const [topbarScrolled, setTopbarScrolled] = useState(false);
  const active = (key: string) =>
    pathname === `/app/${key}`
    || pathname.startsWith(`/app/${key}/`)
    || (key === 'dashboard' && (pathname === '/app' || pathname === '/app/dashboard'));

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        setTopbarHidden(y > 80 && y > lastY);
        setTopbarScrolled(y > 80);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div id="app">
      <div className="bg-decor" />
      <button aria-label="Закрыть меню" className={`sidebar-scrim${sidebarOpen ? ' show' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">ED</div>
          <div className="brand-text">
            <div className="brand-title">Events Denver</div>
            <div className="brand-sub">Department Portal</div>
          </div>
        </div>
        <a href="/" className="nav-item nav-item-site">
          <NavIcon name="home" />
          <span>На сайт</span>
        </a>
        <div className="nav-scroll">
          {navGroups.map((group) => (
            <nav className="nav-group" key={group.label} aria-label={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <a
                  key={item.key}
                  href={`/app/${item.key}`}
                  className={`nav-item${active(item.key) ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <NavIcon name={item.key} />
                  <span>{item.label}</span>
                </a>
              ))}
            </nav>
          ))}
        </div>
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
        <header className={`topbar${topbarHidden ? ' topbar-hidden' : ''}${topbarScrolled ? ' topbar-scrolled' : ''}`}>
          <div className="topbar-titles">
            <button type="button" className="icon-btn menu-toggle" aria-label="Открыть меню" onClick={() => setSidebarOpen(true)}><NavIcon name="menu" /></button>
            <div><h1>{title}</h1><div className="sub">{subtitle}</div></div>
          </div>
          <button type="button" className="account-widget" onClick={() => setAccountOpen(!accountOpen)}>
            <div className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.nickname || '?').slice(0, 1)}</div>
            <span className="name">{user.nickname}</span>
            <span className="chev">⌄</span>
          </button>
          {accountOpen && <div className="card account-dropdown">
            <a className="nav-item" href="/app/profile"><NavIcon name="profile" /><span>Моя страница</span></a>
            <a className="nav-item" href="/api/auth/logout"><NavIcon name="logout" /><span>Выйти</span></a>
          </div>}
        </header>
        <div className="content">{children}</div>
      </main>
      {!user.profileComplete ? <ProfileGate user={user} /> : null}
      <ConfirmHost />
    </div>
  );
}
