'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import {
  emptyPermissions,
  GMP_CAP_LABELS,
  GMP_CAPS,
  normalizeGmpAccess,
  normalizeRolePermissions,
  PERMISSION_LABELS,
  PERMISSIONS,
  VIEW_ONLY_PERMISSIONS,
  type GmpCap,
  type GmpPermissionAccess,
  type Permission,
  type PermissionAccess,
} from '@/lib/roleAccess';
import {
  DASHBOARD_BLOCKS,
  DASHBOARD_BLOCK_LABELS,
  defaultDashboardBlocks,
  type DashboardBlock,
} from '@/lib/roleMeta';
import { askConfirm, ErrorText, Modal, request } from './shared';

type RoleRow = {
  id: number;
  name: string;
  priority: number;
  permissions: Record<Permission, PermissionAccess>;
  isEventHelper: boolean;
  isAdministrator: boolean;
  dashboardBlocks: Record<DashboardBlock, boolean>;
  usersCount: number;
};

function countAccess(permissions: Record<Permission, PermissionAccess> | undefined) {
  if (!permissions) return 0;
  return PERMISSIONS.filter((key) => permissions[key]?.view || permissions[key]?.edit).length;
}

export function RolesInteractive({
  canGrantOwner,
}: {
  canGrantOwner: boolean;
}) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [canEdit, setCanEdit] = useState(true);
  const [editing, setEditing] = useState<RoleRow | null | undefined>(undefined);
  const [draftPerms, setDraftPerms] = useState<Record<Permission, PermissionAccess>>(emptyPermissions());
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await request('/api/roles');
      setRoles((data.roles || []).map((role: RoleRow) => ({
        ...role,
        permissions: normalizeRolePermissions(role.permissions),
      })));
      setCanEdit(data.canEdit !== false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (editing === undefined) return;
    setDraftPerms(normalizeRolePermissions(editing?.permissions));
  }, [editing]);

  function setAccess(key: Permission, field: 'view' | 'edit', value: boolean) {
    setDraftPerms((prev) => {
      const next = { ...prev, [key]: { ...prev[key] } };
      if (field === 'edit') {
        next[key].edit = value && !VIEW_ONLY_PERMISSIONS.has(key);
        if (value) next[key].view = true;
      } else {
        next[key].view = value || next[key].edit;
        if (!value) next[key].edit = false;
      }
      return next;
    });
  }

  function setGmpCap(cap: GmpCap | 'view', value: boolean) {
    setDraftPerms((prev) => {
      const current = normalizeGmpAccess(prev.manage_gmp);
      const next: GmpPermissionAccess = { ...current };
      if (cap === 'view') {
        next.view = value;
        if (!value) {
          for (const key of GMP_CAPS) next[key] = false;
          next.edit = false;
        }
      } else {
        next[cap] = value;
        if (value) next.view = true;
        next.edit = GMP_CAPS.some((key) => key !== 'view_stats' && next[key]);
        next.view = next.view || GMP_CAPS.some((key) => next[key]);
      }
      return { ...prev, manage_gmp: next };
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    const form = new FormData(event.currentTarget);
    const permissions = { ...draftPerms };
    if (!canGrantOwner) permissions.grant_owner = { view: false, edit: false };
    const dashboardBlocks = Object.fromEntries(
      DASHBOARD_BLOCKS.map((key) => [key, form.get(`dash_${key}`) === 'on']),
    ) as Record<DashboardBlock, boolean>;
    const payload = {
      name: String(form.get('name') || '').trim(),
      permissions,
      isEventHelper: form.get('isEventHelper') === 'on',
      isAdministrator: form.get('isAdministrator') === 'on',
      dashboardBlocks,
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
    if (!canEdit) return;
    if (!(await askConfirm('Удалить роль?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try {
      await request(`/api/roles/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function move(id: number, direction: -1 | 1) {
    if (!canEdit) return;
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
  const draftBlocks = editing?.dashboardBlocks || defaultDashboardBlocks();

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">Чем выше роль в списке — тем она главнее</div>
        {canEdit ? (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}>
            <NavIcon name="plus" /> Создать роль
          </button>
        ) : null}
      </div>
      <ErrorText value={error} />
      {roles.map((role, index) => (
        <div className="roster-row" key={role.id}>
          <div className="who">
            <div>
              <div className="nickname">{role.name}</div>
              <div className="role-tag">
                вес {role.priority} · {role.usersCount} сотр. ·{' '}
                {countAccess(role.permissions)} доступов
                {role.isEventHelper ? ' · ивент хелпер' : ''}
                {role.isAdministrator ? ' · администратор' : ''}
              </div>
            </div>
          </div>
          <div className="row-actions">
            {canEdit ? (
              <>
                <button className="icon-btn" disabled={index === 0} title="Выше" onClick={() => void move(role.id, -1)}>↑</button>
                <button className="icon-btn" disabled={index === roles.length - 1} title="Ниже" onClick={() => void move(role.id, 1)}>↓</button>
                <button className="icon-btn" onClick={() => setEditing(role)}><NavIcon name="edit" /></button>
                <button className="icon-btn danger" onClick={() => void remove(role.id)}><NavIcon name="trash" /></button>
              </>
            ) : (
              <button className="icon-btn" onClick={() => setEditing(role)} title="Просмотр"><NavIcon name="edit" /></button>
            )}
          </div>
        </div>
      ))}
      {!roles.length && <div className="empty-state"><h3>Ролей пока нет</h3></div>}

      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование роли' : 'Новая роль'} onClose={() => setEditing(undefined)} xl>
          <form onSubmit={save}>
            <ErrorText value={error} />
            <div className="field">
              <label>Название</label>
              <input
                className="input"
                name="name"
                required
                maxLength={80}
                defaultValue={editing?.name || ''}
                disabled={!canEdit}
              />
            </div>
            <div className="form-row-2">
              <div className="field">
                <label>Классификация (не доступы)</label>
                <div className="role-checklist role-checklist-compact">
                  <label className="role-check-item">
                    <input type="checkbox" name="isEventHelper" defaultChecked={!!editing?.isEventHelper} disabled={!canEdit} />
                    Ивент хелпер
                  </label>
                  <label className="role-check-item">
                    <input type="checkbox" name="isAdministrator" defaultChecked={!!editing?.isAdministrator} disabled={!canEdit} />
                    Администратор
                  </label>
                </div>
                <div className="field-hint">Нужно для разного содержимого и обязательных полей профиля.</div>
              </div>
              <div className="field">
                <label>Блоки на главной</label>
                <div className="role-checklist role-checklist-compact">
                  {DASHBOARD_BLOCKS.map((key) => (
                    <label className="role-check-item" key={key}>
                      <input type="checkbox" name={`dash_${key}`} defaultChecked={!!draftBlocks[key]} disabled={!canEdit} />
                      {DASHBOARD_BLOCK_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <label>Доступы</label>
              <div className="perm-grid">
                {visiblePermissions.map((key) => {
                  if (key === 'manage_gmp') {
                    const gmp = normalizeGmpAccess(draftPerms.manage_gmp);
                    return (
                      <div className="perm-card perm-card-gmp" key={key}>
                        <div className="perm-card-title">{PERMISSION_LABELS[key]}</div>
                        <div className="perm-card-flags">
                          <label className="perm-flag">
                            <input
                              type="checkbox"
                              checked={!!gmp.view}
                              disabled={!canEdit}
                              onChange={(e) => setGmpCap('view', e.target.checked)}
                            />
                            Просмотр раздела
                          </label>
                          {GMP_CAPS.map((cap) => (
                            <label className="perm-flag" key={cap}>
                              <input
                                type="checkbox"
                                checked={!!gmp[cap]}
                                disabled={!canEdit}
                                onChange={(e) => setGmpCap(cap, e.target.checked)}
                              />
                              {GMP_CAP_LABELS[cap]}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  const access = draftPerms[key] || { view: false, edit: false };
                  const viewOnly = VIEW_ONLY_PERMISSIONS.has(key);
                  return (
                    <div className="perm-card" key={key}>
                      <div className="perm-card-title">{PERMISSION_LABELS[key]}</div>
                      <div className="perm-card-flags">
                        <label className="perm-flag">
                          <input
                            type="checkbox"
                            checked={!!access.view}
                            disabled={!canEdit}
                            onChange={(e) => setAccess(key, 'view', e.target.checked)}
                          />
                          Просмотр
                        </label>
                        {!viewOnly ? (
                          <label className="perm-flag">
                            <input
                              type="checkbox"
                              checked={!!access.edit}
                              disabled={!canEdit}
                              onChange={(e) => setAccess(key, 'edit', e.target.checked)}
                            />
                            Редактирование
                          </label>
                        ) : (
                          <span className="perm-flag muted">только просмотр</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(undefined)}>
                {canEdit ? 'Отмена' : 'Закрыть'}
              </button>
              {canEdit ? <button className="btn btn-primary">Сохранить</button> : null}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
