import { loadCandidates, requirePortalUser } from '@/lib/cabinetData';
import { ApplicationsInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function CandidatesPage() {
  await requirePortalUser();
  const rows = await loadCandidates();
  return <ApplicationsInteractive initialRows={rows} candidates />;
}
