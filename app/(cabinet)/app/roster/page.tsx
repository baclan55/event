import { loadRoster, requirePortalUser } from '@/lib/cabinetData';
import { RosterView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default async function RosterPage() {
  await requirePortalUser();
  const data = await loadRoster();
  return <RosterView members={data.members} />;
}
