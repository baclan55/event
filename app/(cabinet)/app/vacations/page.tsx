import { loadVacations, requirePortalUser } from '@/lib/cabinetData';
import { VacationsInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function VacationsPage() {
  const user = await requirePortalUser();
  const rows = await loadVacations(user);
  const roleCtx = roleCtxFromPublic(user);
  return (
    <VacationsInteractive
      initialRows={rows}
      currentUserId={user.id}
      canReview={userHasPermission(roleCtx, 'vacations_review')}
      canEditReview={userHasPermission(roleCtx, 'vacations_review', 'edit')}
    />
  );
}
