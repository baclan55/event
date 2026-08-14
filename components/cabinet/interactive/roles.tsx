'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import {
  emptyPermissions,
  EVENT_CAP_LABELS,
  EVENT_CAPS,
  GMP_CAP_LABELS,
  GMP_CAPS,
  normalizeEventsAccess,
  normalizeGmpAccess,
  normalizeProfileViewAccess,
  normalizeRolePermissions,
  PERMISSION_LABELS,
  PERMISSIONS,
  PROFILE_VIEW_CAP_LABELS,
  PROFILE_VIEW_CAPS,
  VIEW_ONLY_PERMISSIONS,
  type EventCap,
  type EventsPermissionAccess,
  type GmpCap,
  type GmpPermissionAccess,
  type Permission,
  type PermissionAccess,
  type ProfileViewAccess,
  type ProfileViewCap,
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
  includeInHelperPayouts: boolean;
  color: string;
  dashboardBlocks: Record<DashboardBlock, boolean>;
  weeklyEventsTarget: number | null;
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

  function setEventsCap(cap: EventCap | 'view', value: boolean) {
    setDraftPerms((prev) => {
      const current = normalizeEventsAccess(prev.manage_events);
      const next: EventsPermissionAccess = { ...current };
      if (cap === 'view') {
        next.view = value;
        if (!value) {
          for (const key of EVENT_CAPS) next[key] = false;
          next.edit = false;
        }
      } else {
        next[cap] = value;
        if (value) next.view = true;
        next.edit = EVENT_CAPS.some((key) => next[key]);
        next.view = next.view || EVENT_CAPS.some((key) => next[key]);
      }
      return { ...prev, manage_events: next };
    });
  }

  function setProfileViewCap(cap: ProfileViewCap | 'view', value: boolean) {
    setDraftPerms((prev) => {
      const current = normalizeProfileViewAccess(prev.view_profile);
      const next: ProfileViewAccess = { ...current, edit: false };
      if (cap === 'view') {
        next.view = value;
        if (!value) {
          for (const key of PROFILE_VIEW_CAPS) next[key] = false;
        }
      } else {
        next[cap] = value;
        if (value) next.view = true;
        next.view = next.view || PROFILE_VIEW_CAPS.some((key) => next[key]);
      }
      return { ...prev, view_profile: next };
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
    const targetRaw = String(form.get('weeklyEventsTarget') || '').trim();
    const weeklyEventsTarget = targetRaw === '' ? null : Number.parseInt(targetRaw, 10);
    const payload = {
      name: String(form.get('name') || '').trim(),
      permissions,
      isEventHelper: form.get('isEventHelper') === 'on',
      isAdministrator: form.get('isAdministrator') === 'on',
      includeInHelperPayouts: form.get('includeInHelperPayouts') === 'on',
      color: String(form.get('colorHex') || '').trim(),
      dashboardBlocks,
      weeklyEventsTarget: Number.isFinite(weeklyEventsTarget as number) ? weeklyEventsTarget : null,
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
              <div className="nickname" style={role.color ? { color: role.color } : undefined}>{role.name}</div>
              <div className="role-tag">
                вес {role.priority} · {role.usersCount} сотр. ·{' '}
                {countAccess(role.permissions)} доступов
                {role.weeklyEventsTarget != null ? ` · норма ${role.weeklyEventsTarget} МП/нед.` : ' · без нормы МП'}
                {role.isEventHelper ? ' · ивент хелпер' : ''}
                {role.isAdministrator ? ' · администратор' : ''}
                {role.includeInHelperPayouts ? ' · выплаты' : ''}
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
            <div className="field">
              <label>Норма МП за неделю</label>
              <input
                className="input"
                name="weeklyEventsTarget"
                type="number"
                min={0}
                max={999}
                placeholder="пусто = нормы нет"
                defaultValue={editing?.weeklyEventsTarget ?? ''}
                disabled={!canEdit}
              />
              <div className="field-hint">
                Календарная неделя: с понедельника 00:00 по воскресенье 23:59 (часовой пояс сервера WEEKLY_RESET_TZ).
                Оставьте пустым, если для роли норма не нужна.
              </div>
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
                  <label className="role-check-item">
                    <input type="checkbox" name="includeInHelperPayouts" defaultChecked={!!editing?.includeInHelperPayouts} disabled={!canEdit} />
                    Учёт в выплатах хелперов
                  </label>
                </div>
                <div className="field-hint">«Выплаты» — сотрудники с этой ролью попадают в недельную ведомость.</div>
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
              <label>Цвет роли</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  className="input"
                  type="color"
                  name="color"
                  defaultValue={editing?.color || '#a8b0c2'}
                  disabled={!canEdit}
                  style={{ width: 52, padding: 4, minHeight: 42 }}
                />
                <input
                  className="input"
                  name="colorHex"
                  defaultValue={editing?.color || ''}
                  placeholder="#a8b0c2 или пусто"
                  disabled={!canEdit}
                  onChange={(e) => {
                    const form = e.currentTarget.form;
                    const picker = form?.elements.namedItem('color') as HTMLInputElement | null;
                    const v = e.target.value.trim();
                    if (picker && /^#?[0-9a-fA-F]{6}$/.test(v)) {
                      picker.value = v.startsWith('#') ? v : `#${v}`;
                    }
                  }}
                />
              </div>
              <div className="field-hint">Название роли будет этим цветом в составе, выплатах и профиле. Пустой hex — без цвета.</div>
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
                  if (key === 'manage_events') {
                    const events = normalizeEventsAccess(draftPerms.manage_events);
                    return (
                      <div className="perm-card perm-card-gmp" key={key}>
                        <div className="perm-card-title">{PERMISSION_LABELS[key]}</div>
                        <div className="perm-card-flags">
                          <label className="perm-flag">
                            <input
                              type="checkbox"
                              checked={!!events.view}
                              disabled={!canEdit}
                              onChange={(e) => setEventsCap('view', e.target.checked)}
                            />
                            Просмотр мероприятий
                          </label>
                          {EVENT_CAPS.map((cap) => (
                            <label className="perm-flag" key={cap}>
                              <input
                                type="checkbox"
                                checked={!!events[cap]}
                                disabled={!canEdit}
                                onChange={(e) => setEventsCap(cap, e.target.checked)}
                              />
                              {EVENT_CAP_LABELS[cap]}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (key === 'view_profile') {
                    const profile = normalizeProfileViewAccess(draftPerms.view_profile);
                    return (
                      <div className="perm-card perm-card-gmp" key={key}>
                        <div className="perm-card-title">{PERMISSION_LABELS[key]}</div>
                        <div className="perm-card-flags">
                          <label className="perm-flag">
                            <input
                              type="checkbox"
                              checked={!!profile.view}
                              disabled={!canEdit}
                              onChange={(e) => setProfileViewCap('view', e.target.checked)}
                            />
                            Просмотр чужого профиля
                          </label>
                          {PROFILE_VIEW_CAPS.map((cap) => (
                            <label className="perm-flag" key={cap}>
                              <input
                                type="checkbox"
                                checked={!!profile[cap]}
                                disabled={!canEdit}
                                onChange={(e) => setProfileViewCap(cap, e.target.checked)}
                              />
                              {PROFILE_VIEW_CAP_LABELS[cap]}
                            </label>
                          ))}
                        </div>
                        <div className="field-hint" style={{ marginTop: 8 }}>
                          Отдельные вкладки в профиле другого сотрудника. Свой профиль всегда доступен полностью.
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
