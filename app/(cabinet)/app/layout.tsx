'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { CabinetShell } from '@/components/CabinetShell';
import { userHasAnyRole } from '@/lib/roleAccess';

export default function CabinetLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, error, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (user.isBlocked && pathname !== '/app/blocked') {
      router.replace('/app/blocked');
      return;
    }
    const hasRole = userHasAnyRole({
      role_id: user.roleId,
      is_owner: user.isOwner,
      roleNames: user.roles,
    });
    if (!user.isBlocked && !hasRole && pathname !== '/app/pending') {
      router.replace('/app/pending');
    }
  }, [user, loading, pathname, router]);

  if (loading) {
    return <div className="empty-state">Загрузка…</div>;
  }

  if (!user) {
    return (
      <div className="empty-state" style={{ maxWidth: 480, margin: '80px auto' }}>
        <h3>Сессия не найдена</h3>
        <p>{error || 'Войдите через Discord ещё раз.'}</p>
        <p style={{ marginTop: 16 }}>
          <a className="btn btn-primary" href="/api/auth/discord?consent=1">Войти через Discord</a>
          {' '}
          <Link className="btn btn-ghost" href="/">На главную</Link>
          {' '}
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>Повторить</button>
        </p>
      </div>
    );
  }

  const hasRole = userHasAnyRole({
    role_id: user.roleId,
    is_owner: user.isOwner,
    roleNames: user.roles,
  });

  if (user.isBlocked || !hasRole) {
    return <>{children}</>;
  }

  return <CabinetShell>{children}</CabinetShell>;
}
