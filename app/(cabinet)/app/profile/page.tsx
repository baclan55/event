import { loadReprimandsMe, requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';
import { listAudit } from '@/lib/audit';
import { evaluateAchievementsForUser, listProfileAchievementCatalog } from '@/lib/achievements';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePortalUser();
  const roleCtx = roleCtxFromPublic(user);
  const canViewAudit = userHasPermission(roleCtx, 'view_audit');
  await evaluateAchievementsForUser(user.id).catch(() => undefined);
  const [reprimands, audit, achievementCatalog] = await Promise.all([
    loadReprimandsMe(user.id),
    canViewAudit ? listAudit({ limit: 150, userId: user.id }) : Promise.resolve([]),
    listProfileAchievementCatalog(user.id),
  ]);
  const target = Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5;
  return (
    <ProfileInteractive
      initialUser={user}
      reprimands={reprimands}
      target={target}
      canViewAudit={canViewAudit}
      initialAudit={audit}
      initialAchievementCatalog={achievementCatalog}
    />
  );
}
