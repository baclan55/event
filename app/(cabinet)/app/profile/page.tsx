import { loadReprimandsMe, requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { userHasPermission } from '@/lib/roleAccess';
import { listAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePortalUser();
  const roleCtx = {
    is_owner: user.isOwner,
    roleNames: user.roles,
    permissions: user.permissions,
  };
  const canViewAudit = userHasPermission(roleCtx, 'view_audit');
  const [reprimands, audit] = await Promise.all([
    loadReprimandsMe(user.id),
    canViewAudit ? listAudit(150) : Promise.resolve([]),
  ]);
  const target = Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5;
  return (
    <ProfileInteractive
      initialUser={user}
      reprimands={reprimands}
      target={target}
      canViewAudit={canViewAudit}
      initialAudit={audit}
    />
  );
}
