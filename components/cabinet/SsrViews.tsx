import type { PublicUser } from '@/lib/authShared';
import { fmtDate } from '@/lib/formatDate';
import { NavIcon } from '@/components/NavIcons';

type Row = Record<string, any>;

function Avatar({ row }: { row: Row }) {
  const src = row.avatar_url || row.avatarUrl;
  const letter = String(row.nickname || row.user_nickname || '?').slice(0, 1);
  return <div className="avatar">{src ? <img src={src} alt="" /> : letter}</div>;
}

export function DashboardView({
  members,
  blocks = { stats: true, top_admin: true, top_helper: true },
  todayMpCount = 0,
  weekMpCount = 0,
  todayMp = [],
}: {
  members: Row[];
  target?: number | null;
  blocks?: { stats?: boolean; top_admin?: boolean; top_helper?: boolean };
  todayMpCount?: number;
  weekMpCount?: number;
  todayMp?: Array<{ title: string; count: number }>;
}) {
  const withRole = members.filter((m) => m.role_id);
  const candidates = members.filter((m) => m.status === 'candidate');
  const withoutRole = members.length - withRole.length - candidates.length;
  const top = (tier: string) => [...members]
    .filter((m) => m.tier === tier && (m.weekly_events || 0) > 0)
    .sort((a, b) => (b.weekly_events || 0) - (a.weekly_events || 0))
    .slice(0, 3);
  const rating = (rows: Row[], empty: string) => rows.length ? rows.map((m, i) => {
    const norm = m.weekly_target != null ? Number(m.weekly_target) : null;
    const count = Number(m.weekly_events) || 0;
    const badge = norm == null
      ? 'badge-muted'
      : (count >= norm ? 'badge-green' : 'badge-amber');
    const label = norm == null ? `${count} мп / нед.` : `${count}/${norm} мп`;
    return (
    <a className="top-row top-row-link" href={`/app/profile/${m.id}`} key={m.id}>
      <b className="top-rank">{['🥇', '🥈', '🥉'][i]}</b>
      <Avatar row={m} />
      <div style={{ flex: 1 }}>
        <b>{m.nickname}</b>
        <div className="role-tag">{(m.roles || []).map((r: Row) => r.name).join(' · ') || m.role_name}</div>
      </div>
      <span className={`badge ${badge}`}>{label}</span>
    </a>
    );
  }) : <div className="empty-state"><p>{empty}</p></div>;
  const showStats = blocks.stats !== false;
  const showAdmin = blocks.top_admin !== false;
  const showHelper = blocks.top_helper !== false;
  return (
    <>
      {showStats ? (
        <>
          <div className="stat-grid dash-mp-stats">
            <div className="card card-pad stat-card">
              <div className="stat-value">{todayMpCount}</div>
              <div className="stat-label">МП за сегодня</div>
            </div>
            <div className="card card-pad stat-card">
              <div className="stat-value">{weekMpCount}</div>
              <div className="stat-label">МП за неделю</div>
            </div>
          </div>
          <div className="card card-pad dash-today-mp" style={{ marginTop: 14 }}>
            <div className="card-header">
              <h3>Мероприятия сегодня</h3>
              <span className="badge badge-muted">{todayMpCount}</span>
            </div>
            {todayMp.length ? todayMp.map((item) => (
              <div className="dash-mp-row" key={item.title}>
                <div className="dash-mp-title">{item.title}</div>
                <span className="badge badge-purple">{item.count}×</span>
              </div>
            )) : (
              <div className="empty-state"><p>За сегодня проведённых МП пока нет.</p></div>
            )}
          </div>
          <div className="stat-grid stat-grid-4" style={{ marginTop: 20 }}>
            <div className="card card-pad stat-card"><div className="stat-value">{members.length}</div><div className="stat-label">Всего людей в составе</div></div>
            <div className="card card-pad stat-card"><div className="stat-value">{withRole.length}</div><div className="stat-label">Людей с ролями</div></div>
            <div className="card card-pad stat-card"><div className="stat-value">{withoutRole}</div><div className="stat-label">Без роли</div></div>
            <div className="card card-pad stat-card"><div className="stat-value">{candidates.length}</div><div className="stat-label">Кандидатов</div></div>
          </div>
        </>
      ) : null}
      {(showAdmin || showHelper) ? (
        <div className="top-grid" style={{ marginTop: showStats ? 20 : 0 }}>
          {showAdmin ? <div className="card card-pad"><div className="card-header"><h3>Топ-3 администраторов за неделю</h3></div>{rating(top('admin'), 'У администраторов пока нет мероприятий.')}</div> : null}
          {showHelper ? <div className="card card-pad"><div className="card-header"><h3>Топ-3 хелперов за неделю</h3></div>{rating(top('helper'), 'У хелперов пока нет мероприятий.')}</div> : null}
        </div>
      ) : null}
      {!showStats && !showAdmin && !showHelper ? (
        <div className="empty-state"><h3>Нет доступных блоков</h3><p>Для вашей роли на главной ничего не включено.</p></div>
      ) : null}
    </>
  );
}

