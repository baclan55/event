'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import {
  ACHIEVEMENT_TRIGGER_LABELS,
  ACHIEVEMENT_TRIGGERS,
  type AchievementTrigger,
} from '@/lib/achievementsShared';
import { ErrorText, Modal, request, type Row } from './shared';

export function AchievementsInteractive() {
  const [items, setItems] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [triggerType, setTriggerType] = useState<AchievementTrigger>('days_in_ranks');

  async function load() {
    const [ach, roster] = await Promise.all([
      request('/api/achievements'),
      request('/api/roster/roles').catch(() => ({ roles: [] })),
    ]);
    setItems(ach.achievements || []);
    setRoles(roster.roles || []);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    if (editing && editing.trigger_type) setTriggerType(editing.trigger_type);
    if (editing === null) setTriggerType('days_in_ranks');
  }, [editing]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const maxGrade = Math.max(1, Number(form.get('maxGrade') || 1));
    let triggerConfig: Record<string, unknown> = {};
    if (triggerType === 'days_in_ranks') {
      const grades = String(form.get('daysGrades') || '')
        .split(/[,\s]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      triggerConfig = { grades: grades.length ? grades : [30], days: grades[0] || 30 };
    } else if (triggerType === 'reached_role') {
      triggerConfig = { roleId: Number(form.get('roleId') || 0) };
    } else if (triggerType === 'weekly_top_1') {
      triggerConfig = { tier: String(form.get('tier') || 'helper') };
    }
    const payload = {
      name: String(form.get('name') || '').trim(),
      description: String(form.get('description') || '').trim(),
      icon: String(form.get('icon') || '').trim(),
      triggerType,
      triggerConfig,
      maxGrade,
      active: form.get('active') === 'on',
    };
    try {
      if (editing?.id) {
        await request(`/api/achievements/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await request('/api/achievements', { method: 'POST', body: JSON.stringify(payload) });
      }
      setEditing(undefined);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!confirm('Удалить достижение?')) return;
    try {
      await request(`/api/achievements/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const cfg = (editing?.trigger_config || {}) as Row;

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">{items.length} достижений</div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><NavIcon name="plus" /> Создать</button>
      </div>
      <ErrorText value={error} />
      {items.map((item) => (
        <div className="roster-row" key={item.id}>
          <div className="who">
            <div>
              <div className="nickname">{item.name}{!item.active ? ' · выкл.' : ''}</div>
              <div className="role-tag">
                {ACHIEVEMENT_TRIGGER_LABELS[item.trigger_type as AchievementTrigger] || item.trigger_type}
                {' · '}до {item.max_grade} ст.
              </div>
            </div>
          </div>
          <div className="row-actions">
            <button className="icon-btn" onClick={() => setEditing(item)}><NavIcon name="edit" /></button>
            <button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button>
          </div>
        </div>
      ))}
      {!items.length && <div className="empty-state"><h3>Достижений нет</h3></div>}

      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование достижения' : 'Новое достижение'} onClose={() => setEditing(undefined)} wide>
          <form onSubmit={save}>
            <ErrorText value={error} />
            <div className="field">
              <label>Название</label>
              <input className="input" name="name" required defaultValue={editing?.name || ''} />
            </div>
            <div className="field">
              <label>Описание</label>
              <textarea className="input" name="description" defaultValue={editing?.description || ''} />
            </div>
            <div className="form-row-2">
              <div className="field">
                <label>Триггер</label>
                <select className="input" value={triggerType} onChange={(e) => setTriggerType(e.target.value as AchievementTrigger)}>
                  {ACHIEVEMENT_TRIGGERS.map((key) => (
                    <option value={key} key={key}>{ACHIEVEMENT_TRIGGER_LABELS[key]}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Макс. степень</label>
                <input className="input" name="maxGrade" type="number" min={1} max={10} defaultValue={editing?.max_grade || 1} />
              </div>
            </div>
            {triggerType === 'days_in_ranks' ? (
              <div className="field">
                <label>Пороги дней по степеням</label>
                <input className="input" name="daysGrades" defaultValue={Array.isArray(cfg.grades) ? cfg.grades.join(', ') : String(cfg.days || '30, 90, 180')} placeholder="30, 90, 180" />
                <div className="field-hint">Через запятую: 1-я степень, 2-я и т.д.</div>
              </div>
            ) : null}
            {triggerType === 'reached_role' ? (
              <div className="field">
                <label>Роль</label>
                <select className="input" name="roleId" defaultValue={String(cfg.roleId || '')} required>
                  <option value="">Выберите роль</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </div>
            ) : null}
            {triggerType === 'weekly_top_1' ? (
              <div className="field">
                <label>Категория топа</label>
                <select className="input" name="tier" defaultValue={String(cfg.tier || 'helper')}>
                  <option value="helper">Хелперы</option>
                  <option value="admin">Администраторы</option>
                </select>
              </div>
            ) : null}
            <label className="qform-check-label">
              <input type="checkbox" name="active" defaultChecked={editing ? editing.active !== false : true} />
              Активно
            </label>
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
