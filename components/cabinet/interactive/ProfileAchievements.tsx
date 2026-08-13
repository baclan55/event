'use client';

import { useState } from 'react';

export type ProfileAchievementCard = {
  id: number;
  name: string;
  description: string;
  icon: string;
  max_grade: number;
  grade: number;
  awarded_at: string | null;
  status: 'earned' | 'locked' | 'hidden';
  is_hidden: boolean;
  next_hint: string;
};

export type ProfileAchievementCatalog = {
  earned: ProfileAchievementCard[];
  locked: ProfileAchievementCard[];
  hidden: ProfileAchievementCard[];
};

function AchievementCard({ item }: { item: ProfileAchievementCard }) {
  const earned = item.status === 'earned';
  const gradeLabel = item.max_grade > 1
    ? (earned ? `${item.grade}/${item.max_grade} ст.` : `до ${item.max_grade} ст.`)
    : '';

  return (
    <article className={`ach-card${earned ? '' : ' is-locked'}${item.status === 'hidden' ? ' is-secret' : ''}`}>
      <div className="ach-card-medal">
        {item.icon
          ? <img src={item.icon} alt="" className="ach-card-icon" />
          : <span className="ach-card-icon-fallback">★</span>}
      </div>
      <div className="ach-card-body">
        <div className="ach-card-head">
          <h4 className="ach-card-title">
            {item.name}
            {gradeLabel ? <span className="ach-card-grade"> · {gradeLabel}</span> : null}
          </h4>
          {earned && item.awarded_at ? (
            <span className="ach-card-meta">{new Date(item.awarded_at).toLocaleDateString('ru-RU')}</span>
          ) : null}
        </div>
        {earned && item.description ? (
          <p className="ach-card-desc">{item.description}</p>
        ) : (
          <p className="ach-card-desc is-muted">
            {item.status === 'hidden'
              ? 'Скрытое достижение. Описание откроется после получения.'
              : 'Описание откроется после получения.'}
          </p>
        )}
        {earned && item.next_hint ? (
          <div className="ach-card-next">{item.next_hint}</div>
        ) : null}
      </div>
    </article>
  );
}

export function ProfileAchievementsPanel({
  catalog,
}: {
  catalog: ProfileAchievementCatalog;
}) {
  const [section, setSection] = useState<'earned' | 'locked' | 'hidden'>('earned');
  const lists = {
    earned: catalog.earned || [],
    locked: catalog.locked || [],
    hidden: catalog.hidden || [],
  };
  const items = lists[section];
  const total = lists.earned.length + lists.locked.length + lists.hidden.length;

  return (
    <>
      <div className="card-header">
        <h3>Достижения</h3>
        <span className="badge badge-muted">{lists.earned.length} / {total || '—'}</span>
      </div>
      <div className="segmented ach-subtabs" style={{ marginBottom: 14 }}>
        <button type="button" className={section === 'earned' ? 'active' : ''} onClick={() => setSection('earned')}>
          Полученные · {lists.earned.length}
        </button>
        <button type="button" className={section === 'locked' ? 'active' : ''} onClick={() => setSection('locked')}>
          Не полученные · {lists.locked.length}
        </button>
        <button type="button" className={section === 'hidden' ? 'active' : ''} onClick={() => setSection('hidden')}>
          Скрытое · {lists.hidden.length}
        </button>
      </div>
      <div className="ach-card-list">
        {items.length
          ? items.map((item) => <AchievementCard key={item.id} item={item} />)
          : (
            <div className="empty-state">
              <h3>Пока пусто</h3>
              <p>
                {section === 'earned'
                  ? 'Полученных достижений пока нет.'
                  : section === 'locked'
                    ? 'Все открытые достижения уже получены.'
                    : 'Скрытых неполученных достижений нет.'}
              </p>
            </div>
          )}
      </div>
    </>
  );
}

export function emptyAchievementCatalog(): ProfileAchievementCatalog {
  return { earned: [], locked: [], hidden: [] };
}

export function catalogFromPayload(data: Partial<ProfileAchievementCatalog> & { achievements?: ProfileAchievementCard[] }): ProfileAchievementCatalog {
  if (Array.isArray(data.earned) || Array.isArray(data.locked) || Array.isArray(data.hidden)) {
    return {
      earned: data.earned || [],
      locked: data.locked || [],
      hidden: data.hidden || [],
    };
  }
  // Совместимость со старым ответом API (только полученные).
  return {
    earned: Array.isArray(data.achievements) ? data.achievements : [],
    locked: [],
    hidden: [],
  };
}
