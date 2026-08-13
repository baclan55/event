import { GmpDetailInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function GmpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = Number.parseInt(id, 10);
  if (!Number.isFinite(eventId)) {
    return <div className="empty-state"><h3>ГМП не найдено</h3></div>;
  }
  return <GmpDetailInteractive eventId={eventId} />;
}
