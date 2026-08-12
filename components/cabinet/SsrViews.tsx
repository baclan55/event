import type { PublicUser } from '@/lib/auth';
import { fmtDate } from '@/lib/cabinetData';

type Row = Record<string, any>;

function Avatar({ row }: { row: Row }) {
  const src = row.avatar_url || row.avatarUrl;
  const letter = String(row.nickname || row.user_nickname || '?').slice(0, 1);
  return <div className="avatar">{src ? <img src={src} alt="" /> : letter}</div>;
}

export function DashboardView({ members, target }: { members: Row[]; target: number }) {
  const top = [...members].sort((a, b) => (b.weekly_events || 0) - (a.weekly_events || 0)).slice(0, 7);
  const done = members.filter((m) => (m.weekly_events || 0) >= target).length;
  return (
    <>
      <div className="stat-grid">
        <div className="card card-pad stat-card"><div className="stat-value">{members.length}</div><div className="stat-label">Сотрудников</div></div>
        <div className="card card-pad stat-card"><div className="stat-value">{done}</div><div className="stat-label">Выполнили недельный план</div></div>
        <div className="card card-pad stat-card"><div className="stat-value">{target}</div><div className="stat-label">Цель на неделю</div></div>
      </div>
      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div className="card-header"><h3>Активность за неделю</h3></div>
        {top.map((m, i) => (
          <div className="top-row" key={m.id}>
            <b className="top-rank">{i + 1}</b>
            <Avatar row={m} />
            <div style={{ flex: 1 }}>
              <b>{m.nickname}</b>
              <div className="role-tag">{(m.roles || []).map((r: Row) => r.name).join(' · ') || m.role_name}</div>
            </div>
            <span className="badge badge-purple">{m.weekly_events || 0} событий</span>
          </div>
        ))}
        {!top.length && <div className="empty-state"><p>Пока нет данных.</p></div>}
      </div>
    </>
  );
}

export function ProfileView({ user, reprimands }: { user: PublicUser; reprimands: Row[] }) {
  return (
    <div className="top-grid">
      <div className="card card-pad">
        <div className="card-header"><h3>Мой профиль</h3></div>
        <p>Никнейм: <b>{user.nickname || '—'}</b></p>
        <p>Discord: <b>{user.discordUsername || '—'}</b></p>
        <p>Роли: <b>{user.roles.join(' · ') || 'не назначены'}</b></p>
        <p>Мероприятий за неделю: <b>{user.weeklyEvents}</b></p>
        <hr style={{ border: 0, borderTop: '1px solid var(--border-soft)', margin: '16px 0' }} />
        <form action="/api/auth/me/nickname" method="post">
          <div className="field">
            <label>Изменить никнейм</label>
            <input className="input" name="nickname" defaultValue={user.nickname || ''} required maxLength={60} />
          </div>
          <button className="btn btn-primary" type="submit">Сохранить</button>
        </form>
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

export function AccessView({ blocked }: { blocked: boolean }) {
  return (
    <div className="empty-state" style={{ maxWidth: 520, margin: '80px auto' }}>
      <h3>{blocked ? 'Учётная запись заблокирована' : 'Доступ пока закрыт'}</h3>
      <p>
        {blocked
          ? 'Обратитесь к руководству отдела для разблокировки.'
          : 'Личный кабинет откроется после назначения роли в составе.'}
      </p>
    </div>
  );
}
