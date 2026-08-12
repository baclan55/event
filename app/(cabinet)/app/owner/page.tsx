import { loadOwnerUsers, requirePortalUser } from '@/lib/cabinetData';
import { OwnerView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function OwnerPage() {
  await requirePortalUser();
  const data = await loadOwnerUsers();
  return <OwnerView users={data.users} />;
}
