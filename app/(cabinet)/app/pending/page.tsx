import { AccessView } from '@/components/cabinet/SsrViews';

export const dynamic = 'force-dynamic';

export default function PendingPage() {
  return <AccessView blocked={false} />;
}
