import { getCurrentUser, publicUser } from '@/lib/auth';
import { isApplicationsOpen } from '@/lib/cabinetData';
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
  const applyOpen = await isApplicationsOpen();

  return (
    <>
      <section className="site-hero">
        <div className="site-hero-bg" aria-hidden>
          <img src="/img/mountains-bg-sm.jpg?v=3" alt="" fetchPriority="high" />
        </div>
        <h1>Events Denver</h1>
        <p className="site-hero-sub">{subtitle}</p>
        <div className="site-hero-actions">
          {user ? (
            <a className="btn btn-primary" href="/app/dashboard">Открыть кабинет</a>
          ) : (
            <a className="btn btn-primary" href="/api/auth/discord?consent=1">Войти через Discord</a>
          )}
          {applyOpen ? (
            <a className="btn btn-ghost" href="/apply">Оставить заявку</a>
          ) : (
            <span className="btn btn-ghost" style={{ opacity: 0.6, cursor: 'default' }}>Набор закрыт</span>
          )}
        </div>
      </section>
      <section className="site-section">
        <p className="site-lead">
          Хотите стать частью команды, которая создаёт атмосферу сервера?
        </p>
        <p className="site-lead-sub">
          Тогда у Вас есть отличная возможность попробовать себя в роли Event Helper
          и внести свой вклад в развитие мероприятий!
        </p>

        <h2 className="site-h2">Что мы предлагаем вам?</h2>
        <ul className="site-list">
          <li>Опыт работы в команде мероприятий и помощь администрации в организации ивентов</li>
          <li>Возможность влиять на развитие мероприятий — предлагать новые форматы, идеи и концепции ивентов</li>
          <li>Возможность реализовывать собственные идеи и мероприятия, которые увидят все игроки сервера</li>
          <li>Карьерный рост внутри команды</li>
          <li>Дружный и весёлый коллектив, который всегда поможет и поддержит</li>
          <li>Поощрения за ваш труд и активность</li>
        </ul>

        <h2 className="site-h2">Что требуется от вас?</h2>
        <ul className="site-list">
          <li>Адекватность и стрессоустойчивость</li>
          <li>Креативное мышление и инициативность</li>
          <li>Желание помогать и развивать мероприятия</li>
        </ul>

        <h2 className="site-h2">Важная информация</h2>
        <p className="site-note">
          Event Helper не является администратором. Вы можете состоять в семье, фракции
          и продолжать игровую деятельность.
        </p>
        <p className="site-note">
          Также не забываем, что грамотная заявка — это ваша визитная карточка.
          Чем лучше будет оформлена ваша заявка, тем больше шансов у Вас появляется!
        </p>

        <div className="site-callout">
          <h3>Хотите стать частью команды?</h3>
          <div className="site-callout-underline" />
          {applyOpen ? (
            <a className="btn btn-primary" href="/apply">Подать заявку</a>
          ) : (
            <p className="role-tag">Набор в отдел сейчас закрыт.</p>
          )}
        </div>
      </section>
    </>
  );
}
