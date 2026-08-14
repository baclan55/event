import { requirePortalUser } from '@/lib/cabinetData';
import { PayoutWeekInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function PayoutWeekPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  await requirePortalUser();
  const { weekId } = await params;
  return <PayoutWeekInteractive weekId={Number(weekId)} />;
}
