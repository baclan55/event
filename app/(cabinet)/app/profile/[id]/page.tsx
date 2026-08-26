import { notFound, redirect } from 'next/navigation';
import { invalidateUserCache, loadUserById, publicUser } from '@/lib/auth';
import { evaluateAchievementsForUser, listProfileAchievementCatalog } from '@/lib/achievements';
import { loadLastWeekMp, loadProfileWeekly, requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasProfileViewCap } from '@/lib/roleAccess';
import { listAudit } from '@/lib/audit';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requirePortalUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id) || id <= 0) notFound();
  if (id === viewer.id) redirect('/app/profile');

  const dbUser = await loadUserById(id);
  const user = publicUser(dbUser);
  if (!user) notFound();

  const roleCtx = roleCtxFromPublic(viewer);
  const profileTabs = {
    reprimands: userHasProfileViewCap(roleCtx, 'reprimands'),
    achievements: userHasProfileViewCap(roleCtx, 'achievements'),
    events: userHasProfileViewCap(roleCtx, 'events'),
    gmp: userHasProfileViewCap(roleCtx, 'gmp'),
    audit: userHasProfileViewCap(roleCtx, 'audit'),
    weekly_mp: userHasProfileViewCap(roleCtx, 'weekly_mp'),
  };

  await evaluateAchievementsForUser(id).catch(() => undefined);
  const [{ weeklyEvents, weeklyTarget }, lastWeek, achievementCatalog] = await Promise.all([
    loadProfileWeekly(id),
    profileTabs.weekly_mp ? loadLastWeekMp(id) : Promise.resolve({ count: 0, rangeLabel: '' }),
    profileTabs.achievements
      ? listProfileAchievementCatalog(id, viewer.id)
      : Promise.resolve(undefined),
  ]);
  invalidateUserCache(id);
  let reprimands: Record<string, unknown>[] = [];
  if (profileTabs.reprimands) {
    const result = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
        ib.nickname AS issued_by_nickname
       FROM reprimands rp LEFT JOIN users ib ON ib.id = rp.issued_by
       WHERE rp.user_id=$1 ORDER BY rp.created_at DESC`,
      [id],
    );
    reprimands = result.rows;
  }
  const audit = profileTabs.audit ? await listAudit({ limit: 150, userId: id }) : [];

  return (
    <ProfileInteractive
      initialUser={{ ...user, weeklyEvents: profileTabs.weekly_mp ? weeklyEvents : 0 }}
      reprimands={reprimands}
      target={profileTabs.weekly_mp ? weeklyTarget : null}
      lastWeekMp={profileTabs.weekly_mp ? lastWeek.count : 0}
      lastWeekMpLabel={profileTabs.weekly_mp ? lastWeek.rangeLabel : ''}
      canViewAudit={profileTabs.audit}
      initialAudit={audit}
      isSelf={false}
      initialAchievementCatalog={achievementCatalog}
      profileTabs={profileTabs}
    />
  );
}
