'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@/lib/auth';
import { NavIcon } from '@/components/NavIcons';
import { MarkdownEditor } from '@/components/MarkdownEditor';

type Row = Record<string, any>;

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка запроса (${response.status})`);
  return data;
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal-dialog${wide ? ' wide' : ''}`}>
        <button type="button" className="icon-btn modal-close" onClick={onClose}>×</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Avatar({ row, size = 40 }: { row: Row; size?: number }) {
  const src = row.avatar_url || row.avatarUrl ||
    (row.avatar_image_id ? `/media/${row.avatar_image_id}` : null) ||
    (row.avatarImageId ? `/media/${row.avatarImageId}` : null);
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : String(row.nickname || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

function ErrorText({ value }: { value: string }) {
  return value ? <p className="error-text">{value}</p> : null;
}

function MarkdownFormField({ name, initialValue }: { name: string; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <><MarkdownEditor value={value} onChange={setValue} /><input type="hidden" name={name} value={value} /></>;
}

const DEFAULT_LIMITS = {
  helper: { verbalPoints: 1, strictPoints: 2, blockPoints: 4, verbalToStrict: 2 },
  admin: { points: 3, decayDays: 10 },
};

function ReprimandBadge({ item }: { item: Row }) {
  if (item.type === 'verbal') {
    return <span className={`badge ${item.converted ? 'badge-muted' : 'badge-purple'}`}>{item.converted ? 'Устный · объединён' : 'Устный'}</span>;
  }
  if (item.type === 'strict') {
    return <span className="badge badge-red">{item.auto_generated ? 'Строгий · авто' : 'Строгий'}</span>;
  }
  return <span className={`badge ${item.active === false ? 'badge-muted' : 'badge-amber'}`}>{item.active === false ? 'Балл · списан' : 'Балл'}</span>;
}

function ReprimandSummary({ items, tier, limits = DEFAULT_LIMITS }: { items: Row[]; tier: string; limits?: Row }) {
  if (tier === 'admin') {
    const active = items.filter((item) => item.type === 'point' && item.active !== false);
    return (
      <div className="rp-group-badges">
        <span className={`badge ${active.length >= limits.admin.points ? 'badge-red' : 'badge-purple'}`}>Баллов: {active.length}/{limits.admin.points}</span>
        <span className="badge badge-muted">списание через {limits.admin.decayDays} дней</span>
      </div>
    );
  }
  const verbal = items.filter((item) => item.type === 'verbal' && !item.converted).length;
  const converted = items.filter((item) => item.type === 'verbal' && item.converted).length;
  const strict = items.filter((item) => item.type === 'strict').length;
  const points = verbal * limits.helper.verbalPoints + strict * limits.helper.strictPoints;
  return (
    <div className="rp-group-badges">
      <span className={`badge ${points >= limits.helper.blockPoints ? 'badge-red' : 'badge-purple'}`}>Баллы: {points}/{limits.helper.blockPoints}</span>
      <span className="badge badge-muted">Устных: {verbal}{converted ? ` (+${converted})` : ''}</span>
      <span className="badge badge-muted">Строгих: {strict}</span>
    </div>
  );
}

function ReprimandLegend({ tier, limits = DEFAULT_LIMITS }: { tier: string; limits?: Row }) {
  return tier === 'admin'
    ? <div className="rp-legend">Максимум <b>{limits.admin.points} баллов</b>. Каждый балл перестаёт учитываться через <b>{limits.admin.decayDays} дней</b>.</div>
    : <div className="rp-legend">Устный = <b>{limits.helper.verbalPoints} балл</b>, строгий = <b>{limits.helper.strictPoints} балла</b>. При <b>{limits.helper.blockPoints} баллах</b> учётная запись блокируется. Каждые <b>{limits.helper.verbalToStrict} устных</b> объединяются в строгий.</div>;
}

export function ProfileInteractive({
  initialUser,
  reprimands,
  target,
}: {
  initialUser: PublicUser;
  reprimands: Row[];
  target: number;
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [mode, setMode] = useState<'nickname' | null>(null);
  const [nickname, setNickname] = useState(user.nickname || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [rpData, setRpData] = useState({
    reprimands,
    tier: initialUser.rolePriority != null && initialUser.rolePriority <= 5 ? 'admin' : 'helper',
    limits: DEFAULT_LIMITS as Row,
  });
  const done = user.weeklyEvents >= target;

  useEffect(() => {
    request('/api/reprimands/me')
      .then((data) => setRpData({
        reprimands: data.reprimands || reprimands,
        tier: data.tier || 'helper',
        limits: data.limits || DEFAULT_LIMITS,
      }))
      .catch(() => undefined);
  }, [reprimands]);

  async function saveNickname(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      const data = await request('/api/auth/me/nickname', {
        method: 'PUT',
        body: JSON.stringify({ nickname }),
      });
      setUser(data.user);
      setMode(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="card card-pad profile-hero">
        <div className="profile-avatar-wrap"><Avatar row={user} size={68} /></div>
        <div className="profile-main">
          <div className="profile-name-line">
            <h2>{user.nickname || 'Без никнейма'}</h2>
            <button className="icon-btn" type="button" title="Изменить никнейм" onClick={() => setMode('nickname')}>
              <NavIcon name="edit" />
            </button>
          </div>
          <div className="role-tag">
            {user.roles.join(' · ') || 'Без роли'}
            {user.discordUsername ? ` · ${user.discordUsername}` : ''}
          </div>
        </div>
        <div className="profile-weekly">
          <div className="stat-value">{user.weeklyEvents}</div>
          <div className="stat-label">мп за неделю</div>
          <span className={`badge ${done ? 'badge-green' : 'badge-red'}`}>
            {done ? 'норма выполнена' : `цель ${target}`}
          </span>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div className="card-header">
          <h3>Мои выговоры</h3>
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
      </div>

      {mode === 'nickname' && (
        <Modal title="Изменить никнейм" onClose={() => setMode(null)}>
          <form onSubmit={saveNickname}>
            <ErrorText value={error} />
            <div className="field"><label>Никнейм</label><input className="input" maxLength={60} value={nickname} onChange={(e) => setNickname(e.target.value)} /></div>
            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>Отмена</button><button className="btn btn-primary" disabled={saving}>Сохранить</button></div>
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
}: {
  initialMembers: Row[];
  roles: Row[];
  target: number;
  canEdit: boolean;
  canViewProfiles: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [tab, setTab] = useState<'with' | 'without' | 'candidates'>('with');
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [profile, setProfile] = useState<{ user: Row; reprimands: Row[]; limits: Row } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState('');

  async function reload() {
    const data = await request('/api/roster');
    setMembers(data.members || []);
  }

  async function openProfile(id: number) {
    if (!canViewProfiles) return;
    setProfileLoading(true); setError('');
    try {
      setProfile(await request(`/api/reprimands/user/${id}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProfileLoading(false);
    }
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roleIds = form.getAll('roleIds').map(Number);
    const payload = {
      nickname: String(form.get('nickname') || ''),
      weeklyEvents: Number(form.get('weeklyEvents') || 0),
      note: String(form.get('note') || ''),
      roleIds,
    };
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

  const candidates = members.filter((m) => m.status === 'candidate');
  const without = members.filter((m) => !m.role_id && m.status !== 'candidate');
  const withRoles = members.filter((m) => m.role_id);
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

  const memberRow = (member: Row, candidate = false) => (
    <div className="roster-row" key={member.id}>
      <button className={`who member-profile-trigger${canViewProfiles && !candidate ? ' who-clickable' : ''}`} type="button" onClick={() => !candidate && void openProfile(member.id)} disabled={!canViewProfiles || candidate}>
        <Avatar row={member} />
        <span>
          <span className="nickname">{member.nickname}</span>
          <span className="role-tag">{candidate ? 'Кандидат' : (member.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}{member.discord_username ? ` · ${member.discord_username}` : ''}</span>
        </span>
      </button>
      {candidate ? <span className="badge badge-amber">Ожидает обзвона</span> : <>
        {member.is_blocked && <span className="badge badge-red">Заблокирован</span>}
        <span className={`badge ${member.weekly_events >= target ? 'badge-green' : 'badge-red'}`}>{member.weekly_events || 0} / нед.</span>
        {canEdit && <div className="row-actions"><button className="icon-btn" title="Редактировать" onClick={() => setEditing(member)}><NavIcon name="edit" /></button><button className="icon-btn danger" title="Удалить" onClick={() => void removeMember(member.id)}><NavIcon name="trash" /></button></div>}
      </>}
    </div>
  );

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">{members.length} участников · норма {target}+ МП</div>
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
      {!shown.length && <div className="empty-state"><h3>Здесь никого нет</h3></div>}

      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование участника' : 'Новый участник'} onClose={() => setEditing(undefined)} wide>
          <form onSubmit={saveMember}>
            <ErrorText value={error} />
            <div className="field"><label>Никнейм</label><input className="input" name="nickname" required defaultValue={editing?.nickname || ''} /></div>
            <div className="form-row-2">
              <div className="field"><label>Роли</label><div className="role-checklist">{roles.map((role) => <label className="role-check-item" key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={(editing?.roles || []).some((r: Row) => r.id === role.id)} />{role.name}</label>)}</div></div>
              <div className="field"><label>МП за неделю</label><input className="input" name="weeklyEvents" type="number" min="0" defaultValue={editing?.weekly_events || 0} /></div>
            </div>
            <div className="field"><label>Заметка</label><textarea className="input" name="note" defaultValue={editing?.note || ''} /></div>
            <div className="field-hint">Аватар синхронизируется автоматически при входе пользователя через Discord.</div>
            <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(undefined)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div>
          </form>
        </Modal>
      )}
      {(profileLoading || profile) && (
        <Modal title={profile?.user.nickname || 'Профиль сотрудника'} onClose={() => setProfile(null)} wide>
          {profileLoading ? <div className="empty-state">Загрузка…</div> : profile && <MemberProfileBody data={profile} onChanged={async () => { setProfile(await request(`/api/reprimands/user/${profile.user.id}`)); await reload(); }} />}
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
        <div className="profile-main"><h2>{user.nickname}</h2><div className="role-tag">{(user.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}</div></div>
        <div className="profile-weekly"><div className="stat-value">{user.weekly_events || 0}</div><div className="stat-label">мп за неделю</div></div>
      </div>
      <ErrorText value={error} />
      <div className="modal-actions profile-actions">
        {user.is_blocked && <button className="btn btn-ghost btn-sm" onClick={() => void unblock()}>Разблокировать</button>}
        <button className="btn btn-primary btn-sm" disabled={user.is_blocked} onClick={() => setAdding(!adding)}><NavIcon name="plus" /> Добавить выговор</button>
      </div>
      {adding && <form className="card card-pad inline-form" onSubmit={add}>{tier === 'helper' && <div className="field"><label>Тип</label><select className="input" name="type"><option value="verbal">Устный (+{data.limits.helper.verbalPoints} балл)</option><option value="strict">Строгий (+{data.limits.helper.strictPoints} балла)</option></select></div>}<div className="field"><label>Причина</label><textarea className="input" name="reason" required /></div><button className="btn btn-primary">Выдать</button></form>}
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

  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{data.reprimands.length} записей всего</div><button className="btn btn-primary btn-sm" disabled={!tabMembers.length} onClick={() => setAdding(true)}><NavIcon name="plus" /> Добавить выговор</button></div>
      <div className="segmented roster-tabs">
        <button className={tab === 'helper' ? 'active' : ''} onClick={() => setTab('helper')}>Хелперы · {data.reprimands.filter((item) => item.tier === 'helper').length}</button>
        <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>Администраторы · {data.reprimands.filter((item) => item.tier === 'admin').length}</button>
      </div>
      <ErrorText value={error} />
      <ReprimandLegend tier={tab} limits={limits} />
      {groups.map((group) => <section className="rp-group" key={group.id}>
        <div className="rp-group-head">
          <div className="who"><Avatar row={{ ...group, nickname: group.nickname }} /><div><div className="nickname">{group.nickname} {group.isBlocked && <span className="badge badge-red">Заблокирован</span>}</div><div className="role-tag">{group.role || 'Без роли'}</div></div></div>
          <div className="rp-group-badges"><ReprimandSummary items={group.entries} tier={tab} limits={limits} />{group.isBlocked && <button className="btn btn-ghost btn-sm" onClick={() => void unblock(group.id)}>Разблокировать</button>}</div>
        </div>
        <div className="rp-group-entries">{group.entries.map((item) => <div className={`roster-row rp-entry${item.active === false || item.converted ? ' rp-expired' : ''}`} key={item.id}><ReprimandBadge item={item} /><div className="who"><div><div className="nickname">{item.reason}</div><div className="role-tag">{new Date(item.created_at).toLocaleString('ru-RU')}{item.issued_by_nickname ? ` · выдал ${item.issued_by_nickname}` : ''}</div></div></div><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></div>)}</div>
      </section>)}
      {!groups.length && <div className="empty-state"><h3>Выговоров нет</h3><p>В выбранной группе записей пока нет.</p></div>}
      {adding && <Modal title="Новый выговор" onClose={() => setAdding(false)}><form onSubmit={add}><ErrorText value={error} /><div className="field"><label>Сотрудник</label><select className="input" name="userId" required><option value="">Выберите</option>{tabMembers.map((m) => <option value={m.id} key={m.id}>{m.nickname} · {m.role_name || 'Без роли'}</option>)}</select></div>{tab === 'helper' && <div className="field"><label>Тип</label><select className="input" name="type"><option value="verbal">Устный (+{limits.helper.verbalPoints} балл)</option><option value="strict">Строгий (+{limits.helper.strictPoints} балла)</option></select></div>}<div className="field"><label>Причина</label><textarea className="input" name="reason" required /></div><div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Отмена</button><button className="btn btn-primary">Добавить</button></div></form></Modal>}
    </>
  );
}

export function OwnerInteractive() {
  const [users, setUsers] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await request('/api/owner/users');
      setUsers(data.users || []); setRoles(data.roles || []);
    } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/owner/users/${editing.id}`, { method: 'PUT', body: JSON.stringify({
        nickname: form.get('nickname'),
        roleIds: form.getAll('roleIds').map(Number),
        isAdmin: form.get('isAdmin') === 'on',
        isOwner: form.get('isOwner') === 'on',
      }) });
      setEditing(null); await load();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    if (!confirm('Удалить пользователя безвозвратно?')) return;
    try { await request(`/api/owner/users/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{users.length} учётных записей</div></div>
      <ErrorText value={error} />
      {users.map((user) => <div className="roster-row" key={user.id}><Avatar row={user} /><div className="who"><div><div className="nickname">{user.nickname} {user.is_owner && <span className="badge badge-purple">Владелец</span>}</div><div className="role-tag">{(user.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}{user.discord_username ? ` · ${user.discord_username}` : ''}</div></div></div><div className="row-actions"><button className="icon-btn" onClick={() => setEditing(user)}><NavIcon name="edit" /></button><button className="icon-btn danger" onClick={() => void remove(user.id)}><NavIcon name="trash" /></button></div></div>)}
      {editing && <Modal title="Редактирование пользователя" onClose={() => setEditing(null)} wide><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Никнейм</label><input className="input" name="nickname" defaultValue={editing.nickname} /></div><div className="field"><label>Роли</label><div className="role-checklist">{roles.map((role) => <label className="role-check-item" key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={(editing.roles || []).some((r: Row) => r.id === role.id)} />{role.name}</label>)}</div></div><label className="qform-check-label"><input type="checkbox" name="isAdmin" defaultChecked={editing.is_admin} /> Администратор</label><label className="qform-check-label"><input type="checkbox" name="isOwner" defaultChecked={editing.is_owner} /> Владелец</label><div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
    </>
  );
}

export function ContentInteractive({
  section,
  title,
  initialBlocks,
  canEdit,
}: {
  section: string;
  title: string;
  initialBlocks: Record<string, Row>;
  canEdit: boolean;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [audience, setAudience] = useState(initialBlocks.helper ? 'helper' : 'general');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const block = blocks[audience] || {};
  const hasAudienceTabs = !!(blocks.helper || blocks.administrator);

  async function reload() {
    const data = await request(`/api/content/${section}`);
    setBlocks(data.blocks || {});
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/content/${section}`, {
        method: 'PUT',
        body: JSON.stringify({ audience, body: form.get('body') }),
      });
      const file = form.get('image');
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append('image', file); upload.append('audience', audience);
        await request(`/api/content/${section}/image?audience=${audience}`, { method: 'POST', body: upload });
      }
      setEditing(false); await reload();
    } catch (err) { setError((err as Error).message); }
  }

  async function removeImage() {
    try {
      await request(`/api/content/${section}/image?audience=${audience}`, { method: 'DELETE' });
      await reload();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="card card-pad">
        <div className="card-header">
          {hasAudienceTabs ? <div className="segmented"><button className={audience === 'helper' ? 'active' : ''} onClick={() => setAudience('helper')}>Event Helper</button><button className={audience === 'administrator' ? 'active' : ''} onClick={() => setAudience('administrator')}>Event Administrator</button></div> : <h3>{title}</h3>}
          {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><NavIcon name="edit" /> Редактировать</button>}
        </div>
        {block.body ? <div className="md-body" dangerouslySetInnerHTML={{ __html: block.body }} /> : <div className="empty-state"><p>Текст пока не добавлен.</p></div>}
        {block.imageId && <div className="section-image"><img src={`/media/${block.imageId}`} alt="" /></div>}
        {block.updatedAt && <div className="meta-line">Обновлено {new Date(block.updatedAt).toLocaleString('ru-RU')}{block.updatedBy ? ` · ${block.updatedBy}` : ''}</div>}
      </div>
      {editing && <Modal title={`Редактирование · ${title}`} onClose={() => setEditing(false)} wide><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Текст (Markdown)</label><MarkdownFormField name="body" initialValue={block.bodyRaw || ''} /></div><div className="field"><label>Картинка</label><input className="input" name="image" type="file" accept="image/*" />{block.imageId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => void removeImage()}><NavIcon name="trash" /> Удалить текущую</button>}</div><div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
    </>
  );
}

export function RulesInteractive({ initialRules, canEdit }: { initialRules: Row[]; canEdit: boolean }) {
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [error, setError] = useState('');

  async function reload() {
    const data = await request('/api/rules');
    setRules(data.rules || []);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { title: form.get('title'), body: form.get('body') };
    try {
      let id = editing?.id;
      if (id) await request(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else id = (await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) })).id;
      const file = form.get('image');
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append('image', file);
        await request(`/api/rules/${id}/image`, { method: 'POST', body: upload });
      }
      setEditing(undefined); await reload();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    if (!confirm('Удалить правило?')) return;
    try { await request(`/api/rules/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }

  async function move(id: number, direction: -1 | 1) {
    const index = rules.findIndex((rule) => rule.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= rules.length) return;
    const next = [...rules];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setRules(next);
    try {
      await request('/api/rules/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order: next.map((rule) => rule.id) }),
      });
    } catch (err) {
      setRules(rules);
      setError((err as Error).message);
    }
  }

  async function removeRuleImage(id: number) {
    try {
      await request(`/api/rules/${id}/image`, { method: 'DELETE' });
      setEditing(undefined);
      await reload();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{rules.length} правил</div>{canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><NavIcon name="plus" /> Добавить правило</button>}</div>
      <ErrorText value={error} />
      {rules.map((rule, index) => <details className="rules-card" key={rule.id}><summary className="rules-card-header"><div className="rules-thumb">{rule.image_id ? <img src={`/media/${rule.image_id}`} alt="" /> : <NavIcon name="image" />}</div><div className="rules-title">{rule.title}</div>{canEdit && <div className="rules-card-actions" onClick={(event) => event.preventDefault()}><button className="icon-btn" disabled={index === 0} title="Выше" onClick={() => void move(rule.id, -1)}>↑</button><button className="icon-btn" disabled={index === rules.length - 1} title="Ниже" onClick={() => void move(rule.id, 1)}>↓</button><button className="icon-btn" onClick={() => setEditing(rule)}><NavIcon name="edit" /></button><button className="icon-btn danger" onClick={() => void remove(rule.id)}><NavIcon name="trash" /></button></div>}</summary><div className="rules-panel" style={{ display: 'block' }}><div className="rules-panel-inner"><div className="rules-panel-text md-body" dangerouslySetInnerHTML={{ __html: rule.bodyHtml || rule.body || '' }} /></div></div></details>)}
      {!rules.length && <div className="empty-state"><h3>Правил пока нет</h3></div>}
      {editing !== undefined && <Modal title={editing ? 'Редактирование правила' : 'Новое правило'} onClose={() => setEditing(undefined)} wide><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Заголовок</label><input className="input" name="title" required defaultValue={editing?.title || ''} /></div><div className="field"><label>Текст (Markdown)</label><MarkdownFormField name="body" initialValue={editing?.bodyRaw || ''} /></div><div className="field"><label>Картинка</label><input className="input" type="file" name="image" accept="image/*" />{editing?.image_id && <button className="btn btn-ghost btn-sm" type="button" onClick={() => void removeRuleImage(editing.id)}><NavIcon name="trash" /> Удалить текущую</button>}</div><div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setEditing(undefined)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
    </>
  );
}

export function VacationsInteractive({
  initialRows,
  currentUserId,
  canReview,
}: {
  initialRows: Row[];
  currentUserId: number;
  canReview: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [pickerMonth, setPickerMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const today = new Date();
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const monthTitle = (date: Date) => date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const calendarDays = (date: Date) => {
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  };
  const statusLabel = (value: string) => value === 'approved' ? 'Одобрено' : value === 'rejected' ? 'Отклонено' : value === 'cancelled' ? 'Отменено' : 'На рассмотрении';
  const dayRows = (date: Date) => rows.filter((row) => {
    const value = iso(date);
    return row.status !== 'cancelled' && value >= String(row.start_date).slice(0, 10) && value <= String(row.end_date).slice(0, 10);
  });
  const pending = rows.filter((row) => row.status === 'pending');
  const mine = rows.filter((row) => row.user_id === currentUserId);
  const todayRows = dayRows(today);

  async function reload() {
    const data = await request('/api/vacations');
    setRows(data.vacations || []);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rangeStart) return setError('Выберите период отпуска.');
    try {
      await request('/api/vacations', { method: 'POST', body: JSON.stringify({ startDate: rangeStart, endDate: rangeEnd || rangeStart, reason }) });
      setAdding(false); setRangeStart(''); setRangeEnd(''); setReason(''); await reload();
    }
    catch (err) { setError((err as Error).message); }
  }
  async function status(id: number, value: string) {
    try { await request(`/api/vacations/${id}`, { method: 'PUT', body: JSON.stringify({ status: value }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function remove(id: number) {
    if (!confirm('Удалить заявку на отпуск?')) return;
    try { await request(`/api/vacations/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }

  function chooseDate(value: string) {
    if (!rangeStart || rangeEnd) {
      setRangeStart(value); setRangeEnd('');
    } else if (value < rangeStart) {
      setRangeEnd(rangeStart); setRangeStart(value);
    } else {
      setRangeEnd(value);
    }
  }

  return (
    <>
      <ErrorText value={error} />
      {canReview && pending.length > 0 && <div className="card card-pad vac-review-card">
        <div className="card-header"><h3>На рассмотрении</h3><span className="badge badge-amber">{pending.length}</span></div>
        {pending.map((row) => <div className="roster-row" key={row.id}><Avatar row={row} /><div className="who"><div><div className="nickname">{row.nickname}</div><div className="role-tag">{new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}{row.reason ? ` · ${row.reason}` : ''}</div></div></div><button className="btn btn-primary btn-sm" onClick={() => void status(row.id, 'approved')}>Одобрить</button><button className="btn btn-danger btn-sm" onClick={() => void status(row.id, 'rejected')}>Отклонить</button></div>)}
      </div>}

      <div className="vac-layout">
        <div className="card card-pad">
          <div className="vac-cal-header">
            <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
            <div className="vac-cal-title">{monthTitle(month)}</div>
            <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
            <div className="vac-cal-spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Сегодня</button>
          </div>
          <div className="vac-cal-scroll"><div className="vac-cal-inner">
            <div className="vac-cal-weekdays">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div key={day}>{day}</div>)}</div>
            <div className="vac-simple-grid">{calendarDays(month).map((day) => {
              const entries = dayRows(day);
              return <div className={`vac-day-cell${day.getMonth() !== month.getMonth() ? ' is-muted' : ''}`} key={iso(day)}>
                <div className={`vac-day-num${iso(day) === iso(today) ? ' is-today' : ''}`}>{day.getDate()}</div>
                <div className="vac-day-items">{entries.slice(0, 2).map((row) => <div className={`vac-day-item status-${row.status}`} title={`${row.nickname}: ${row.reason || 'без причины'}`} key={row.id}>{row.nickname}</div>)}{entries.length > 2 && <div className="vac-day-overflow">+ ещё {entries.length - 2}</div>}</div>
                <div className={`vac-day-occupancy${entries.length >= 3 ? ' is-near' : ''}`}>{entries.length}/3</div>
              </div>;
            })}</div>
          </div></div>
          <div className="vac-legend"><span className="vac-legend-item"><i className="vac-legend-dot status-approved" />Одобрено</span><span className="vac-legend-item"><i className="vac-legend-dot status-pending" />На рассмотрении</span><span className="vac-legend-item"><i className="vac-legend-dot status-rejected" />Отклонено</span></div>
        </div>

        <aside className="vac-sidebar">
          <div className="card card-pad">
            <div className="vac-today-label">Сегодня</div><div className="vac-today-date">{today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            <div className="vac-today-list">{todayRows.map((row) => <div className="vac-today-row" key={row.id}><div className="vac-today-row-head"><span className="nickname">{row.nickname}</span><span className={`badge badge-${row.status === 'approved' ? 'green' : 'amber'}`}>{statusLabel(row.status)}</span></div><div className="vac-today-row-dates">{new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}</div></div>)}{!todayRows.length && <div className="role-tag">Сегодня никто не в отпуске.</div>}</div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><NavIcon name="plus" /> Новый отпуск</button>
          </div>
          <div className="card card-pad"><div className="card-header"><h3>Мои заявки</h3></div>{mine.map((row) => <div className="vac-today-row" key={row.id}><div className="vac-today-row-head"><span className="vac-today-row-dates">{new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}</span><span className={`badge badge-${row.status === 'approved' ? 'green' : row.status === 'rejected' ? 'red' : 'amber'}`}>{statusLabel(row.status)}</span></div>{row.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => void status(row.id, 'cancelled')}>Отменить</button>}</div>)}</div>
        </aside>
      </div>

      {canReview && <div className="card card-pad" style={{ marginTop: 20 }}><div className="card-header"><h3>Все заявки</h3></div>{rows.map((row) => <div className="roster-row" key={row.id}><Avatar row={row} /><div className="who"><div><div className="nickname">{row.nickname}</div><div className="role-tag">{new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}</div></div></div><span className="badge badge-muted">{statusLabel(row.status)}</span><button className="icon-btn danger" onClick={() => void remove(row.id)}><NavIcon name="trash" /></button></div>)}</div>}

      {adding && <Modal title="Новый отпуск" onClose={() => setAdding(false)}><form onSubmit={create}><ErrorText value={error} /><div className="field"><label>Период отпуска</label><div className="vac-period-trigger"><span>{rangeStart ? `${new Date(`${rangeStart}T00:00:00`).toLocaleDateString('ru-RU')} — ${new Date(`${rangeEnd || rangeStart}T00:00:00`).toLocaleDateString('ru-RU')}` : 'Выберите даты'}</span></div><div className="vac-mini-cal"><div className="vac-mini-head"><button type="button" className="icon-btn" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() - 1, 1))}>‹</button><b>{monthTitle(pickerMonth)}</b><button type="button" className="icon-btn" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 1))}>›</button></div><div className="vac-mini-grid">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div className="vac-mini-wd" key={day}>{day}</div>)}{calendarDays(pickerMonth).map((day) => { const value = iso(day); const inRange = rangeStart && value >= rangeStart && value <= (rangeEnd || rangeStart); return <button type="button" className={`vac-mini-day${day.getMonth() !== pickerMonth.getMonth() ? ' is-muted' : ''}${value === rangeStart ? ' range-start' : ''}${value === rangeEnd ? ' range-end' : ''}${inRange ? ' in-range' : ''}${value === iso(today) ? ' is-today' : ''}`} key={value} onClick={() => chooseDate(value)}>{day.getDate()}</button>; })}</div><div className="vac-mini-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRangeStart(''); setRangeEnd(''); }}>Сбросить</button></div></div></div><div className="field"><label>Причина (необязательно)</label><textarea className="input" value={reason} onChange={(event) => setReason(event.target.value)} /></div><div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>Отмена</button><button className="btn btn-primary">Создать</button></div></form></Modal>}
    </>
  );
}

export function ApplicationsInteractive({ initialRows, candidates = false }: { initialRows: Row[]; candidates?: boolean }) {
  const [rows, setRows] = useState(initialRows);
  const [isOpen, setIsOpen] = useState(true);
  const [error, setError] = useState('');

  async function reload() {
    try {
      const data = await request(candidates ? '/api/applications/candidates' : '/api/applications');
      setRows(candidates ? data.candidates || [] : data.applications || []);
      if (typeof data.isOpen === 'boolean') setIsOpen(data.isOpen);
    } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void reload(); }, [candidates]);
  async function update(id: number, status: string) {
    try { await request(`/api/applications/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function call(id: number, passed: boolean) {
    if (!confirm(passed ? 'Кандидат прошёл обзвон?' : 'Кандидат не прошёл обзвон?')) return;
    try { await request(`/api/applications/${id}/call`, { method: 'POST', body: JSON.stringify({ passed }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function remove(id: number) {
    if (!confirm('Удалить заявку?')) return;
    try { await request(`/api/applications/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function toggle() {
    try { const data = await request('/api/applications/status', { method: 'PUT', body: JSON.stringify({ isOpen: !isOpen }) }); setIsOpen(data.isOpen); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{rows.length} {candidates ? 'кандидатов ожидают обзвона' : 'заявок'}</div>{!candidates && <div className="toolbar-right"><span className={`badge ${isOpen ? 'badge-green' : 'badge-red'}`}>{isOpen ? 'Набор открыт' : 'Набор закрыт'}</span><button className="btn btn-ghost btn-sm" onClick={() => void toggle()}>{isOpen ? 'Закрыть набор' : 'Открыть набор'}</button></div>}</div>
      <ErrorText value={error} />
      {candidates && rows.length > 0 && <div className="rp-legend">После обзвона кандидат получает роль <b>Mini Event Helper</b> и автоматически попадает в состав либо снимается с рассмотрения.</div>}
      {rows.map((item) => <article className="rule-card" key={item.id}><div className="rule-body">{candidates ? <div className="who"><Avatar row={{ nickname: item.candidate_nickname || item.nickname_static, avatar_url: item.candidate_avatar_url, avatar_image_id: item.candidate_avatar_image_id }} /><div><h4>{item.candidate_nickname || item.nickname_static || item.applicant_name}</h4><div className="role-tag">Discord: {item.discord}</div></div></div> : <><h4>{item.nickname_static || item.applicant_name} <span className="badge badge-muted">{item.status}</span></h4><div className="rule-text"><b>Discord:</b> {item.discord}<br /><b>Возраст:</b> {item.age} · <b>Онлайн:</b> {item.avg_online}<br /><b>Время в игре:</b> {item.time_period}<br /><b>Опыт:</b> {item.experience}<br /><b>Идеи:</b> {item.ideas}<br /><b>Мотивация:</b> {item.motivation}</div></>}<div className="meta-line">{new Date(item.created_at).toLocaleString('ru-RU')}{item.reviewed_by_nickname ? ` · рассмотрел ${item.reviewed_by_nickname}` : ''}</div></div><div className="rule-actions">{candidates ? <><button className="btn btn-primary btn-sm" onClick={() => void call(item.id, true)}>Прошёл обзвон</button><button className="btn btn-danger btn-sm" onClick={() => void call(item.id, false)}>Не прошёл</button></> : <><button className="btn btn-primary btn-sm" onClick={() => void update(item.id, 'approved')}>Одобрить</button><button className="btn btn-ghost btn-sm" onClick={() => void update(item.id, 'rejected')}>Отклонить</button><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></>}</div></article>)}
      {!rows.length && <div className="empty-state"><h3>{candidates ? 'Кандидатов нет' : 'Заявок нет'}</h3></div>}
    </>
  );
}
