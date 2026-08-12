import { loadApplications, requirePortalUser } from '@/lib/cabinetData';
import { ApplicationsInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  await requirePortalUser();
  const data = await loadApplications();
  return <ApplicationsInteractive initialRows={data.rows} initialIsOpen={data.isOpen} />;
}
