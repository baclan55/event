import { requirePortalUser } from '@/lib/cabinetData';
import { PayoutLogInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function PayoutLogPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  await requirePortalUser();
  const { weekId } = await params;
  return <PayoutLogInteractive weekId={Number(weekId)} />;
}