export function ProfileView({ user, reprimands }: { user: PublicUser; reprimands: Row[] }) {
  return (
    <div className="top-grid">
      <div className="card card-pad">
        <div className="card-header"><h3>Мой профиль</h3></div>
        <p>Имя: <b>{user.nickname || user.firstName || '—'}</b></p>
        <p>Discord: <b>{user.discordUsername || '—'}</b></p>
        <p>Роли: <b>{user.roles.join(' · ') || 'не назначены'}</b></p>
        <p>Мероприятий за неделю: <b>{user.weeklyEvents}</b></p>
      </div>
      <div className="card card-pad">
        <div className="card-header"><h3>Мои выговоры</h3></div>
        {reprimands.length ? reprimands.map((r) => (
          <div className="top-row" key={r.id}>
            <span className={`badge badge-${r.type === 'strict' ? 'red' : 'amber'}`}>{r.type}</span>
            <div>
              <b>{r.reason}</b>
              <div className="role-tag">{fmtDate(r.created_at as string)} · {r.issued_by_nickname || 'Система'}</div>
            </div>
          </div>
        )) : <div className="empty-state"><p>Активных выговоров нет.</p></div>}
      </div>
    </div>
  );
}

export function ContentView({ title, blocks }: { title: string; blocks: Record<string, { body?: string; imageId?: number | null }> }) {
  const block = blocks.general || Object.values(blocks)[0] || {};
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>{title}</h3></div>
      {block.body
        ? <div className="md-body" dangerouslySetInnerHTML={{ __html: block.body }} />
        : <div className="empty-state"><p>Материал пока не добавлен.</p></div>}
      {block.imageId ? <img className="section-image" src={`/media/${block.imageId}`} alt="" /> : null}
    </div>
  );
}

export function RulesView({ rules }: { rules: Row[] }) {
  return (
    <>
      {rules.map((rule) => (
        <details className="rules-card" key={rule.id} style={{ marginBottom: 12 }}>
          <summary className="rules-card-header" style={{ cursor: 'pointer', listStyle: 'none' }}>
            {rule.image_id ? <div className="rules-thumb"><img src={`/media/${rule.image_id}`} alt="" /></div> : null}
            <div className="rules-title">{rule.title}</div>
          </summary>
          <div className="rules-panel" style={{ display: 'block' }}>
            <div className="rules-panel-inner">
              <div className="rules-panel-text md-body" dangerouslySetInnerHTML={{ __html: rule.bodyHtml || rule.body }} />
            </div>
          </div>
        </details>
      ))}
      {!rules.length && <div className="empty-state"><p>Правила пока не добавлены.</p></div>}
    </>
  );
}

