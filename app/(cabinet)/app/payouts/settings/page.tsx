import { requirePortalUser } from '@/lib/cabinetData';
import { PayoutSettingsInteractive } from '@/components/cabinet/InteractiveCore';

export const dynamic = 'force-dynamic';

export default async function PayoutSettingsPage() {
  await requirePortalUser();
  return <PayoutSettingsInteractive />;
}
