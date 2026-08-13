import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Панель владельца удалена — редирект на роли / профиль. */
export default function OwnerPage() {
  redirect('/app/roles');
}
