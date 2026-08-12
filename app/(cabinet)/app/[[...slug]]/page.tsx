'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client/api';
import { useAuth } from '@/components/AuthProvider';
import { ContentSection } from '@/components/ContentSection';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Modal } from '@/components/ui/Modal';
import { EDIT_ROLES, userHasRoleIn } from '@/lib/roleAccess';

type Row = Record<string, any>;
const date = (value?: string) => value ? new Intl.DateTimeFormat('ru-RU').format(new Date(value)) : '—';
const avatar = (row: Row) => <div className="avatar">{row.avatar_url || row.avatarUrl ? <img src={row.avatar_url || row.avatarUrl} alt="" /> : String(row.nickname || row.user_nickname || '?').slice(0, 1)}</div>;
const ErrorText = ({ value }: { value: string }) => value ? <p className="error-text">{value}</p> : null;

function Dashboard() {
  const [members, setMembers] = useState<Row[]>([]); const [target, setTarget] = useState(5);
  useEffect(() => { api.get('/api/roster').then((d) => { setMembers(d.members || []); setTarget(d.target || 5); }).catch(() => undefined); }, []);
  const top = [...members].sort((a, b) => (b.weekly_events || 0) - (a.weekly_events || 0)).slice(0, 7);
  return <><div className="stat-grid"><div className="card card-pad stat-card"><div className="stat-value">{members.length}</div><div className="stat-label">Сотрудников</div></div><div className="card card-pad stat-card"><div className="stat-value">{members.filter((m) => (m.weekly_events || 0) >= target).length}</div><div className="stat-label">Выполнили недельный план</div></div><div className="card card-pad stat-card"><div className="stat-value">{target}</div><div className="stat-label">Цель на неделю</div></div></div><div className="card card-pad" style={{ marginTop: 20 }}><div className="card-header"><h3>Активность за неделю</h3></div>{top.map((m, i) => <div className="top-row" key={m.id}><b className="top-rank">{i + 1}</b>{avatar(m)}<div style={{ flex: 1 }}><b>{m.nickname}</b><div className="role-tag">{(m.roles || []).map((r: Row) => r.name).join(' · ') || m.role_name}</div></div><span className="badge badge-purple">{m.weekly_events || 0} событий</span></div>)}</div></>;
}

function Profile() {
  const { user, refresh } = useAuth(); const [items, setItems] = useState<Row[]>([]); const [nickname, setNickname] = useState(user?.nickname || ''); const [error, setError] = useState('');
  useEffect(() => { api.get('/api/reprimands/me').then((d) => setItems(d.reprimands || [])).catch((e) => setError(e.message)); }, []);
  const save = async () => { try { await api.put('/api/auth/me/nickname', { nickname }); await refresh(); } catch (e) { setError((e as Error).message); } };
  return <div className="top-grid"><div className="card card-pad"><div className="card-header"><h3>Мой профиль</h3></div><div className="field"><label>Никнейм</label><input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} /></div><p>Роли: <b>{user?.roles.join(' · ') || 'не назначены'}</b></p><p>Мероприятий за неделю: <b>{user?.weeklyEvents}</b></p><button className="btn btn-primary" onClick={() => void save()}>Сохранить</button><ErrorText value={error} /></div><div className="card card-pad"><div className="card-header"><h3>Мои выговоры</h3></div>{items.length ? items.map((r) => <div className="top-row" key={r.id}><span className={`badge badge-${r.type === 'strict' ? 'red' : 'amber'}`}>{r.type}</span><div><b>{r.reason}</b><div className="role-tag">{date(r.created_at)} · {r.issued_by_nickname || 'Система'}</div></div></div>) : <div className="empty-state"><p>Активных выговоров нет.</p></div>}</div></div>;
}

