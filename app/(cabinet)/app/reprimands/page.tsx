import { loadReprimandsAdmin, requirePortalUser } from '@/lib/cabinetData';
import { ReprimandsView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function ReprimandsPage() {
  await requirePortalUser();
  const data = await loadReprimandsAdmin();
  return <ReprimandsView reprimands={data.reprimands} />;
}
