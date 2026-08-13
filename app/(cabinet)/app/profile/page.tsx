import { loadProfileWeekly, loadReprimandsMe, requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';
import { listAudit } from '@/lib/audit';
import { evaluateAchievementsForUser, listProfileAchievementCatalog } from '@/lib/achievements';
import { invalidateUserCache } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePortalUser();
  const roleCtx = roleCtxFromPublic(user);
  const canViewAudit = userHasPermission(roleCtx, 'view_audit');
  await evaluateAchievementsForUser(user.id).catch(() => undefined);
  const [{ weeklyEvents, weeklyTarget }, reprimands, audit, achievementCatalog] = await Promise.all([
    loadProfileWeekly(user.id),
    loadReprimandsMe(user.id),
    canViewAudit ? listAudit({ limit: 150, userId: user.id }) : Promise.resolve([]),
    listProfileAchievementCatalog(user.id),
  ]);
  invalidateUserCache(user.id);
  return (
    <ProfileInteractive
      initialUser={{ ...user, weeklyEvents }}
      reprimands={reprimands}
      target={weeklyTarget}
      canViewAudit={canViewAudit}
      initialAudit={audit}
      initialAchievementCatalog={achievementCatalog}
    />
  );
}
