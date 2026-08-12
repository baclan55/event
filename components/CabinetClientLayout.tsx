'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type PortalUser } from '@/components/AuthProvider';
import { CabinetShell } from '@/components/CabinetShell';
import { userHasAnyRole } from '@/lib/roleAccess';

/** Клиентский каркас кабинета: сразу с user с сервера, без вечного «Загрузка…». */
export function CabinetClientLayout({
  initialUser,
  children,
}: {
  initialUser: PortalUser;
  children: React.ReactNode;
}) {
  const { setUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser, setUser]);

  useEffect(() => {
    if (initialUser.isBlocked && pathname !== '/app/blocked') {
      router.replace('/app/blocked');
      return;
    }
    const hasRole = userHasAnyRole({
      role_id: initialUser.roleId,
      is_owner: initialUser.isOwner,
      roleNames: initialUser.roles,
    });
    if (!initialUser.isBlocked && !hasRole && pathname !== '/app/pending') {
      router.replace('/app/pending');
    }
  }, [initialUser, pathname, router]);

  const hasRole = userHasAnyRole({
    role_id: initialUser.roleId,
    is_owner: initialUser.isOwner,
    roleNames: initialUser.roles,
  });

  if (initialUser.isBlocked || !hasRole) {
    return <>{children}</>;
  }

  return <CabinetShell user={initialUser}>{children}</CabinetShell>;
}
