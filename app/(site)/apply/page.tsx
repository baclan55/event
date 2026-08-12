import { getCurrentUser, publicUser } from '@/lib/auth';
import { ApplyForm } from '@/components/ApplyForm';

export const dynamic = 'force-dynamic';

export default async function ApplyPage() {
  let user = null;
  try {
    user = publicUser(await getCurrentUser());
  } catch {
    user = null;
  }

  if (!user) {
    return (
      <>
        <div className="site-page-head">
          <h1>Заявка в отдел</h1>
          <p>Для отправки анкеты необходимо войти через Discord.</p>
        </div>
        <div className="qform">
          <div className="qform-card">
            <a className="btn btn-discord" href="/api/auth/discord?consent=1&returnTo=apply">
              Войти через Discord
            </a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="site-page-head">
        <h1>Заявка в Event Department</h1>
        <p>Заполните все поля — после проверки с вами свяжется руководство.</p>
      </div>
      <ApplyForm />
    </>
  );
}
