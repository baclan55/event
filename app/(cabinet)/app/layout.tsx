'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { CabinetShell } from '@/components/CabinetShell';

export default function CabinetLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth(); const router = useRouter(); const pathname = usePathname();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/');
    else if (user.isBlocked && pathname !== '/app/blocked') router.replace('/app/blocked');
    else if (!user.isBlocked && !user.roleId && !user.isOwner && pathname !== '/app/pending') router.replace('/app/pending');
  }, [user, loading, pathname, router]);
  if (loading || !user) return <div className="empty-state">Загрузка…</div>;
  if (user.isBlocked || (!user.roleId && !user.isOwner)) return <>{children}</>;
  return <CabinetShell>{children}</CabinetShell>;
}
