import { loadCandidates, requirePortalUser } from '@/lib/cabinetData';
import { ApplicationsView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function CandidatesPage() {
  await requirePortalUser();
  const rows = await loadCandidates();
  return <ApplicationsView rows={rows} candidates />;
}
