import { requirePortalUser } from '@/lib/cabinetData';
import { PayoutsListInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  await requirePortalUser();
  return <PayoutsListInteractive />;
}
