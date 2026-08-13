import { loadVacations, requirePortalUser } from '@/lib/cabinetData';
import { VacationsInteractive } from '@/components/cabinet/InteractiveCore';
import { userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function VacationsPage() {
  const user = await requirePortalUser();
  const rows = await loadVacations(user);
  return (
    <VacationsInteractive
      initialRows={rows}
      currentUserId={user.id}
      canReview={userHasPermission(
        { is_owner: user.isOwner, roleNames: user.roles, permissions: user.permissions },
        'vacations_review',
      )}
    />
  );
}
