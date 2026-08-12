import { AccessView } from '@/components/cabinet/SsrViews';
import { requirePortalUser } from '@/lib/cabinetData';

export const dynamic = 'force-dynamic';

export default async function BlockedPage() {
  const user = await requirePortalUser();
  return <AccessView blocked blockedAt={user.blockedAt} />;
}