export function RosterView({ members }: { members: Row[] }) {
  return (
    <>
      <div className="toolbar"><div className="toolbar-left">Сотрудников: {members.length}</div></div>
      {members.map((m) => (
        <div className="roster-row" key={m.id}>
          <Avatar row={m} />
          <div className="who">
            <div>
              <div className="nickname">{m.nickname}</div>
              <div className="role-tag">{(m.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}</div>
            </div>
          </div>
          <span className="events-count badge badge-purple">{m.weekly_events || 0}</span>
        </div>
      ))}
      {!members.length && <div className="empty-state"><p>Состав пуст.</p></div>}
    </>
  );
}

export function VacationsView({ rows }: { rows: Row[] }) {
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>Календарь отпусков</h3></div>
      {rows.map((v) => (
        <div className="vac-today-row" key={v.id}>
          <div className="vac-today-row-head">
            <b>{v.nickname}</b>
            <span className={`badge badge-${v.status === 'approved' ? 'green' : v.status === 'rejected' ? 'red' : 'amber'}`}>{v.status}</span>
          </div>
          <div className="vac-today-row-dates">{fmtDate(v.start_date as string)} — {fmtDate(v.end_date as string)}</div>
          {v.reason ? <div className="role-tag">{v.reason}</div> : null}
        </div>
      ))}
      {!rows.length && <div className="empty-state"><p>Заявок на отпуск нет.</p></div>}
    </div>
  );
}

export function ApplicationsView({ rows, candidates = false }: { rows: Row[]; candidates?: boolean }) {
  return (
    <>
      {rows.map((item) => (
        <article className="rule-card" key={item.id}>
          <div className="rule-body">
            <h4>
              {item.nickname_static || item.applicant_name}
              <span className="badge badge-muted">{item.status}</span>
            </h4>
            <div className="rule-text">
              {candidates
                ? `Discord: ${item.discord}`
                : <>Возраст: {item.age} · Онлайн: {item.avg_online}<br />{item.motivation}</>}
            </div>
          </div>
        </article>
      ))}
      {!rows.length && (
        <div className="empty-state">
          <p>{candidates ? 'Кандидатов на обзвон нет.' : 'Заявок нет.'}</p>
        </div>
      )}
    </>
  );
}

export function ReprimandsView({ reprimands }: { reprimands: Row[] }) {
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>История выговоров</h3></div>
      {reprimands.map((r) => (
        <div className="top-row" key={r.id}>
          <span className="badge badge-red">{r.type}</span>
          <div>
            <b>{r.user_nickname}</b>
            <div className="role-tag">{r.reason} · {fmtDate(r.created_at as string)}</div>
          </div>
        </div>
      ))}
      {!reprimands.length && <div className="empty-state"><p>Выговоров нет.</p></div>}
    </div>
  );
}

export function OwnerView({ users }: { users: Row[] }) {
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>Пользователи</h3></div>
      {users.map((u) => (
        <div className="roster-row" key={u.id}>
          <Avatar row={u} />
          <div className="who">
            <div>
              <div className="nickname">{u.nickname}</div>
              <div className="role-tag">{(u.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}</div>
            </div>
          </div>
          <span className={`badge ${u.is_admin ? 'badge-green' : 'badge-muted'}`}>
            {u.is_admin ? 'Администратор' : 'Пользователь'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AccessView({ blocked, blockedAt }: { blocked: boolean; blockedAt?: string | null }) {
  return (
    <>
      <header className="site-header"><div className="site-header-inner"><a className="site-brand" href="/"><span className="site-brand-mark">ED</span><span className="site-brand-name">EVENTS DENVER</span></a><nav className="site-nav"><a className="site-nav-link" href="/">Главная</a><a className="btn btn-ghost btn-sm" href="/api/auth/logout">Выйти</a></nav></div></header>
      <main className="site-main">
        <div className="empty-state access-card">
          <div className="blocked-icon"><NavIcon name={blocked ? 'reprimands' : 'profile'} /></div>
          <h3>{blocked ? 'Учётная запись заблокирована' : 'Доступ пока закрыт'}</h3>
          <p>
            {blocked
              ? `Личный кабинет закрыт по системе выговоров${blockedAt ? ` с ${fmtDate(blockedAt)}` : ''}. Аккаунт и история сохранены. Обратитесь к руководству отдела для разблокировки.`
              : 'Личный кабинет откроется после назначения роли в составе.'}
          </p>
          <a className="btn btn-primary" href="/">Вернуться на сайт</a>
        </div>
      </main>
    </>
  );
}
