import { requirePortalUser } from '@/lib/cabinetData';
import { OwnerInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function OwnerPage() {
  await requirePortalUser();
  return <OwnerInteractive />;
}
