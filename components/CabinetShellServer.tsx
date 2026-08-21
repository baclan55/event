'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PublicUser } from '@/lib/authShared';
import { NavIcon } from '@/components/NavIcons';
import { ProfileGate } from '@/components/ProfileGate';
import { ConfirmHost } from '@/components/cabinet/interactive/shared';

type NavItem = { key: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_SCROLL_KEY = 'cabinet-nav-scroll';

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
  const navScrollRef = useRef<HTMLDivElement | null>(null);

  const active = (key: string) => {
    if (key === 'dashboard') {
      return pathname === '/app' || pathname === '/app/dashboard';
    }
    const href = `/app/${key}`;
    if (pathname === href) return true;
    if (pathname.startsWith(`${href}/`)) return true;
    return false;
  };

  function persistNavScroll() {
    const el = navScrollRef.current;
    if (!el) return;
    try {
      sessionStorage.setItem(NAV_SCROLL_KEY, String(el.scrollTop));
    } catch {
      /* ignore quota / private mode */
    }
  }

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    try {
      const raw = sessionStorage.getItem(NAV_SCROLL_KEY);
      if (raw != null) {
        const y = Number(raw);
        if (Number.isFinite(y) && y > 0) {
          el.scrollTop = y;
          // После гидрации/лейаута ещё раз — иначе браузер может успеть сбросить.
          requestAnimationFrame(() => {
            el.scrollTop = y;
          });
        }
      }
    } catch {
      /* ignore */
    }
    const onScroll = () => persistNavScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

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

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', sidebarOpen);
    return () => document.body.classList.remove('sidebar-open');
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen && !accountOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSidebarOpen(false);
      setAccountOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen, accountOpen]);

  return (
    <div id="app">
      <div className="bg-decor" />
      <button type="button" aria-label="Закрыть меню" className={`sidebar-scrim${sidebarOpen ? ' show' : ''}`} onClick={() => setSidebarOpen(false)} />
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
        <div className="nav-scroll" ref={navScrollRef}>
          {navGroups.map((group) => (
            <nav className="nav-group" key={group.label} aria-label={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  href={`/app/${item.key}`}
                  className={`nav-item${active(item.key) ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <NavIcon name={item.key} />
                  <span>{item.label}</span>
                </Link>
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
            <button type="button" className="icon-btn menu-toggle" aria-label="Открыть меню" aria-expanded={sidebarOpen} onClick={() => { setAccountOpen(false); setSidebarOpen(true); }}><NavIcon name="menu" /></button>
            <div><h1>{title}</h1><div className="sub">{subtitle}</div></div>
          </div>
          <div className="account-menu">
            <button type="button" className="account-widget" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}>
              <div className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.nickname || '?').slice(0, 1)}</div>
              <span className="name">{user.nickname}</span>
              <span className="chev">⌄</span>
            </button>
            {accountOpen && <div className="card account-dropdown">
              <a className="nav-item" href="/app/profile" onClick={() => setAccountOpen(false)}><NavIcon name="profile" /><span>Моя страница</span></a>
              <a className="nav-item" href="/api/auth/logout"><NavIcon name="logout" /><span>Выйти</span></a>
            </div>}
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
      {!user.profileComplete ? <ProfileGate user={user} /> : null}
      <ConfirmHost />
    </div>
  );
}
