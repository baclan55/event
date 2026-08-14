import { getCurrentUser, publicUser } from '@/lib/auth';
import { isApplicationsOpen } from '@/lib/cabinetData';
import { runtimeEnv } from '@/lib/runtimeEnv';

export const dynamic = 'force-dynamic';

const offers = [
  'Опыт работы в команде мероприятий и помощь в организации ивентов',
  'Влияние на развитие форматов — предлагайте идеи и концепции',
  'Свои мероприятия, которые увидит весь сервер',
  'Карьерный рост внутри отдела',
  'Дружный коллектив, который поддержит',
  'Поощрения за труд и активность',
];

const needs = [
  'Адекватность и стрессоустойчивость',
  'Креативное мышление и инициативность',
  'Желание помогать и развивать мероприятия',
];

export default async function HomePage() {
  let user = null;
  try {
    user = publicUser(await getCurrentUser());
  } catch {
    user = null;
  }
  const subtitle = runtimeEnv('APP_SUBTITLE') || 'Ивент-отдел сервера Denver';
  const applyOpen = await isApplicationsOpen();

  return (
    <>
      <section className="site-hero site-hero-home">
        <div className="site-hero-bg" aria-hidden>
          <img src="/img/mountains-bg-sm.jpg?v=3" alt="" fetchPriority="high" />
        </div>
        <div className="site-hero-inner">
          <h1 className="site-hero-brand">Events Denver</h1>
          <p className="site-hero-sub">{subtitle}</p>
          <div className="site-hero-actions">
            {user ? (
              <a className="btn btn-primary" href="/app/dashboard">Открыть кабинет</a>
            ) : (
              <a className="btn btn-primary" href="/api/auth/discord?consent=1">Войти через Discord</a>
            )}
            {applyOpen ? (
              <a className="btn btn-ghost site-hero-ghost" href="/apply">Оставить заявку</a>
            ) : (
              <span className="btn btn-ghost site-hero-ghost is-disabled">Набор закрыт</span>
            )}
          </div>
        </div>
      </section>

      <div className="site-home">
        <section className="site-block site-block-intro">
          <h2 className="site-block-title">Станьте частью атмосферы сервера</h2>
          <p className="site-block-text">
            Попробуйте себя в роли Event Helper и внесите вклад в развитие мероприятий Denver.
          </p>
        </section>

        <section className="site-block">
          <h2 className="site-block-title">Что мы предлагаем</h2>
          <ol className="site-offer-list">
            {offers.map((item, index) => (
              <li key={item}>
                <span className="site-offer-num">{String(index + 1).padStart(2, '0')}</span>
                <span className="site-offer-text">{item}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="site-block">
          <h2 className="site-block-title">Что нужно от вас</h2>
          <ul className="site-need-list">
            {needs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="site-block site-block-aside">
          <h2 className="site-block-title">Важно знать</h2>
          <p className="site-block-text">
            Event Helper не администратор: можно оставаться в семье, фракции и продолжать игру.
          </p>
          <p className="site-block-text">
            Грамотная заявка — ваша визитная карточка. Чем она сильнее, тем выше шансы.
          </p>
        </section>

        <section className="site-block site-block-cta">
          <h2 className="site-block-title">Готовы присоединиться?</h2>
          <p className="site-block-text">Оставьте заявку — после проверки с вами свяжется руководство.</p>
          {applyOpen ? (
            <a className="btn btn-primary" href="/apply">Подать заявку</a>
          ) : (
            <p className="site-cta-closed">Набор в отдел сейчас закрыт.</p>
          )}
        </section>
      </div>
    </>
  );
}