function Rules() {
  const { user } = useAuth(); const [rules, setRules] = useState<Row[]>([]); const [open, setOpen] = useState<number | null>(null); const [modal, setModal] = useState(false); const [form, setForm] = useState({ title: '', body: '' }); const [error, setError] = useState('');
  const editable = userHasRoleIn({ is_owner: user?.isOwner, roleNames: user?.roles }, EDIT_ROLES);
  const load = () => api.get('/api/rules').then((d) => setRules(d.rules || [])).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const save = async (e: FormEvent) => { e.preventDefault(); try { await api.post('/api/rules', form); setModal(false); setForm({ title: '', body: '' }); load(); } catch (x) { setError((x as Error).message); } };
  return <><div className="toolbar">{editable && <button className="btn btn-primary" onClick={() => setModal(true)}>Добавить правило</button>}<ErrorText value={error} /></div>{rules.map((rule) => <article className={`rules-card${open === rule.id ? ' open' : ''}`} key={rule.id}><div className="rules-card-header" onClick={() => setOpen(open === rule.id ? null : rule.id)}>{rule.image_id && <div className="rules-thumb"><img src={`/media/${rule.image_id}`} alt="" /></div>}<div className="rules-title">{rule.title}</div><div className="rules-chevron">⌄</div></div><div className="rules-panel"><div className="rules-panel-inner"><div className="rules-panel-text md-body" dangerouslySetInnerHTML={{ __html: rule.body }} /></div></div></article>)}{!rules.length && <div className="empty-state"><p>Правила пока не добавлены.</p></div>}{modal && <Modal title="Новое правило" onClose={() => setModal(false)} wide><form onSubmit={save}><div className="field"><label>Заголовок</label><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div><MarkdownEditor value={form.body} onChange={(body) => setForm({ ...form, body })} /><div className="modal-actions"><button className="btn btn-primary">Сохранить</button></div></form></Modal>}</>;
}

function Roster() {
  const { user } = useAuth(); const [members, setMembers] = useState<Row[]>([]); const [roles, setRoles] = useState<Row[]>([]); const [editing, setEditing] = useState<Row | null>(null); const [error, setError] = useState('');
  const allowed = userHasRoleIn({ is_owner: user?.isOwner, roleNames: user?.roles }, EDIT_ROLES);
  const load = () => api.get('/api/roster').then((d) => { setMembers(d.members || []); setRoles(d.roles || []); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!editing) return; try { const id = editing.id; const payload = { nickname: editing.nickname, weeklyEvents: Number(editing.weekly_events || 0), note: editing.note || '', roleIds: (editing.roles || []).map((r: Row) => r.id) }; if (id) await api.put(`/api/roster/${id}`, payload); else await api.post('/api/roster', payload); setEditing(null); load(); } catch (e) { setError((e as Error).message); } };
  return <><div className="toolbar"><div className="toolbar-left">Сотрудников: {members.length}</div>{allowed && <button className="btn btn-primary" onClick={() => setEditing({ nickname: '', weekly_events: 0, note: '', roles: [] })}>Добавить сотрудника</button>}</div>{members.map((m) => <div className="roster-row" key={m.id}>{avatar(m)}<div className="who"><div><div className="nickname">{m.nickname}</div><div className="role-tag">{(m.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}</div></div></div><span className="events-count badge badge-purple">{m.weekly_events || 0}</span>{allowed && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...m, roles: m.roles || [] })}>Изменить</button>}</div>)}<ErrorText value={error} />{editing && <Modal title={editing.id ? 'Изменить сотрудника' : 'Новый сотрудник'} onClose={() => setEditing(null)}><form onSubmit={save}><div className="field"><label>Никнейм</label><input className="input" required value={editing.nickname} onChange={(e) => setEditing({ ...editing, nickname: e.target.value })} /></div><div className="field"><label>Мероприятий за неделю</label><input className="input" type="number" value={editing.weekly_events} onChange={(e) => setEditing({ ...editing, weekly_events: e.target.value })} /></div><div className="field"><label>Роли</label><div className="role-checklist">{roles.map((role) => <label className="role-check-item" key={role.id}><input type="checkbox" checked={(editing.roles || []).some((r: Row) => r.id === role.id)} onChange={(e) => setEditing({ ...editing, roles: e.target.checked ? [...(editing.roles || []), role] : (editing.roles || []).filter((r: Row) => r.id !== role.id) })} />{role.name}</label>)}</div></div><div className="modal-actions"><button className="btn btn-primary">Сохранить</button></div></form></Modal>}</>;
}

