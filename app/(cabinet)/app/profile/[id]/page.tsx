import { notFound, redirect } from 'next/navigation';
import { loadUserById, publicUser } from '@/lib/auth';
import { evaluateAchievementsForUser, listProfileAchievementCatalog } from '@/lib/achievements';
import { requirePortalUser } from '@/lib/cabinetData';
import { ProfileInteractive } from '@/components/cabinet/InteractiveCore';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';
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

  await evaluateAchievementsForUser(id).catch(() => undefined);
  const achievementCatalog = await listProfileAchievementCatalog(id);
  const roleCtx = roleCtxFromPublic(viewer);
  const canSeeReprimands = userHasPermission(roleCtx, 'reprimands');
  const canViewAudit = userHasPermission(roleCtx, 'view_audit');
  let reprimands: Record<string, unknown>[] = [];
  if (canSeeReprimands) {
    const result = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
        ib.nickname AS issued_by_nickname
       FROM reprimands rp LEFT JOIN users ib ON ib.id = rp.issued_by
       WHERE rp.user_id=$1 ORDER BY rp.created_at DESC`,
      [id],
    );
    reprimands = result.rows;
  }
  const audit = canViewAudit ? await listAudit({ limit: 150, userId: id }) : [];

  const target = Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5;
  return (
    <ProfileInteractive
      initialUser={user}
      reprimands={reprimands}
      target={target}
      canViewAudit={canViewAudit}
      initialAudit={audit}
      isSelf={false}
      initialAchievementCatalog={achievementCatalog}
    />
  );
}
