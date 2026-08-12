'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

export default function HomePage() {
  const { user, config } = useAuth();
  const enter = () => { window.location.href = user ? '/app/dashboard' : '/api/auth/discord?consent=1'; };
  return <><section className="site-hero"><h1>Events Denver</h1><p className="site-hero-sub">{config?.appSubtitle || 'Ивент-отдел сервера Denver'}</p><div className="site-hero-actions"><button className="btn btn-primary" onClick={enter}>{user ? 'Открыть кабинет' : 'Войти через Discord'}</button><Link className="btn btn-ghost" href="/apply">Оставить заявку</Link></div></section>
    <section className="site-section"><p className="site-lead">Проводим события, объединяющие сообщество.</p><h2 className="site-h2">Что вас ждёт</h2><ul className="site-list"><li>Внутренний кабинет сотрудников и актуальные материалы.</li><li>Календарь отпусков и учёт мероприятий за неделю.</li><li>Прозрачная подача и рассмотрение заявок в отдел.</li></ul><div className="site-callout"><h3>Хотите стать частью команды?</h3><div className="site-callout-underline" /><Link className="btn btn-primary" href="/apply">Подать заявку</Link></div></section></>;
}