function Vacations() {
  const [rows, setRows] = useState<Row[]>([]); const [form, setForm] = useState({ startDate: '', endDate: '', reason: '' }); const [error, setError] = useState('');
  const load = () => api.get('/api/vacations').then((d) => setRows(d.vacations || [])).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const create = async (e: FormEvent) => { e.preventDefault(); try { await api.post('/api/vacations', form); setForm({ startDate: '', endDate: '', reason: '' }); load(); } catch (x) { setError((x as Error).message); } };
  const review = async (id: number, status: string) => { try { await api.put(`/api/vacations/${id}`, { status }); load(); } catch (e) { setError((e as Error).message); } };
  return <div className="vac-layout"><div className="card card-pad"><div className="card-header"><h3>Календарь отпусков</h3></div>{rows.map((v) => <div className="vac-today-row" key={v.id}><div className="vac-today-row-head"><b>{v.nickname}</b><span className={`badge badge-${v.status === 'approved' ? 'green' : v.status === 'rejected' ? 'red' : 'amber'}`}>{v.status}</span></div><div className="vac-today-row-dates">{date(v.start_date)} — {date(v.end_date)}</div>{v.reason && <div className="role-tag">{v.reason}</div>}{v.status === 'pending' && <div className="rule-actions" style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={() => void review(v.id, 'approved')}>Одобрить</button><button className="btn btn-danger btn-sm" onClick={() => void review(v.id, 'rejected')}>Отклонить</button></div>}</div>)}</div><div className="card card-pad"><div className="card-header"><h3>Новый отпуск</h3></div><form onSubmit={create}><div className="field"><label>Начало</label><input className="input" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div><div className="field"><label>Конец</label><input className="input" type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div><div className="field"><label>Причина</label><textarea className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div><button className="btn btn-primary">Отправить</button></form><ErrorText value={error} /></div></div>;
}

function Applications({ candidates = false }: { candidates?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState('');
  const url = candidates ? '/api/applications/candidates' : '/api/applications';
  const load = () => api.get(url).then((d) => setRows(candidates ? d.candidates || [] : d.applications || [])).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [candidates]);
  const action = async (id: number, path: string, payload: Row, method: 'put' | 'post' = 'put') => {
    try {
      if (method === 'post') await api.post(path, payload);
      else await api.put(path, payload);
      load();
    } catch (e) { setError((e as Error).message); }
  };
  return <><ErrorText value={error} />{rows.map((item) => <article className="rule-card" key={item.id}><div className="rule-body"><h4>{item.nickname_static || item.applicant_name}<span className="badge badge-muted">{item.status}</span></h4><div className="rule-text">{candidates ? `Discord: ${item.discord}` : <><b>Возраст:</b> {item.age} · <b>Онлайн:</b> {item.avg_online}<br />{item.motivation}</>}</div></div><div className="rule-actions">{candidates ? <><button className="btn btn-primary btn-sm" onClick={() => void action(item.id, `/api/applications/${item.id}/call`, { passed: true }, 'post')}>Принять</button><button className="btn btn-danger btn-sm" onClick={() => void action(item.id, `/api/applications/${item.id}/call`, { passed: false }, 'post')}>Не прошёл</button></> : item.status === 'pending' && <><button className="btn btn-primary btn-sm" onClick={() => void action(item.id, `/api/applications/${item.id}`, { status: 'approved' })}>Одобрить</button><button className="btn btn-danger btn-sm" onClick={() => void action(item.id, `/api/applications/${item.id}`, { status: 'rejected' })}>Отклонить</button></>}</div></article>)}{!rows.length && <div className="empty-state"><p>{candidates ? 'Кандидатов на обзвон нет.' : 'Заявок нет.'}</p></div>}</>;
}

