import { redirect } from 'next/navigation';
import { getCurrentUser, publicUser } from '@/lib/auth';
import { CabinetClientLayout } from '@/components/CabinetClientLayout';

export const dynamic = 'force-dynamic';

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  let user = null;
  try {
    user = publicUser(await getCurrentUser());
  } catch (err) {
    console.error('[cabinet] Не удалось загрузить пользователя:', (err as Error).message);
  }

  if (!user) {
    redirect('/');
  }

  return <CabinetClientLayout initialUser={user}>{children}</CabinetClientLayout>;
}
