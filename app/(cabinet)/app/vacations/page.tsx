import { loadVacations, requirePortalUser } from '@/lib/cabinetData';
import { VacationsView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function VacationsPage() {
  await requirePortalUser();
  const rows = await loadVacations();
  return <VacationsView rows={rows} />;
}
