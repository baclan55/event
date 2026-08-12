import { requirePortalUser } from '@/lib/cabinetData';
import { ReprimandsInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function ReprimandsPage() {
  await requirePortalUser();
  return <ReprimandsInteractive />;
}
