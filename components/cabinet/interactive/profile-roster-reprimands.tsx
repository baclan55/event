'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@/lib/auth';
import { NavIcon } from '@/components/NavIcons';
import { Avatar, DEFAULT_LIMITS, ErrorText, Modal, ReprimandBadge, ReprimandLegend, ReprimandSummary, request, type Row } from './shared';

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
      .catch((err) => setError((err as Error).message));
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
    setProfile(null); setProfileLoading(true); setError('');
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
        <span className="member-copy">
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
