import { loadLastWeekMp, loadProfileWeekly, loadReprimandsMe, requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasProfileOwnViewCap } from '@/lib/roleAccess';
import { listAudit } from '@/lib/audit';
import { evaluateAchievementsForUser, listProfileAchievementCatalog } from '@/lib/achievements';
import { invalidateUserCache } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePortalUser();
  const roleCtx = roleCtxFromPublic(user);
  const profileTabs = {
    reprimands: userHasProfileOwnViewCap(roleCtx, 'reprimands'),
    achievements: userHasProfileOwnViewCap(roleCtx, 'achievements'),
    events: userHasProfileOwnViewCap(roleCtx, 'events'),
    gmp: userHasProfileOwnViewCap(roleCtx, 'gmp'),
    audit: userHasProfileOwnViewCap(roleCtx, 'audit'),
    weekly_mp: userHasProfileOwnViewCap(roleCtx, 'weekly_mp'),
  };
  await evaluateAchievementsForUser(user.id).catch(() => undefined);
  const [{ weeklyEvents, weeklyTarget }, lastWeek, reprimands, audit, achievementCatalog] = await Promise.all([
    loadProfileWeekly(user.id),
    profileTabs.weekly_mp ? loadLastWeekMp(user.id) : Promise.resolve({ count: 0, rangeLabel: '' }),
    profileTabs.reprimands ? loadReprimandsMe(user.id) : Promise.resolve([]),
    profileTabs.audit ? listAudit({ limit: 150, userId: user.id }) : Promise.resolve([]),
    profileTabs.achievements ? listProfileAchievementCatalog(user.id) : Promise.resolve(undefined),
  ]);
  invalidateUserCache(user.id);
  return (
    <ProfileInteractive
      initialUser={{ ...user, weeklyEvents: profileTabs.weekly_mp ? weeklyEvents : 0 }}
      reprimands={reprimands}
      target={profileTabs.weekly_mp ? weeklyTarget : null}
      lastWeekMp={profileTabs.weekly_mp ? lastWeek.count : 0}
      lastWeekMpLabel={profileTabs.weekly_mp ? lastWeek.rangeLabel : ''}
      canViewAudit={profileTabs.audit}
      initialAudit={audit}
      initialAchievementCatalog={achievementCatalog}
      profileTabs={profileTabs}
    />
  );
}
