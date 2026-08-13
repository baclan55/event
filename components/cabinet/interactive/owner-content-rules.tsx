'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { Avatar, ErrorText, MarkdownFormField, Modal, request, type Row } from './shared';

const AUDIT_LABELS: Record<string, string> = {
  'user.create': 'Создан пользователь',
  'user.update': 'Изменён пользователь',
  'user.delete': 'Удалён пользователь',
  'roles.update': 'Изменены роли',
  'reprimand.create': 'Выдан выговор',
  'reprimand.delete': 'Удалён выговор',
  'reprimand.unblock': 'Снята блокировка',
  'vacation.create': 'Создан отпуск',
  'vacation.approved': 'Отпуск одобрен',
  'vacation.rejected': 'Отпуск отклонён',
  'vacation.cancelled': 'Отпуск отменён',
  'vacation.delete': 'Удалён отпуск',
  'content.update': 'Изменён контент',
  'rule.create': 'Создано правило',
  'rule.update': 'Изменено правило',
  'rule.delete': 'Удалено правило',
  'application.approved': 'Заявка одобрена',
  'application.rejected': 'Заявка отклонена',
  'application.delete': 'Заявка удалена',
};

export function OwnerInteractive({ canManageOwners }: { canManageOwners: boolean }) {
  const [users, setUsers] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await request('/api/owner/users');
      setUsers(data.users || []); setRoles(data.roles || []); setAudit(data.audit || []);
    } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      const payload: Row = {
        nickname: form.get('nickname'),
        roleIds: form.getAll('roleIds').map(Number),
        isAdmin: form.get('isAdmin') === 'on',
      };
      if (canManageOwners) payload.isOwner = editing.is_owner || form.get('isOwner') === 'on';
      await request(`/api/owner/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
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
      {users.map((user) => <div className="roster-row" key={user.id}><Avatar row={user} /><div className="who"><div><div className="nickname">{user.nickname} {user.is_owner && <span className="badge badge-purple">Владелец</span>}</div><div className="role-tag">{(user.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}{user.discord_username ? ` · ${user.discord_username}` : ''}</div></div></div><div className="row-actions"><button className="icon-btn" onClick={() => setEditing(user)}><NavIcon name="edit" /></button>{!user.is_owner && <button className="icon-btn danger" onClick={() => void remove(user.id)}><NavIcon name="trash" /></button>}</div></div>)}
      <section className="card card-pad audit-card">
        <div className="card-header"><h3>Журнал действий</h3><span className="badge badge-muted">{audit.length}</span></div>
        <div className="audit-list">
          {audit.map((entry) => <div className="audit-row" key={entry.id}>
            <div className="audit-main"><span className="nickname">{AUDIT_LABELS[entry.action] || entry.action}</span><span className="role-tag">{entry.entity_type}{entry.entity_id ? ` #${entry.entity_id}` : ''}</span></div>
            <div className="audit-meta">{entry.actor_nickname || 'Удалённый пользователь'} · {new Date(entry.created_at).toLocaleString('ru-RU')}</div>
          </div>)}
          {!audit.length && <div className="empty-state"><p>Административных действий пока нет.</p></div>}
        </div>
      </section>
      {editing && <Modal title="Редактирование пользователя" onClose={() => setEditing(null)} wide><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Никнейм</label><input className="input" name="nickname" maxLength={60} required defaultValue={editing.nickname} /></div><div className="field"><label>Роли</label><div className="role-checklist">{roles.map((role) => <label className="role-check-item" key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={(editing.roles || []).some((r: Row) => r.id === role.id)} />{role.name}</label>)}</div></div><label className="qform-check-label"><input type="checkbox" name="isAdmin" defaultChecked={editing.is_admin} /> Администратор</label>{canManageOwners && <label className="qform-check-label"><input type="checkbox" name="isOwner" defaultChecked={editing.is_owner} disabled={editing.is_owner} /> Владелец</label>}<div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
    </>
  );
}

export function ContentInteractive({
  section,
  title,
  initialBlocks,
  canEdit,
  splitByAudience = false,
  canViewAdministrator = false,
}: {
  section: string;
  title: string;
  initialBlocks: Record<string, Row>;
  canEdit: boolean;
  splitByAudience?: boolean;
  canViewAdministrator?: boolean;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [audience, setAudience] = useState(splitByAudience ? 'helper' : 'general');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const block = blocks[audience] || (audience === 'helper' ? blocks.general : undefined) || {};
  const hasAudienceTabs = splitByAudience && canViewAdministrator;

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
          {hasAudienceTabs ? <div className="segmented"><button className={audience === 'helper' ? 'active' : ''} onClick={() => setAudience('helper')}>Event Helper</button><button className={audience === 'administrator' ? 'active' : ''} onClick={() => setAudience('administrator')}>Event Administrator</button></div> : <h3>{splitByAudience ? 'Event Helper' : title}</h3>}
          {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><NavIcon name="edit" /> Редактировать</button>}
        </div>
        {block.body ? <div className="md-body" dangerouslySetInnerHTML={{ __html: block.body }} /> : <div className="empty-state"><p>Текст пока не добавлен.</p></div>}
        {block.imageId && <div className="section-image"><img src={`/media/${block.imageId}`} alt="" /></div>}
        {block.updatedAt && (
          <div className="meta-line">
            Последнее редактирование: {new Date(block.updatedAt).toLocaleString('ru-RU')}
            {block.updatedBy ? ` · автор ${block.updatedBy}` : ''}
          </div>
        )}
      </div>
      {editing && <Modal title={`Редактирование · ${splitByAudience ? audience === 'helper' ? 'Event Helper' : 'Event Administrator' : title}`} onClose={() => setEditing(false)} wide><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Текст (Markdown)</label><MarkdownFormField name="body" initialValue={block.bodyRaw || ''} /></div><div className="field"><label>Картинка</label><input className="input" name="image" type="file" accept="image/*" />{block.imageId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => void removeImage()}><NavIcon name="trash" /> Удалить текущую</button>}</div><div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
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
