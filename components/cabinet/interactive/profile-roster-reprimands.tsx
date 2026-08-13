'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@/lib/auth';
import { AUDIT_LABELS } from '@/lib/auditShared';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, Avatar, DEFAULT_LIMITS, ErrorText, Modal, ReprimandBadge, ReprimandLegend, ReprimandSummary, request, Select, type Row } from './shared';

function formatAuditDetails(entry: Row): string {
  const details = (entry.details || {}) as Row;
  const bits: string[] = [];
  if (entry.target_nickname) bits.push(`ÐºÐ¾Ð¼Ñ: ${entry.target_nickname}`);
  if (details.reason) bits.push(`Ð¿ÑÐ¸ÑÐ¸Ð½Ð°: ${details.reason}`);
  if (details.type) bits.push(`ÑÐ¸Ð¿: ${details.type}`);
  if (typeof details.isOpen === 'boolean') bits.push(details.isOpen ? 'Ð¾ÑÐºÑÑÑ' : 'Ð·Ð°ÐºÑÑÑ');
  if (details.nickname && !entry.target_nickname) bits.push(`Ð½Ð¸Ðº: ${details.nickname}`);
  if (entry.entity_type) bits.push(`${entry.entity_type}${entry.entity_id ? ` #${entry.entity_id}` : ''}`);
  return bits.join(' Â· ');
}

export function ProfileInteractive({
  initialUser,
  reprimands,
  target,
  canViewAudit = false,
  initialAudit = [],
  isSelf = true,
  initialAchievements = [],
}: {
  initialUser: PublicUser;
  reprimands: Row[];
  target: number;
  canViewAudit?: boolean;
  initialAudit?: Row[];
  isSelf?: boolean;
  initialAchievements?: Row[];
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [mode, setMode] = useState<'game' | null>(null);
  const [tab, setTab] = useState<'reprimands' | 'achievements' | 'audit'>('reprimands');
  const [gameForm, setGameForm] = useState({
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    staticId: user.staticId || '',
  });
  const [pendingGame, setPendingGame] = useState<Row | null>(null);
  const [achievements, setAchievements] = useState(initialAchievements);
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
  const done = user.weeklyEvents >= target;

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
      .then((data) => setAchievements(data.achievements || []))
      .catch(() => undefined);
  }, [reprimands, isSelf]);

  useEffect(() => {
    if (isSelf || !initialUser.id) return;
    request(`/api/achievements/user/${initialUser.id}`)
      .then((data) => setAchievements(data.achievements || []))
      .catch(() => undefined);
  }, [isSelf, initialUser.id]);

  useEffect(() => {
    if (!(canViewAudit || initialUser.isOwner)) return;
    void loadAudit().catch((err) => setError((err as Error).message));
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAudit, isSelf, initialUser.isOwner, initialUser.id]);


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
        <div className="profile-avatar-wrap"><Avatar row={user} size={68} /></div>
        <div className="profile-main">
          <div className="profile-name-line">
            <h2>{user.nickname || user.firstName || 'Без имени'}</h2>
          </div>
          <div className="role-tag">
            {user.roles.join(' Â· ') || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸'}
            {user.discordUsername ? ` Â· ${user.discordUsername}` : ''}
          </div>
          <div className="role-tag" style={{ marginTop: 6 }}>
            {gameLabel || 'ÐÐ³ÑÐ¾Ð²ÑÐµ Ð´Ð°Ð½Ð½ÑÐµ Ð½Ðµ ÑÐºÐ°Ð·Ð°Ð½Ñ'}
            {isSelf ? (
              <>
                {' Â· '}
                <button type="button" className="linkish" onClick={() => setMode('game')}>Ð¸Ð·Ð¼ÐµÐ½Ð¸ÑÑ</button>
              </>
            ) : null}
          </div>
          {pendingGame && isSelf ? (
            <div className="badge badge-amber" style={{ marginTop: 8 }}>
              ÐÐ° Ð¼Ð¾Ð´ÐµÑÐ°ÑÐ¸Ð¸: {[pendingGame.first_name, pendingGame.last_name, pendingGame.static_id].filter(Boolean).join(' Â· ')}
            </div>
          ) : null}
        </div>
        <div className="profile-weekly">
          <div className="stat-value">{user.weeklyEvents}</div>
          <div className="stat-label">Ð¼Ð¿ Ð·Ð° Ð½ÐµÐ´ÐµÐ»Ñ</div>
          <span className={`badge ${done ? 'badge-green' : 'badge-red'}`}>
            {done ? 'Ð½Ð¾ÑÐ¼Ð° Ð²ÑÐ¿Ð¾Ð»Ð½ÐµÐ½Ð°' : `ÑÐµÐ»Ñ ${target}`}
          </span>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div className="segmented roster-tabs" style={{ marginBottom: 16 }}>
          <button className={tab === 'reprimands' ? 'active' : ''} onClick={() => setTab('reprimands')}>ÐÑÐ³Ð¾Ð²Ð¾ÑÑ Â· {rpData.reprimands.length}</button>
          <button className={tab === 'achievements' ? 'active' : ''} onClick={() => setTab('achievements')}>ÐÐ¾ÑÑÐ¸Ð¶ÐµÐ½Ð¸Ñ Â· {achievements.length}</button>
          {(canViewAudit || initialUser.isOwner) ? (
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>ÐÑÑÐ½Ð°Ð» Â· {audit.length}</button>
          ) : null}
        </div>

        {tab === 'reprimands' ? (
          <>
            <div className="card-header">
              <h3>{isSelf ? 'ÐÐ¾Ð¸ Ð²ÑÐ³Ð¾Ð²Ð¾ÑÑ' : 'ÐÑÐ³Ð¾Ð²Ð¾ÑÑ'}</h3>
              <ReprimandSummary items={rpData.reprimands} tier={rpData.tier} limits={rpData.limits} />
            </div>
            <ReprimandLegend tier={rpData.tier} limits={rpData.limits} />
            {rpData.reprimands.length ? rpData.reprimands.map((item) => (
              <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}>
                <ReprimandBadge item={item} />
                <div className="who">
                  <div>
                    <div className="nickname">{item.reason}</div>
                    <div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.expires_at ? ` Â· ÑÐ¿Ð¸ÑÐµÑÑÑ ${new Date(item.expires_at).toLocaleDateString('ru-RU')}` : ''} Â· {item.issued_by_nickname || 'Ð¡Ð¸ÑÑÐµÐ¼Ð°'}</div>
                  </div>
                </div>
              </div>
            )) : <div className="empty-state"><h3>ÐÑÐ³Ð¾Ð²Ð¾ÑÐ¾Ð² Ð½ÐµÑ</h3><p>ÐÐ°Ð¿Ð¸ÑÐµÐ¹ Ð¾ Ð²Ð·ÑÑÐºÐ°Ð½Ð¸ÑÑ Ð½ÐµÑ.</p></div>}
          </>
        ) : tab === 'achievements' ? (
          <>
            <div className="card-header"><h3>ÐÐ¾ÑÑÐ¸Ð¶ÐµÐ½Ð¸Ñ</h3><span className="badge badge-muted">{achievements.length}</span></div>
            {achievements.length ? achievements.map((item) => (
              <div className="roster-row" key={`${item.achievement_id}-${item.grade}`}>
                <div className="ach-icon-wrap">
                  {item.icon
                    ? <img src={item.icon} alt="" className="ach-icon" />
                    : <span className="ach-icon ach-icon-empty">★</span>}
                </div>
                <div className="who">
                  <div>
                    <div className="nickname">{item.name}{item.max_grade > 1 ? ` Â· ${item.grade}/${item.max_grade} ÑÑ.` : ''}</div>
                    <div className="role-tag">{item.description || 'â'} Â· {new Date(item.awarded_at).toLocaleDateString('ru-RU')}</div>
                  </div>
                </div>
              </div>
            )) : <div className="empty-state"><h3>ÐÐ¾ÐºÐ° Ð¿ÑÑÑÐ¾</h3><p>ÐÐ¾ÑÑÐ¸Ð¶ÐµÐ½Ð¸Ñ Ð¿Ð¾ÑÐ²ÑÑÑÑ Ð¿Ð¾ ÑÑÐ¸Ð³Ð³ÐµÑÐ°Ð¼.</p></div>}
          </>
        ) : (
          <>
            <div className="card-header"><h3>ÐÑÑÐ½Ð°Ð» Ð´ÐµÐ¹ÑÑÐ²Ð¸Ð¹</h3><span className="badge badge-muted">{audit.length}</span></div>
            <form
              className="form-row-2"
              style={{ marginBottom: 14, gap: 10 }}
              onSubmit={(event) => {
                event.preventDefault();
                void loadAudit().catch((err) => setError((err as Error).message));
              }}
            >
              <div className="field">
                <label>ÐÐµÐ¹ÑÑÐ²Ð¸Ðµ</label>
                <Select
                  value={filterAction}
                  onChange={setFilterAction}
                  placeholder="ÐÑÐµ"
                  options={[{ value: '', label: 'ÐÑÐµ' }, ...auditActions.map((action) => ({ value: action, label: AUDIT_LABELS[action] || action }))]}
                />
              </div>
              <div className="field">
                <label>ÐÑÐ¾</label>
                <input className="input" value={filterActor} onChange={(e) => setFilterActor(e.target.value)} placeholder="ÐÐ¸ÐºÐ½ÐµÐ¹Ð¼" />
              </div>
              <div className="field">
                <label>Ð¡ Ð´Ð°ÑÑ</label>
                <input className="input" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>ÐÐ¾ Ð´Ð°ÑÑ</label>
                <input className="input" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
              </div>
              <div className="modal-actions" style={{ gridColumn: '1 / -1', justifyContent: 'flex-start' }}>
                <button className="btn btn-primary btn-sm" type="submit">ÐÑÐ¸Ð¼ÐµÐ½Ð¸ÑÑ</button>
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
                  Ð¡Ð±ÑÐ¾ÑÐ¸ÑÑ
                </button>
              </div>
            </form>
            <div className="audit-list">
              {audit.map((entry) => (
                <div className="audit-row" key={entry.id}>
                  <div className="audit-main">
                    <span className="nickname">{AUDIT_LABELS[entry.action] || entry.action}</span>
                    <span className="role-tag">{formatAuditDetails(entry)}</span>
                  </div>
                  <div className="audit-meta">
                    ÐºÑÐ¾: {entry.actor_nickname || 'Ð£Ð´Ð°Ð»ÑÐ½Ð½ÑÐ¹ Ð¿Ð¾Ð»ÑÐ·Ð¾Ð²Ð°ÑÐµÐ»Ñ'}
                    {' Â· '}
                    ÐºÐ¾Ð³Ð´Ð°: {new Date(entry.created_at).toLocaleString('ru-RU')}
                    {entry.href ? <> Â· <a href={entry.href}>Ð¾ÑÐºÑÑÑÑ</a></> : null}
                  </div>
                </div>
              ))}
              {!audit.length && <div className="empty-state"><p>ÐÐ¾ Ð²ÑÐ±ÑÐ°Ð½Ð½ÑÐ¼ ÑÐ¸Ð»ÑÑÑÐ°Ð¼ Ð·Ð°Ð¿Ð¸ÑÐµÐ¹ Ð½ÐµÑ.</p></div>}
            </div>
          </>
        )}
      </div>

      {mode === 'game' && (
        <Modal title="ÐÐ³ÑÐ¾Ð²ÑÐµ Ð´Ð°Ð½Ð½ÑÐµ" onClose={() => setMode(null)}>
          <form onSubmit={saveGame}>
            <ErrorText value={error} />
            <p className="field-hint">ÐÐ¾ÑÐ»Ðµ Ð¿ÐµÑÐ²Ð¾Ð³Ð¾ Ð·Ð°Ð¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ñ Ð¸Ð·Ð¼ÐµÐ½ÐµÐ½Ð¸Ñ ÑÑÐ¾Ð´ÑÑ Ð½Ð° Ð¼Ð¾Ð´ÐµÑÐ°ÑÐ¸Ñ.</p>
            <div className="field">
              <label>ÐÐ¼Ñ</label>
              <input className="input" required maxLength={60} value={gameForm.firstName} onChange={(e) => setGameForm({ ...gameForm, firstName: e.target.value })} />
            </div>
            {needLast ? (
              <div className="field">
                <label>Ð¤Ð°Ð¼Ð¸Ð»Ð¸Ñ</label>
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
              <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>ÐÑÐ¼ÐµÐ½Ð°</button>
              <button className="btn btn-primary" disabled={saving}>Ð¡Ð¾ÑÑÐ°Ð½Ð¸ÑÑ</button>
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
  target: number;
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

  function canAssignRole(role: Row) {
    if (actorIsOwner || actorRolePriority == null) return true;
    // Ð£Ð¶Ðµ Ð½Ð°Ð·Ð½Ð°ÑÐµÐ½Ð½ÑÐµ ÑÐ¾Ð»Ð¸ Ð¾ÑÑÐ°Ð²Ð»ÑÐµÐ¼ Ð´Ð¾ÑÑÑÐ¿Ð½ÑÐ¼Ð¸ (ÑÑÐ¾Ð±Ñ Ð½Ðµ ÑÐ±ÑÐ°ÑÑÐ²Ð°Ð»Ð¸ÑÑ Ð¸Ð· ÑÐ¾ÑÐ¼Ñ).
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
    if (!(await askConfirm('Ð£Ð´Ð°Ð»Ð¸ÑÑ ÑÑÐ°ÑÑÐ½Ð¸ÐºÐ° Ð¸Ð· ÑÐ¾ÑÑÐ°Ð²Ð°?', { title: 'Ð£Ð´Ð°Ð»ÐµÐ½Ð¸Ðµ', confirmLabel: 'Ð£Ð´Ð°Ð»Ð¸ÑÑ' }))) return;
    try {
      await request(`/api/roster/${id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const candidates = members.filter((m) => m.status === 'candidate');
  const without = members.filter((m) => !m.role_id && m.status !== 'candidate');
  const withRoles = members.filter((m) => m.role_id);
  const shown = tab === 'with' ? withRoles : tab === 'without' ? without : candidates;
  const roleGroups = [...new Map(withRoles.map((member) => [
    member.role_id,
    {
      id: member.role_id,
      label: member.role_name || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸',
      priority: member.role_priority ?? 999,
      members: withRoles.filter((item) => item.role_id === member.role_id),
    },
  ])).values()].sort((a, b) => a.priority - b.priority);

  const memberRow = (member: Row, candidate = false) => (
    <div className="roster-row" key={member.id}>
      {canViewProfiles && !candidate ? (
        <a className="who member-profile-trigger who-clickable" href={`/app/profile/${member.id}`}>
          <Avatar row={member} />
          <span className="member-copy">
            <span className="nickname">{member.nickname}</span>
            <span className="role-tag">{(member.roles || []).map((r: Row) => r.name).join(' Â· ') || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸'}{member.discord_username ? ` Â· ${member.discord_username}` : ''}</span>
          </span>
        </a>
      ) : (
        <div className="who">
          <Avatar row={member} />
          <span className="member-copy">
            <span className="nickname">{member.nickname}</span>
            <span className="role-tag">{candidate ? 'ÐÐ°Ð½Ð´Ð¸Ð´Ð°Ñ' : (member.roles || []).map((r: Row) => r.name).join(' Â· ') || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸'}{member.discord_username ? ` Â· ${member.discord_username}` : ''}</span>
          </span>
        </div>
      )}
      {candidate ? <span className="badge badge-amber">ÐÐ¶Ð¸Ð´Ð°ÐµÑ Ð¾Ð±Ð·Ð²Ð¾Ð½Ð°</span> : <>
        {member.is_blocked && <span className="badge badge-red">ÐÐ°Ð±Ð»Ð¾ÐºÐ¸ÑÐ¾Ð²Ð°Ð½</span>}
        <span className={`badge ${member.weekly_events >= target ? 'badge-green' : 'badge-red'}`}>{member.weekly_events || 0} / Ð½ÐµÐ´.</span>
        {canEdit && canManageMember(member) && (
          <div className="row-actions">
            <button className="icon-btn" title="Ð ÐµÐ´Ð°ÐºÑÐ¸ÑÐ¾Ð²Ð°ÑÑ" onClick={() => setEditing(member)}><NavIcon name="edit" /></button>
            <button className="icon-btn danger" title="Ð£Ð´Ð°Ð»Ð¸ÑÑ" onClick={() => void removeMember(member.id)}><NavIcon name="trash" /></button>
          </div>
        )}
      </>}
    </div>
  );

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">{members.length} ÑÑÐ°ÑÑÐ½Ð¸ÐºÐ¾Ð² Â· Ð½Ð¾ÑÐ¼Ð° {target}+ ÐÐ</div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><NavIcon name="plus" /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ ÑÑÐ°ÑÑÐ½Ð¸ÐºÐ°</button>}
      </div>
      <div className="segmented roster-tabs">
        <button className={tab === 'with' ? 'active' : ''} onClick={() => setTab('with')}>Ð¡ ÑÐ¾Ð»ÑÐ¼Ð¸ Â· {withRoles.length}</button>
        <button className={tab === 'without' ? 'active' : ''} onClick={() => setTab('without')}>ÐÐµÐ· ÑÐ¾Ð»ÐµÐ¹ Â· {without.length}</button>
        <button className={tab === 'candidates' ? 'active' : ''} onClick={() => setTab('candidates')}>ÐÐ°Ð½Ð´Ð¸Ð´Ð°ÑÑ Â· {candidates.length}</button>
      </div>
      <ErrorText value={error} />
      {tab === 'with'
        ? roleGroups.map((group) => <section key={group.id}><div className="role-group-label">{group.label} Â· {group.members.length}</div>{group.members.map((member) => memberRow(member))}</section>)
        : shown.map((member) => memberRow(member, tab === 'candidates'))}
      {!shown.length && <div className="empty-state"><h3>ÐÐ´ÐµÑÑ Ð½Ð¸ÐºÐ¾Ð³Ð¾ Ð½ÐµÑ</h3></div>}

      {editing !== undefined && (
        <Modal title={editing ? 'Ð ÐµÐ´Ð°ÐºÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð¸Ðµ ÑÑÐ°ÑÑÐ½Ð¸ÐºÐ°' : 'ÐÐ¾Ð²ÑÐ¹ ÑÑÐ°ÑÑÐ½Ð¸Ðº'} onClose={() => setEditing(undefined)} wide>
          <form onSubmit={saveMember}>
            <ErrorText value={error} />
            <div className="field"><label>Имя</label><input className="input" name="nickname" required defaultValue={editing?.nickname || ''} /></div>
            <div className="form-row-2">
              <div className="field">
                <label>Ð Ð¾Ð»Ð¸</label>
                <div className="role-checklist">
                  {roles.map((role) => {
                    const allowed = canAssignRole(role);
                    const checked = (editing?.roles || []).some((r: Row) => r.id === role.id);
                    return (
                      <label className={`role-check-item${!allowed ? ' is-disabled' : ''}`} key={role.id} title={!allowed ? 'Ð Ð¾Ð»Ñ ÑÐ°Ð²Ð½Ð° Ð¸Ð»Ð¸ Ð²ÑÑÐµ Ð²Ð°ÑÐµÐ¹' : undefined}>
                        <input
                          type="checkbox"
                          name="roleIds"
                          value={role.id}
                          defaultChecked={checked}
                          disabled={!allowed}
                        />
                        {role.name}
                        {!allowed ? ' Â· Ð½ÐµÐ´Ð¾ÑÑÑÐ¿Ð½Ð°' : ''}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="field"><label>ÐÐ Ð·Ð° Ð½ÐµÐ´ÐµÐ»Ñ</label><input className="input" name="weeklyEvents" type="number" min="0" defaultValue={editing?.weekly_events || 0} /></div>
            </div>
            <div className="field"><label>ÐÐ°Ð¼ÐµÑÐºÐ°</label><textarea className="input" name="note" defaultValue={editing?.note || ''} /></div>
            {canGrantOwner && editing?.id ? (
              <label className="qform-check-label">
                <input type="checkbox" name="isOwner" defaultChecked={!!editing.is_owner} />
                ÐÐ»Ð°Ð´ÐµÐ»ÐµÑ Ð¿Ð¾ÑÑÐ°Ð»Ð°
              </label>
            ) : null}
            <div className="field-hint">
              ÐÐ¾Ð¶Ð½Ð¾ Ð½Ð°Ð·Ð½Ð°ÑÐ°ÑÑ ÑÐ¾Ð»ÑÐºÐ¾ ÑÐ¾Ð»Ð¸ Ð½Ð¸Ð¶Ðµ Ð²Ð°ÑÐµÐ¹ Ð² Ð¸ÐµÑÐ°ÑÑÐ¸Ð¸.
              ÐÐ²Ð°ÑÐ°Ñ ÑÐ¸Ð½ÑÑÐ¾Ð½Ð¸Ð·Ð¸ÑÑÐµÑÑÑ Ð¿ÑÐ¸ Ð²ÑÐ¾Ð´Ðµ ÑÐµÑÐµÐ· Discord.
            </div>
            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(undefined)}>ÐÑÐ¼ÐµÐ½Ð°</button><button className="btn btn-primary">Ð¡Ð¾ÑÑÐ°Ð½Ð¸ÑÑ</button></div>
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
    if (!(await askConfirm('Ð£Ð´Ð°Ð»Ð¸ÑÑ Ð·Ð°Ð¿Ð¸ÑÑ?', { title: 'Ð£Ð´Ð°Ð»ÐµÐ½Ð¸Ðµ', confirmLabel: 'Ð£Ð´Ð°Ð»Ð¸ÑÑ' }))) return;
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
        <div className="profile-main"><h2>{user.nickname}</h2><div className="role-tag">{(user.roles || []).map((r: Row) => r.name).join(' Â· ') || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸'}</div></div>
        <div className="profile-weekly"><div className="stat-value">{user.weekly_events || 0}</div><div className="stat-label">Ð¼Ð¿ Ð·Ð° Ð½ÐµÐ´ÐµÐ»Ñ</div></div>
      </div>
      <ErrorText value={error} />
      <div className="modal-actions profile-actions">
        {user.is_blocked && <button className="btn btn-ghost btn-sm" onClick={() => void unblock()}>Ð Ð°Ð·Ð±Ð»Ð¾ÐºÐ¸ÑÐ¾Ð²Ð°ÑÑ</button>}
        <button className="btn btn-primary btn-sm" disabled={user.is_blocked} onClick={() => setAdding(!adding)}><NavIcon name="plus" /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ Ð²ÑÐ³Ð¾Ð²Ð¾Ñ</button>
      </div>
      {adding && <form className="card card-pad inline-form" onSubmit={add}>{tier === 'helper' && <div className="field"><label>Ð¢Ð¸Ð¿</label><Select name="type" defaultValue="verbal" options={[{ value: 'verbal', label: `Ð£ÑÑÐ½ÑÐ¹ (+${data.limits.helper.verbalPoints} Ð±Ð°Ð»Ð»)` }, { value: 'strict', label: `Ð¡ÑÑÐ¾Ð³Ð¸Ð¹ (+${data.limits.helper.strictPoints} Ð±Ð°Ð»Ð»Ð°)` }]} /></div>}<div className="field"><label>ÐÑÐ¸ÑÐ¸Ð½Ð°</label><textarea className="input" name="reason" required /></div><button className="btn btn-primary">ÐÑÐ´Ð°ÑÑ</button></form>}
      <div className="card-header" style={{ marginTop: 18 }}><h3>ÐÑÑÐ¾ÑÐ¸Ñ Ð²ÑÐ³Ð¾Ð²Ð¾ÑÐ¾Ð²</h3><ReprimandSummary items={data.reprimands} tier={tier} limits={data.limits} /></div>
      <ReprimandLegend tier={tier} limits={data.limits} />
      {data.reprimands.map((item) => <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}><ReprimandBadge item={item} /><div className="who"><div><div className="nickname">{item.reason}</div><div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.issued_by_nickname ? ` Â· Ð²ÑÐ´Ð°Ð» ${item.issued_by_nickname}` : ''}</div></div></div><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></div>)}
      {!data.reprimands.length && <div className="empty-state">ÐÑÐ³Ð¾Ð²Ð¾ÑÐ¾Ð² Ð½ÐµÑ.</div>}
    </>
  );
}

export function ReprimandsInteractive() {
  const [data, setData] = useState<{ reprimands: Row[]; members: Row[]; limits: Row }>({ reprimands: [], members: [], limits: {} });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'helper' | 'admin'>('helper');
  const [error, setError] = useState('');

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
    if (!(await askConfirm('Ð£Ð´Ð°Ð»Ð¸ÑÑ Ð²ÑÐ³Ð¾Ð²Ð¾Ñ?', { title: 'Ð£Ð´Ð°Ð»ÐµÐ½Ð¸Ðµ', confirmLabel: 'Ð£Ð´Ð°Ð»Ð¸ÑÑ' }))) return;
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

  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{data.reprimands.length} Ð·Ð°Ð¿Ð¸ÑÐµÐ¹ Ð²ÑÐµÐ³Ð¾</div><button className="btn btn-primary btn-sm" disabled={!tabMembers.length} onClick={() => setAdding(true)}><NavIcon name="plus" /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ Ð²ÑÐ³Ð¾Ð²Ð¾Ñ</button></div>
      <div className="segmented roster-tabs">
        <button className={tab === 'helper' ? 'active' : ''} onClick={() => setTab('helper')}>Ð¥ÐµÐ»Ð¿ÐµÑÑ Â· {data.reprimands.filter((item) => item.tier === 'helper').length}</button>
        <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>ÐÐ´Ð¼Ð¸Ð½Ð¸ÑÑÑÐ°ÑÐ¾ÑÑ Â· {data.reprimands.filter((item) => item.tier === 'admin').length}</button>
      </div>
      <ErrorText value={error} />
      <ReprimandLegend tier={tab} limits={limits} />
      {groups.map((group) => <section className="rp-group" key={group.id}>
        <div className="rp-group-head">
          <div className="who"><Avatar row={{ ...group, nickname: group.nickname }} /><div><div className="nickname">{group.nickname} {group.isBlocked && <span className="badge badge-red">ÐÐ°Ð±Ð»Ð¾ÐºÐ¸ÑÐ¾Ð²Ð°Ð½</span>}</div><div className="role-tag">{group.role || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸'}</div></div></div>
          <div className="rp-group-badges"><ReprimandSummary items={group.entries} tier={tab} limits={limits} />{group.isBlocked && <button className="btn btn-ghost btn-sm" onClick={() => void unblock(group.id)}>Ð Ð°Ð·Ð±Ð»Ð¾ÐºÐ¸ÑÐ¾Ð²Ð°ÑÑ</button>}</div>
        </div>
        <div className="rp-group-entries">{group.entries.map((item) => <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}><ReprimandBadge item={item} /><div className="who"><div><div className="nickname">{item.reason}</div><div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.issued_by_nickname ? ` Â· Ð²ÑÐ´Ð°Ð» ${item.issued_by_nickname}` : ''}</div></div></div><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></div>)}</div>
      </section>)}
      {!groups.length && <div className="empty-state"><h3>ÐÑÐ³Ð¾Ð²Ð¾ÑÐ¾Ð² Ð½ÐµÑ</h3><p>Ð Ð²ÑÐ±ÑÐ°Ð½Ð½Ð¾Ð¹ Ð³ÑÑÐ¿Ð¿Ðµ Ð·Ð°Ð¿Ð¸ÑÐµÐ¹ Ð¿Ð¾ÐºÐ° Ð½ÐµÑ.</p></div>}
      {adding && <Modal title="ÐÐ¾Ð²ÑÐ¹ Ð²ÑÐ³Ð¾Ð²Ð¾Ñ" onClose={() => setAdding(false)}><form onSubmit={add}><ErrorText value={error} /><div className="field"><label>Ð¡Ð¾ÑÑÑÐ´Ð½Ð¸Ðº</label><Select name="userId" required placeholder="ÐÑÐ±ÐµÑÐ¸ÑÐµ" options={tabMembers.map((m) => ({ value: String(m.id), label: `${m.nickname} Â· ${m.role_name || 'ÐÐµÐ· ÑÐ¾Ð»Ð¸'}` }))} /></div>{tab === 'helper' && <div className="field"><label>Ð¢Ð¸Ð¿</label><Select name="type" defaultValue="verbal" options={[{ value: 'verbal', label: `Ð£ÑÑÐ½ÑÐ¹ (+${limits.helper.verbalPoints} Ð±Ð°Ð»Ð»)` }, { value: 'strict', label: `Ð¡ÑÑÐ¾Ð³Ð¸Ð¹ (+${limits.helper.strictPoints} Ð±Ð°Ð»Ð»Ð°)` }]} /></div>}<div className="field"><label>ÐÑÐ¸ÑÐ¸Ð½Ð°</label><textarea className="input" name="reason" required /></div><div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>ÐÑÐ¼ÐµÐ½Ð°</button><button className="btn btn-primary">ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ</button></div></form></Modal>}
    </>
  );
}
