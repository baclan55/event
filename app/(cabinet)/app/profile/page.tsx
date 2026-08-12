import { loadReprimandsMe, requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { runtimeEnv } from '@/lib/runtimeEnv';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePortalUser();
  const reprimands = await loadReprimandsMe(user.id);
  const target = Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5;
  return <ProfileInteractive initialUser={user} reprimands={reprimands} target={target} />;
}
