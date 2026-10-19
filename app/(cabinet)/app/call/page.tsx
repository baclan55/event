import { loadCandidates, requirePortalUser } from '@/lib/cabinetData';
import { loadCallSheet } from '@/lib/callSheet';
import { CallInteractive } from '@/components/cabinet/InteractiveCore';
import { roleCtxFromPublic, userHasPermission } from '@/lib/roleAccess';

export const dynamic = 'force-dynamic';

export default async function CallPage() {
  const user = await requirePortalUser();
  const [candidates, sheet] = await Promise.all([loadCandidates(), loadCallSheet()]);
  return (
    <CallInteractive
      initialCandidates={candidates}
      initialSheet={sheet}
      canEdit={userHasPermission(roleCtxFromPublic(user), 'candidates', 'edit')}
    />
  );
}
