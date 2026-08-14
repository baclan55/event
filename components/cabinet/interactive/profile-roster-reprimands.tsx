'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@/lib/authShared';
import { auditActionLabel, describeLogEntry } from '@/lib/auditShared';
import { NavIcon } from '@/components/NavIcons';
import { Avatar, DateField, DEFAULT_LIMITS, ErrorText, matchesSearch, Modal, ReprimandBadge, ReprimandLegend, ReprimandSummary, request, RoleName, SearchBox, Select, type Row } from './shared';
import {
  ProfileAchievementsPanel,
  catalogFromPayload,
  emptyAchievementCatalog,
  type ProfileAchievementCatalog,
} from './ProfileAchievements';

export function ProfileInteractive({
  initialUser,
  reprimands,
  target,
  canViewAudit = false,
  initialAudit = [],
  isSelf = true,
  initialAchievementCatalog,
  profileTabs,
}: {
  initialUser: PublicUser;
  reprimands: Row[];
  target: number | null;
  canViewAudit?: boolean;
  initialAudit?: Row[];
  isSelf?: boolean;
  initialAchievementCatalog?: ProfileAchievementCatalog;
  profileTabs?: {
    reprimands?: boolean;
    achievements?: boolean;
    events?: boolean;
    gmp?: boolean;
    audit?: boolean;
  };
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [mode, setMode] = useState<'game' | null>(null);
  const [tab, setTab] = useState<'reprimands' | 'achievements' | 'events' | 'gmp' | 'audit'>('reprimands');
  // tab visibility enforced below
  const [gameForm, setGameForm] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    staticId: user.staticId || '',
  });
  const [pendingGame, setPendingGame] = useState<Row | null>(null);
  const [achievementCatalog, setAchievementCatalog] = useState<ProfileAchievementCatalog>(
    initialAchievementCatalog || emptyAchievementCatalog(),
  );
  const [gmpItems, setGmpItems] = useState<Row[]>([]);
  const [gmpWeekCount, setGmpWeekCount] = useState(0);
  const [eventItems, setEventItems] = useState<Row[]>([]);
  const [eventWeekCount, setEventWeekCount] = useState(0);
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventTotalPages, setEventTotalPages] = useState(1);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const needLast = !(user.isAdministrator && !user.isEventHelper);
  const [audit, setAudit] = useState(initialAudit);
  const [auditActions, setAuditActions] = useState<string[]>([]);
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [rpData, setRpData] = useState({
    reprimands,
    tier: initialUser.rolePriority != null && initialUser.rolePriority <= 5 ? 'admin' : 'helper',
    limits: DEFAULT_LIMITS as Row,
  });
  const hasNorm = target != null && target > 0;
  const done = hasNorm && user.weeklyEvents >= target;
  const tabs = {
    reprimands: profileTabs ? !!profileTabs.reprimands : isSelf,
    achievements: profileTabs ? !!profileTabs.achievements : isSelf,
    events: profileTabs ? !!profileTabs.events : isSelf,
    gmp: profileTabs ? !!profileTabs.gmp : isSelf,
    audit: profileTabs
      ? !!profileTabs.audit
      : isSelf && (canViewAudit || initialUser.isOwner),
  };
  const firstTab = (['reprimands', 'achievements', 'events', 'gmp', 'audit'] as const).find((k) => tabs[k]) || 'reprimands';

  useEffect(() => {
    if (!tabs[tab as keyof typeof tabs]) setTab(firstTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstTab]);

  async function loadAudit(next?: {
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
  }) {
    if (!(canViewAudit || initialUser.isOwner)) return;
    const params = new URLSearchParams();
    const action = next?.action ?? filterAction;
    const actor = next?.actor ?? filterActor;
    const from = next?.from ?? filterFrom;
    const to = next?.to ?? filterTo;
    if (action) params.set('action', action);
    if (actor.trim()) params.set('actor', actor.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('userId', String(initialUser.id));
    const data = await request(`/api/audit${params.toString() ? `?${params}` : ''}`);
    setAudit(data.audit || []);
    if (Array.isArray(data.actions)) setAuditActions(data.actions);
  }

  useEffect(() => {
    if (!isSelf) return;
    request('/api/reprimands/me')
      .then((data) => setRpData({
        reprimands: data.reprimands || reprimands,
        tier: data.tier || 'helper',
        limits: data.limits || DEFAULT_LIMITS,
      }))
      .catch((err) => setError((err as Error).message));
    request('/api/profile/game')
      .then((data) => setPendingGame(data.pending || null))
      .catch(() => undefined);
    request('/api/achievements/me')
      .then((data) => setAchievementCatalog(catalogFromPayload(data)))
      .catch(() => undefined);
    request('/api/gmp/user/' + initialUser.id)
      .then((data) => {
        setGmpItems(data.items || []);
        setGmpWeekCount(Number(data.weekCount) || 0);
      })
      .catch(() => undefined);
    request('/api/discord-events/user/' + initialUser.id + '?page=1&pageSize=10')
      .then((data) => {
        setEventItems(data.items || []);
        setEventWeekCount(Number(data.weekCount) || 0);
        setEventTotal(Number(data.totalCount) || 0);
        setEventTotalPages(Math.max(1, Number(data.totalPages) || 1));
        setEventPage(Number(data.page) || 1);
      })
      .catch(() => undefined);
  }, [reprimands, isSelf]);

  useEffect(() => {
    if (isSelf || !initialUser.id) return;
    if (tabs.achievements) {
      request(`/api/achievements/user/${initialUser.id}`)
        .then((data) => setAchievementCatalog(catalogFromPayload(data)))
        .catch(() => undefined);
    }
    if (tabs.gmp) {
      request(`/api/gmp/user/${initialUser.id}`)
        .then((data) => {
          setGmpItems(data.items || []);
          setGmpWeekCount(Number(data.weekCount) || 0);
        })
        .catch(() => undefined);
    }
    if (tabs.events) {
      request(`/api/discord-events/user/${initialUser.id}?page=1&pageSize=10`)
        .then((data) => {
          setEventItems(data.items || []);
          setEventWeekCount(Number(data.weekCount) || 0);
          setEventTotal(Number(data.totalCount) || 0);
          setEventTotalPages(Math.max(1, Number(data.totalPages) || 1));
          setEventPage(Number(data.page) || 1);
        })
        .catch(() => undefined);
    }
  }, [isSelf, initialUser.id]);

  useEffect(() => {
    if (!(canViewAudit || initialUser.isOwner)) return;
    void loadAudit().catch((err) => setError((err as Error).message));
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAudit, isSelf, initialUser.isOwner, initialUser.id]);


  async function loadEvents(nextPage = eventPage) {
    const data = await request(
      `/api/discord-events/user/${initialUser.id}?page=${nextPage}&pageSize=10`,
    );
    setEventItems(data.items || []);
    setEventWeekCount(Number(data.weekCount) || 0);
    setEventTotal(Number(data.totalCount) || 0);
    setEventTotalPages(Math.max(1, Number(data.totalPages) || 1));
    setEventPage(Number(data.page) || nextPage);
  }

  async function saveGame(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const data = await request('/api/profile/game', {
        method: 'PUT',
        body: JSON.stringify(gameForm),
      });
      if (data.user) setUser(data.user);
      if (data.moderated) {
        setPendingGame({
          first_name: gameForm.firstName,
          last_name: gameForm.lastName,
          static_id: gameForm.staticId,
          status: 'pending',
        });
      } else {
        setPendingGame(null);
      }
      setMode(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const gameLabel = [user.firstName, needLast ? user.lastName : null, user.staticId ? `#${user.staticId}` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className="card card-pad profile-hero">
        <div className="profile-avatar-wrap"><Avatar row={user} size={80} /></div>
        <div className="profile-main">
          <div className="profile-name-line">
            <h2>{user.nickname || user.firstName || 'Без имени'}</h2>
          </div>
          <div className="role-tag">
            {user.roleDetails?.length
              ? user.roleDetails.map((r, i) => (
                  <span key={`${r.name}-${i}`}>
                    {i > 0 ? ' · ' : null}
                    <RoleName name={r.name} color={r.color} />
                  </span>
                ))
              : user.roles.join(' · ') || 'Без роли'}
            {user.discordUsername ? ` · ${user.discordUsername}` : ''}
          </div>
          <div className="role-tag" style={{ marginTop: 6 }}>
            {gameLabel || 'Игровые данные не указаны'}
            {isSelf ? (
              <>
                {' · '}
                <button type="button" className="linkish" onClick={() => setMode('game')}>изменить</button>
              </>
            ) : null}
          </div>
          {pendingGame && isSelf ? (
            <div className="badge badge-amber" style={{ marginTop: 8 }}>
              На модерации: {[pendingGame.first_name, pendingGame.last_name, pendingGame.static_id].filter(Boolean).join(' · ')}
            </div>
          ) : null}
        </div>
        <div className="profile-weekly-group">
          <div className="profile-weekly profile-stat">
            <div className="stat-value">{user.weeklyEvents}</div>
            <div className="stat-label">мп за неделю</div>
                        {hasNorm ? (
              <span className={`badge ${done ? 'badge-green' : 'badge-red'}`}>
                {done ? 'норма' : `цель ${target}`}
              </span>
            ) : null}
          </div>
          <div className="profile-weekly profile-stat">
            <div className="stat-value">{gmpWeekCount}</div>
            <div className="stat-label">гмп за неделю</div>
            <span className="badge badge-muted">всего {gmpItems.length}</span>
          </div>
        </div>
      </div>

      <div className="card card-pad profile-body">
        <div className="segmented roster-tabs profile-tabs">
          {tabs.reprimands ? (
            <button className={tab === 'reprimands' ? 'active' : ''} onClick={() => setTab('reprimands')}>Выговоры · {rpData.reprimands.length}</button>
          ) : null}
          {tabs.achievements ? (
            <button className={tab === 'achievements' ? 'active' : ''} onClick={() => setTab('achievements')}>Достижения · {achievementCatalog.earned.length}</button>
          ) : null}
          {tabs.events ? (
            <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Мероприятия · {eventWeekCount}/{eventTotal}</button>
          ) : null}
          {tabs.gmp ? (
            <button className={tab === 'gmp' ? 'active' : ''} onClick={() => setTab('gmp')}>ГМП · {gmpWeekCount}/{gmpItems.length}</button>
          ) : null}
          {tabs.audit ? (
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Журнал · {audit.length}</button>
          ) : null}
        </div>

        {tab === 'reprimands' ? (
          <>
            <div className="card-header">
              <h3>{isSelf ? 'Мои выговоры' : 'Выговоры'}</h3>
              <ReprimandSummary items={rpData.reprimands} tier={rpData.tier} limits={rpData.limits} />
            </div>
            <ReprimandLegend tier={rpData.tier} limits={rpData.limits} />
            {rpData.reprimands.length ? rpData.reprimands.map((item) => (
              <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}>
                <ReprimandBadge item={item} />
                <div className="who">
                  <div>
                    <div className="nickname">{item.reason}</div>
                    <div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.expires_at ? ` · спишется ${new Date(item.expires_at).toLocaleDateString('ru-RU')}` : ''} · {item.issued_by_nickname || 'Система'}</div>
                  </div>
                </div>
              </div>
            )) : <div className="empty-state"><h3>Выговоров нет</h3><p>Записей о взысканиях нет.</p></div>}
          </>
        ) : tab === 'achievements' ? (
          <ProfileAchievementsPanel catalog={achievementCatalog} />
        ) : tab === 'events' ? (
          <>
            <div className="card-header"><h3>{isSelf ? 'Мои мероприятия' : 'Мероприятия'}</h3><span className="badge badge-muted">{eventTotal}</span></div>
            <div className="field-hint" style={{ marginBottom: 10 }}>Только проведённые · за неделю {eventWeekCount}</div>
            {eventItems.length ? eventItems.map((item) => (
              <div className="roster-row" key={String(item.message_id)}>
                <div className="who">
                  <div>
                    <div className="nickname">{String(item.title || 'Без названия')}</div>
                    <div className="role-tag">{new Date(String(item.message_created_at)).toLocaleString('ru-RU')}{item.event_key ? ` · ${item.event_key}` : ''}</div>
                  </div>
                </div>
                <span className="badge badge-green">Проведено</span>
              </div>
            )) : <div className="empty-state"><h3>Мероприятий нет</h3><p>Проведённых сборов МП пока нет.</p></div>}
            {eventTotal > 0 ? (
              <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
                <div className="toolbar-left">Страница {eventPage} из {eventTotalPages}</div>
                <div className="row-actions" style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={eventPage <= 1}
                    onClick={() => void loadEvents(eventPage - 1).catch((err) => setError((err as Error).message))}
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={eventPage >= eventTotalPages}
                    onClick={() => void loadEvents(eventPage + 1).catch((err) => setError((err as Error).message))}
                  >
                    Вперёд
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : tab === 'gmp' ? (
          <>
            <div className="card-header"><h3>ГМП</h3><span className="badge badge-muted">{gmpItems.length}</span></div>
            {gmpItems.length ? gmpItems.map((item) => (
              <div className="roster-row" key={item.id}>
                <div className="who">
                  <div>
                    <div className="nickname"><Link href={`/app/gmp/${item.id}`}>{item.title}</Link></div>
                    <div className="role-tag">{new Date(String(item.starts_at)).toLocaleString('ru-RU')} · {item.role} · {({ draft: 'Черновик', open: 'Открыто', closed: 'Закрыто' } as Record<string, string>)[String(item.status)] || item.status}</div>
                  </div>
                </div>
              </div>
            )) : <div className="empty-state"><h3>ГМП нет</h3><p>Пользователь ещё не участвовал в staff ГМП.</p></div>}
          </>
        ) : (
          <>
            <div className="card-header"><h3>Журнал действий</h3><span className="badge badge-muted">{audit.length}</span></div>
            <form
              className="form-row-2"
              style={{ marginBottom: 14, gap: 10 }}
              onSubmit={(event) => {
                event.preventDefault();
                void loadAudit().catch((err) => setError((err as Error).message));
              }}
            >
              <div className="field">
                <label>Действие</label>
                <Select
                  value={filterAction}
                  onChange={setFilterAction}
                  placeholder="Все"
                  options={[
                    { value: '', label: 'Все' },
                    ...auditActions.map((action) => ({
                      value: action,
                      label: auditActionLabel(action),
                    })),
                  ]}
                />
              </div>
              <div className="field">
                <label>Кто</label>
                <input className="input" value={filterActor} onChange={(e) => setFilterActor(e.target.value)} placeholder="Никнейм" />
              </div>
              <div className="field">
                <label>С даты</label>
                <DateField value={filterFrom} onChange={setFilterFrom} />
              </div>
              <div className="field">
                <label>По дату</label>
                <DateField value={filterTo} onChange={setFilterTo} />
              </div>
              <div className="modal-actions" style={{ gridColumn: '1 / -1', justifyContent: 'flex-start' }}>
                <button className="btn btn-primary btn-sm" type="submit">Применить</button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => {
                    setFilterAction('');
                    setFilterActor('');
                    setFilterFrom('');
                    setFilterTo('');
                    void loadAudit({ action: '', actor: '', from: '', to: '' }).catch((err) => setError((err as Error).message));
                  }}
                >
                  Сбросить
                </button>
              </div>
            </form>
            <div className="audit-list">
              {audit.map((entry) => {
                const desc = describeLogEntry(entry);
                return (
                  <div className="audit-row" key={entry.id}>
                    <div className="audit-body">
                      <div className="audit-main">
                        <span className="nickname">{desc.title}</span>
                      </div>
                      {desc.lines.length > 0 && (
                        <div className="audit-details">
                          {desc.lines.map((line) => (
                            <div key={line}>{line}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="audit-meta">
                      {entry.actor_nickname || 'Удалённый пользователь'}
                      {' · '}
                      {new Date(entry.created_at).toLocaleString('ru-RU')}
                      {entry.href ? <> · <a href={entry.href}>открыть</a></> : null}
                    </div>
                  </div>
                );
              })}
              {!audit.length && <div className="empty-state"><p>По выбранным фильтрам записей нет.</p></div>}
            </div>
          </>
        )}
      </div>

      {mode === 'game' && (
        <Modal title="Игровые данные" onClose={() => setMode(null)}>
          <form onSubmit={saveGame}>
            <ErrorText value={error} />
            <p className="field-hint">После первого заполнения изменения уходят на модерацию.</p>
            <div className="field">
              <label>Имя</label>
              <input className="input" required maxLength={60} value={gameForm.firstName} onChange={(e) => setGameForm({ ...gameForm, firstName: e.target.value })} />
            </div>
            {needLast ? (
              <div className="field">
                <label>Фамилия</label>
                <input className="input" required maxLength={60} value={gameForm.lastName} onChange={(e) => setGameForm({ ...gameForm, lastName: e.target.value })} />
              </div>
            ) : null}
            <div className="field">
              <label>StaticID</label>
              <input
                className="input"
                required
                inputMode="numeric"
                maxLength={6}
                value={gameForm.staticId}
                onChange={(e) => setGameForm({ ...gameForm, staticId: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Отмена</button>
              <button className="btn btn-primary" disabled={saving}>Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function RosterInteractive({
  initialMembers,
  roles,
  target,
  canEdit,
  canViewProfiles,
  canGrantOwner = false,
  actorRolePriority = null,
  actorIsOwner = false,
  actorId = null,
}: {
  initialMembers: Row[];
  roles: Row[];
  target?: number | null;
  canEdit: boolean;
  canViewProfiles: boolean;
  canGrantOwner?: boolean;
  actorRolePriority?: number | null;
  actorIsOwner?: boolean;
  actorId?: number | null;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [tab, setTab] = useState<'with' | 'without' | 'candidates'>('with');
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  function canAssignRole(role: Row) {
    if (actorIsOwner || actorRolePriority == null) return true;
    // Уже назначенные роли оставляем доступными (чтобы не сбрасывались из формы).
    if ((editing?.roles || []).some((item: Row) => item.id === role.id)) return true;
    return Number(role.priority) > actorRolePriority;
  }

  function canManageMember(member: Row) {
    if (actorIsOwner) return true;
    if (actorId != null && member.id === actorId) return true;
    if (member.is_owner) return false;
    if (actorRolePriority == null) return false;
    if (member.role_priority == null) return true;
    return Number(member.role_priority) > actorRolePriority;
  }

  async function reload() {
    const data = await request('/api/roster');
    setMembers(data.members || []);
  }

  useEffect(() => {
    if (!canViewProfiles || typeof window === 'undefined') return;
    const userId = Number(new URLSearchParams(window.location.search).get('user'));
    if (Number.isFinite(userId) && userId > 0) {
      window.location.replace(`/app/profile/${userId}`);
    }
  }, [canViewProfiles]);

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roleIds = form.getAll('roleIds').map(Number);
    const payload: Row = {
      nickname: String(form.get('nickname') || ''),
      weeklyEvents: Number(form.get('weeklyEvents') || 0),
      note: String(form.get('note') || ''),
      discordId: String(form.get('discordId') || '').replace(/\D/g, ''),
      roleIds,
    };
    if (canGrantOwner && editing?.id) {
      payload.isOwner = form.get('isOwner') === 'on';
    }
    try {
      let id = editing?.id;
      if (id) {
        await request(`/api/roster/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const result = await request('/api/roster', { method: 'POST', body: JSON.stringify(payload) });
        id = result.id;
      }
      setEditing(undefined);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeMember(id: number) {
    if (!confirm('Удалить участника из состава?')) return;
    try {
      await request(`/api/roster/${id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const matchMember = (m: Row) => matchesSearch([
    m.nickname, m.first_name, m.last_name, m.static_id, m.discord_id, m.discord_username,
    m.role_name, m.note, m.weekly_events,
    ...(Array.isArray(m.roles) ? m.roles.map((r: Row) => r.name) : []),
  ], query);
  const candidates = members.filter((m) => m.status === 'candidate' && matchMember(m));
  const without = members.filter((m) => !m.role_id && m.status !== 'candidate' && matchMember(m));
  const withRoles = members.filter((m) => m.role_id && matchMember(m));
  const shown = tab === 'with' ? withRoles : tab === 'without' ? without : candidates;
  const roleGroups = [...new Map(withRoles.map((member) => [
    member.role_id,
    {
      id: member.role_id,
      label: member.role_name || 'Без роли',
      priority: member.role_priority ?? 999,
      members: withRoles.filter((item) => item.role_id === member.role_id),
    },
  ])).values()].sort((a, b) => a.priority - b.priority);

  function formatRolesColored(roles: Row[] | undefined) {
  const list = roles || [];
  if (!list.length) return 'Без роли';
  return list.map((r, i) => (
    <span key={String(r.id || r.name || i)}>
      {i > 0 ? ' · ' : null}
      <RoleName name={r.name} color={r.color} />
    </span>
  ));
}

const memberRow = (member: Row, candidate = false) => (
    <div className="roster-row" key={member.id}>
      {canViewProfiles && !candidate ? (
        <a className="who member-profile-trigger who-clickable" href={`/app/profile/${member.id}`}>
          <Avatar row={member} />
          <span className="member-copy">
            <span className="nickname">{member.nickname}</span>
            <span className="role-tag">{formatRolesColored(member.roles)}{member.discord_username ? ` · ${member.discord_username}` : ''}</span>
          </span>
        </a>
      ) : (
        <div className="who">
          <Avatar row={member} />
          <span className="member-copy">
            <span className="nickname">{member.nickname}</span>
            <span className="role-tag">{candidate ? 'Кандидат' : formatRolesColored(member.roles)}{member.discord_username ? ` · ${member.discord_username}` : ''}</span>
          </span>
        </div>
      )}
      {candidate ? <span className="badge badge-amber">Ожидает обзвона</span> : <>
        {member.is_blocked && <span className="badge badge-red">Заблокирован</span>}
        {(() => {
          const norm = member.weekly_target != null ? Number(member.weekly_target) : (target ?? null);
          const count = Number(member.weekly_events) || 0;
          if (norm == null) return <span className="badge badge-muted">{count} / нед.</span>;
          return <span className={`badge ${count >= norm ? 'badge-green' : 'badge-red'}`}>{count}/{norm}</span>;
        })()}
        {canEdit && canManageMember(member) && (
          <div className="row-actions">
            <button className="icon-btn" title="Редактировать" onClick={() => setEditing(member)}><NavIcon name="edit" /></button>
            <button className="icon-btn danger" title="Удалить" onClick={() => void removeMember(member.id)}><NavIcon name="trash" /></button>
          </div>
        )}
      </>}
    </div>
  );

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{members.length} участников · норма по ролям</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Ник, роль, Discord, Static…" />
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><NavIcon name="plus" /> Добавить участника</button>}
      </div>
      <div className="segmented roster-tabs">
        <button className={tab === 'with' ? 'active' : ''} onClick={() => setTab('with')}>С ролями · {withRoles.length}</button>
        <button className={tab === 'without' ? 'active' : ''} onClick={() => setTab('without')}>Без ролей · {without.length}</button>
        <button className={tab === 'candidates' ? 'active' : ''} onClick={() => setTab('candidates')}>Кандидаты · {candidates.length}</button>
      </div>
      <ErrorText value={error} />
      {tab === 'with'
        ? roleGroups.map((group) => <section key={group.id}><div className="role-group-label">{group.label} · {group.members.length}</div>{group.members.map((member) => memberRow(member))}</section>)
        : shown.map((member) => memberRow(member, tab === 'candidates'))}
      {!shown.length && <div className="empty-state"><h3>{query.trim() ? 'Никого не найдено' : 'Здесь никого нет'}</h3></div>}

      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование участника' : 'Новый участник'} onClose={() => setEditing(undefined)} wide>
          <form onSubmit={saveMember}>
            <ErrorText value={error} />
            <div className="field"><label>Имя</label><input className="input" name="nickname" required defaultValue={editing?.nickname || ''} /></div>
            <div className="field"><label>Discord ID</label><input className="input" name="discordId" inputMode="numeric" placeholder="для привязки МП до входа на сайт" defaultValue={editing?.discord_id || ''} /><div className="field-hint">Если указать Discord ID заранее, старые сборы МП подтянутся к профилю после привязки или входа.</div></div>
            <div className="form-row-2">
              <div className="field">
                <label>Роли</label>
                <div className="role-checklist">
                  {roles.map((role) => {
                    const allowed = canAssignRole(role);
                    const checked = (editing?.roles || []).some((r: Row) => r.id === role.id);
                    return (
                      <label className={`role-check-item${!allowed ? ' is-disabled' : ''}`} key={role.id} title={!allowed ? 'Роль равна или выше вашей' : undefined}>
                        <input
                          type="checkbox"
                          name="roleIds"
                          value={role.id}
                          defaultChecked={checked}
                          disabled={!allowed}
                        />
                        {role.name}
                        {!allowed ? ' · недоступна' : ''}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="field"><label>МП за неделю</label><input className="input" name="weeklyEvents" type="number" min="0" defaultValue={editing?.weekly_events || 0} /></div>
            </div>
            <div className="field"><label>Заметка</label><textarea className="input" name="note" defaultValue={editing?.note || ''} /></div>
            {canGrantOwner && editing?.id ? (
              <label className="qform-check-label">
                <input type="checkbox" name="isOwner" defaultChecked={!!editing.is_owner} />
                Владелец портала
              </label>
            ) : null}
            <div className="field-hint">
              Можно назначать только роли ниже вашей в иерархии.
              Аватар синхронизируется при входе через Discord.
            </div>
            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(undefined)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

function MemberProfileBody({ data, onChanged }: { data: { user: Row; reprimands: Row[]; limits: Row }; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const user = data.user;
  const tier = user.tier || 'helper';

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request('/api/reprimands', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, reason: form.get('reason'), type: form.get('type') }),
      });
      setAdding(false); await onChanged();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    if (!confirm('Удалить запись?')) return;
    try { await request(`/api/reprimands/${id}`, { method: 'DELETE' }); await onChanged(); }
    catch (err) { setError((err as Error).message); }
  }

  async function unblock() {
    try { await request(`/api/reprimands/users/${user.id}/unblock`, { method: 'POST', body: '{}' }); await onChanged(); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="profile-hero compact">
        <Avatar row={user} size={64} />
        <div className="profile-main"><h2>{user.nickname}</h2><div className="role-tag">{(user.roles || []).length ? (user.roles as Row[]).map((r: Row, i: number) => (
          <span key={String(r.id || r.name || i)}>{i > 0 ? ' · ' : null}<RoleName name={r.name} color={r.color} /></span>
        )) : 'Без роли'}</div></div>
        <div className="profile-weekly"><div className="stat-value">{user.weekly_events || 0}</div><div className="stat-label">мп за неделю</div></div>
      </div>
      <ErrorText value={error} />
      <div className="modal-actions profile-actions">
        {user.is_blocked && <button className="btn btn-ghost btn-sm" onClick={() => void unblock()}>Разблокировать</button>}
        <button className="btn btn-primary btn-sm" disabled={user.is_blocked} onClick={() => setAdding(!adding)}><NavIcon name="plus" /> Добавить выговор</button>
      </div>
      {adding && <form className="card card-pad inline-form" onSubmit={add}>{tier === 'helper' && <div className="field"><label>Тип</label><Select
            name="type"
            defaultValue="verbal"
            options={[
              { value: 'verbal', label: `Устный (+${data.limits.helper.verbalPoints} балл)` },
              { value: 'strict', label: `Строгий (+${data.limits.helper.strictPoints} балла)` },
            ]}
          /></div>}<div className="field"><label>Причина</label><textarea className="input" name="reason" required /></div><button className="btn btn-primary">Выдать</button></form>}
      <div className="card-header" style={{ marginTop: 18 }}><h3>История выговоров</h3><ReprimandSummary items={data.reprimands} tier={tier} limits={data.limits} /></div>
      <ReprimandLegend tier={tier} limits={data.limits} />
      {data.reprimands.map((item) => <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}><ReprimandBadge item={item} /><div className="who"><div><div className="nickname">{item.reason}</div><div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.issued_by_nickname ? ` · выдал ${item.issued_by_nickname}` : ''}</div></div></div><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></div>)}
      {!data.reprimands.length && <div className="empty-state">Выговоров нет.</div>}
    </>
  );
}

export function ReprimandsInteractive() {
  const [data, setData] = useState<{ reprimands: Row[]; members: Row[]; limits: Row }>({ reprimands: [], members: [], limits: {} });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'helper' | 'admin'>('helper');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function load() {
    try { setData(await request('/api/reprimands')); }
    catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request('/api/reprimands', { method: 'POST', body: JSON.stringify({ userId: Number(form.get('userId')), reason: form.get('reason'), type: form.get('type') }) });
      setAdding(false); await load();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    if (!confirm('Удалить выговор?')) return;
    try { await request(`/api/reprimands/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  async function unblock(userId: number) {
    try {
      await request(`/api/reprimands/users/${userId}/unblock`, { method: 'POST', body: '{}' });
      await load();
    } catch (err) { setError((err as Error).message); }
  }

  const limits = data.limits.helper ? data.limits : DEFAULT_LIMITS;
  const tabItems = data.reprimands.filter((item) => item.tier === tab);
  const tabMembers = data.members.filter((member) => member.tier === tab && !member.is_blocked);
  const groups = [...new Map(tabItems.map((item) => [
    item.user_id,
    {
      id: item.user_id,
      nickname: item.user_nickname,
      role: item.role_name,
      avatar_url: item.avatar_url,
      avatar_image_id: item.avatar_image_id,
      isBlocked: item.is_blocked,
      entries: tabItems.filter((row) => row.user_id === item.user_id),
    },
  ])).values()].sort((a, b) => String(a.nickname).localeCompare(String(b.nickname), 'ru'));

  const filteredGroups = groups.filter((group) => matchesSearch([
    group.nickname,
    group.role,
    ...group.entries.flatMap((item) => [item.reason, item.issued_by_nickname]),
  ], query));

  return (
    <>
      <div className="toolbar"><div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><span>{data.reprimands.length} записей всего</span><SearchBox value={query} onChange={setQuery} placeholder="Ник, причина…" /></div><button className="btn btn-primary btn-sm" disabled={!tabMembers.length} onClick={() => setAdding(true)}><NavIcon name="plus" /> Добавить выговор</button></div>
      <div className="segmented roster-tabs">
        <button className={tab === 'helper' ? 'active' : ''} onClick={() => setTab('helper')}>Хелперы · {data.reprimands.filter((item) => item.tier === 'helper').length}</button>
        <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Администраторы · {data.reprimands.filter((item) => item.tier === 'admin').length}</button>
      </div>
      <ErrorText value={error} />
      <ReprimandLegend tier={tab} limits={limits} />
      {filteredGroups.map((group) => <section className="rp-group" key={group.id}>
        <div className="rp-group-head">
          <div className="who"><Avatar row={{ ...group, nickname: group.nickname }} /><div><div className="nickname">{group.nickname} {group.isBlocked && <span className="badge badge-red">Заблокирован</span>}</div><div className="role-tag">{group.role || 'Без роли'}</div></div></div>
          <div className="rp-group-badges"><ReprimandSummary items={group.entries} tier={tab} limits={limits} />{group.isBlocked && <button className="btn btn-ghost btn-sm" onClick={() => void unblock(group.id)}>Разблокировать</button>}</div>
        </div>
        <div className="rp-group-entries">{group.entries.map((item) => <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}><ReprimandBadge item={item} /><div className="who"><div><div className="nickname">{item.reason}</div><div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.issued_by_nickname ? ` · выдал ${item.issued_by_nickname}` : ''}</div></div></div><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></div>)}</div>
      </section>)}
      {!filteredGroups.length && <div className="empty-state"><h3>Выговоров нет</h3><p>В выбранной группе записей пока нет.</p></div>}
      {adding && <Modal title="Новый выговор" onClose={() => setAdding(false)}><form onSubmit={add}><ErrorText value={error} /><div className="field"><label>Сотрудник</label><Select
            name="userId"
            required
            placeholder="Выберите"
            options={tabMembers.map((m) => ({
              value: String(m.id),
              label: `${m.nickname} · ${m.role_name || 'Без роли'}`,
            }))}
          /></div>{tab === 'helper' && <div className="field"><label>Тип</label><Select
            name="type"
            defaultValue="verbal"
            options={[
              { value: 'verbal', label: `Устный (+${limits.helper.verbalPoints} балл)` },
              { value: 'strict', label: `Строгий (+${limits.helper.strictPoints} балла)` },
            ]}
          /></div>}<div className="field"><label>Причина</label><textarea className="input" name="reason" required /></div><div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Отмена</button><button className="btn btn-primary">Добавить</button></div></form></Modal>}
    </>
  );
}