function Reprimands() {
  const [data, setData] = useState<{ reprimands: Row[]; members: Row[] }>({ reprimands: [], members: [] }); const [form, setForm] = useState({ userId: '', reason: '', type: 'verbal' }); const [error, setError] = useState('');
  const load = () => api.get('/api/reprimands').then(setData).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const add = async (e: FormEvent) => { e.preventDefault(); try { await api.post('/api/reprimands', { ...form, userId: Number(form.userId) }); setForm({ userId: '', reason: '', type: 'verbal' }); load(); } catch (x) { setError((x as Error).message); } };
  return <div className="top-grid"><div className="card card-pad"><div className="card-header"><h3>Выдать выговор</h3></div><form onSubmit={add}><div className="field"><label>Сотрудник</label><select className="input" required value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Выберите сотрудника</option>{data.members.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}</select></div><div className="field"><label>Причина</label><textarea className="input" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div><div className="field"><label>Тип</label><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="verbal">Устный</option><option value="strict">Строгий</option></select></div><button className="btn btn-primary">Выдать</button></form></div><div className="card card-pad"><div className="card-header"><h3>История</h3></div>{data.reprimands.map((r) => <div className="top-row" key={r.id}><span className="badge badge-red">{r.type}</span><div><b>{r.user_nickname}</b><div className="role-tag">{r.reason} · {date(r.created_at)}</div></div></div>)}</div><ErrorText value={error} /></div>;
}

function Owner() {
  const [data, setData] = useState<{ users: Row[]; roles: Row[] }>({ users: [], roles: [] }); const [error, setError] = useState('');
  const load = () => api.get('/api/owner/users').then(setData).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const toggleAdmin = async (row: Row) => { try { await api.put(`/api/owner/users/${row.id}`, { isAdmin: !row.is_admin }); load(); } catch (e) { setError((e as Error).message); } };
  return <><div className="card card-pad"><div className="card-header"><h3>Пользователи</h3></div>{data.users.map((u) => <div className="roster-row" key={u.id}>{avatar(u)}<div className="who"><div><div className="nickname">{u.nickname}</div><div className="role-tag">{(u.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}</div></div></div><span className={`badge ${u.is_admin ? 'badge-green' : 'badge-muted'}`}>{u.is_admin ? 'Администратор' : 'Пользователь'}</span><button className="btn btn-ghost btn-sm" onClick={() => void toggleAdmin(u)}>Сменить доступ</button></div>)}</div><ErrorText value={error} /></>;
}

function AccessPage({ blocked }: { blocked: boolean }) {
  return <div className="site"><div className="bg-decor" /><div className="empty-state" style={{ maxWidth: 520, margin: '80px auto' }}><h3>{blocked ? 'Учётная запись заблокирована' : 'Доступ пока закрыт'}</h3><p>{blocked ? 'Обратитесь к руководству отдела для разблокировки.' : 'Личный кабинет откроется после назначения роли в составе.'}</p></div></div>;
}

export default function CabinetPage() {
  const params = useParams<{ slug?: string[] }>(); const key = params.slug?.[0] || 'dashboard';
  if (key === 'blocked') return <AccessPage blocked />;
  if (key === 'pending') return <AccessPage blocked={false} />;
  if (key === 'profile') return <Profile />;
  if (key === 'faq') return <ContentSection section="faq" title="FAQ" />;
  if (key === 'regulations') return <ContentSection section="regulations" title="Регламент" />;
  if (key === 'first-steps') return <ContentSection section="first_steps" title="Первые шаги" />;
  if (key === 'rules') return <Rules />;
  if (key === 'roster') return <Roster />;
  if (key === 'vacations') return <Vacations />;
  if (key === 'reprimands') return <Reprimands />;
  if (key === 'applications') return <Applications />;
  if (key === 'candidates') return <Applications candidates />;
  if (key === 'owner') return <Owner />;
  return <Dashboard />;
}
