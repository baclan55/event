import { loadReprimandsMe, requirePortalUser } from '@/lib/cabinetData';
import { ProfileView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePortalUser();
  const reprimands = await loadReprimandsMe(user.id);
  return <ProfileView user={user} reprimands={reprimands} />;
}
