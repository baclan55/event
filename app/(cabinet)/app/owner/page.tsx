import { requirePortalUser } from '@/lib/cabinetData';
import { OwnerInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function OwnerPage() {
  const user = await requirePortalUser();
  return <OwnerInteractive canManageOwners={user.isOwner} />;
}
