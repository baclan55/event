'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { PERMISSION_LABELS, PERMISSIONS, type Permission } from '@/lib/roleAccess';
import { ErrorText, Modal, request } from './shared';

type RoleRow = {
  id: number;
  name: string;
  priority: number;
  permissions: Record<Permission, boolean>;
  usersCount: number;
};

export function RolesInteractive({
  canGrantOwner,
}: {
  canGrantOwner: boolean;
}) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [editing, setEditing] = useState<RoleRow | null | undefined>(undefined);
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await request('/api/roles');
      setRoles(data.roles || []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const permissions = Object.fromEntries(
      PERMISSIONS.map((key) => [key, form.get(`perm_${key}`) === 'on']),
    ) as Record<Permission, boolean>;
    if (!canGrantOwner) delete (permissions as Partial<typeof permissions>).grant_owner;
    const payload = {
      name: String(form.get('name') || '').trim(),
      permissions,
    };
    try {
      if (editing?.id) {
        await request(`/api/roles/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await request('/api/roles', { method: 'POST', body: JSON.stringify(payload) });
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!confirm('Удалить роль?')) return;
    try {
      await request(`/api/roles/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function move(id: number, direction: -1 | 1) {
    const index = roles.findIndex((role) => role.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= roles.length) return;
    const next = [...roles];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setRoles(next);
    try {
      await request('/api/roles/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order: next.map((role) => role.id) }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
      await load();
    }
  }

  const visiblePermissions = PERMISSIONS.filter((key) => key !== 'grant_owner' || canGrantOwner);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">Чем выше роль в списке — тем она главнее</div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}>
          <NavIcon name="plus" /> Создать роль
        </button>
      </div>
      <ErrorText value={error} />
      {roles.map((role, index) => (
        <div className="roster-row" key={role.id}>
          <div className="who">
            <div>
              <div className="nickname">{role.name}</div>
              <div className="role-tag">
                вес {role.priority} · {role.usersCount} сотр. ·{' '}
                {PERMISSIONS.filter((key) => role.permissions?.[key]).length} доступов
              </div>
            </div>
          </div>
          <div className="row-actions">
            <button className="icon-btn" disabled={index === 0} title="Выше" onClick={() => void move(role.id, -1)}>↑</button>
            <button className="icon-btn" disabled={index === roles.length - 1} title="Ниже" onClick={() => void move(role.id, 1)}>↓</button>
            <button className="icon-btn" onClick={() => setEditing(role)}><NavIcon name="edit" /></button>
            <button className="icon-btn danger" onClick={() => void remove(role.id)}><NavIcon name="trash" /></button>
          </div>
        </div>
      ))}
      {!roles.length && <div className="empty-state"><h3>Ролей пока нет</h3></div>}

      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование роли' : 'Новая роль'} onClose={() => setEditing(undefined)} wide>
          <form onSubmit={save}>
            <ErrorText value={error} />
            <div className="field">
              <label>Название</label>
              <input className="input" name="name" required maxLength={80} defaultValue={editing?.name || ''} />
            </div>
            <div className="field">
              <label>Доступы</label>
              <div className="role-checklist">
                {visiblePermissions.map((key) => (
                  <label className="role-check-item" key={key}>
                    <input
                      type="checkbox"
                      name={`perm_${key}`}
                      defaultChecked={!!editing?.permissions?.[key]}
                    />
                    {PERMISSION_LABELS[key]}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(undefined)}>Отмена</button>
              <button className="btn btn-primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
