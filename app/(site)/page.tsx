import { getCurrentUser, publicUser } from '@/lib/auth';
import { runtimeEnv } from '@/lib/runtimeEnv';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let user = null;
  try {
    user = publicUser(await getCurrentUser());
  } catch {
    user = null;
  }
  const subtitle = runtimeEnv('APP_SUBTITLE') || 'Ивент-отдел сервера Denver';

  return (
    <>
      <section className="site-hero">
        <div className="site-hero-bg" aria-hidden />
        <h1>Events Denver</h1>
        <p className="site-hero-sub">{subtitle}</p>
        <div className="site-hero-actions">
          {user ? (
            <a className="btn btn-primary" href="/app/dashboard">Открыть кабинет</a>
          ) : (
            <a className="btn btn-primary" href="/api/auth/discord?consent=1">Войти через Discord</a>
          )}
          <a className="btn btn-ghost" href="/apply">Оставить заявку</a>
        </div>
      </section>
      <section className="site-section">
        <p className="site-lead">Проводим события, объединяющие сообщество.</p>
        <h2 className="site-h2">Что вас ждёт</h2>
        <ul className="site-list">
          <li>Внутренний кабинет сотрудников и актуальные материалы.</li>
          <li>Календарь отпусков и учёт мероприятий за неделю.</li>
          <li>Прозрачная подача и рассмотрение заявок в отдел.</li>
        </ul>
        <div className="site-callout">
          <h3>Хотите стать частью команды?</h3>
          <div className="site-callout-underline" />
          <a className="btn btn-primary" href="/apply">Подать заявку</a>
        </div>
      </section>
    </>
  );
}
