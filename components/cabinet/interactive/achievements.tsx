'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import {
  ACHIEVEMENT_TRIGGER_LABELS,
  ACHIEVEMENT_TRIGGERS,
  GMP_PERIOD_LABELS,
  GMP_PERIODS,
  type AchievementTrigger,
  type GmpPeriod,
} from '@/lib/achievementsShared';
import { askConfirm, ErrorText, matchesSearch, Modal, request, SearchBox, Select, type Row } from './shared';

function roleIdsFromConfig(cfg: Row, maxGrade: number): string[] {
  const fromArray = Array.isArray(cfg.roleIds) ? cfg.roleIds.map(String) : [];
  const legacy = cfg.roleId != null && cfg.roleId !== '' ? [String(cfg.roleId)] : [];
  const base = fromArray.length ? fromArray : legacy;
  return Array.from({ length: maxGrade }, (_, i) => base[i] || '');
}

function iconsFromRow(row: Row | null | undefined, maxGrade: number): string[] {
  const fromArray = Array.isArray(row?.grade_icons) ? row!.grade_icons.map(String) : [];
  const fallback = String(row?.icon || '');
  return Array.from({ length: maxGrade }, (_, i) => fromArray[i] || (i === 0 ? fallback : '') || '');
}

export function AchievementsInteractive() {
  const [items, setItems] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [triggerType, setTriggerType] = useState<AchievementTrigger>('days_in_ranks');
  const [maxGrade, setMaxGrade] = useState(1);
  const [gradeRoles, setGradeRoles] = useState<string[]>(['']);
  const [gradeIcons, setGradeIcons] = useState<string[]>(['']);
  const [tier, setTier] = useState('helper');
  const [gmpPeriod, setGmpPeriod] = useState<GmpPeriod>('week');
  const [uploading, setUploading] = useState<number | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => items.filter((item) => matchesSearch([
      item.name,
      item.description,
      item.trigger_type,
      ACHIEVEMENT_TRIGGER_LABELS[item.trigger_type as AchievementTrigger],
    ], query)),
    [items, query],
  );

  async function load() {
    const [ach, roster] = await Promise.all([
      request('/api/achievements'),
      request('/api/roster/roles').catch(() => ({ roles: [] })),
    ]);
    setItems(ach.achievements || []);
    setRoles(roster.roles || []);
    setCanEdit(ach.canEdit !== false);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    if (editing === undefined) return;
    const cfg = (editing?.trigger_config || {}) as Row;
    const nextTrigger = (editing?.trigger_type || 'days_in_ranks') as AchievementTrigger;
    const nextMax = Math.max(1, Number(editing?.max_grade) || 1);
    setTriggerType(nextTrigger);
    setMaxGrade(nextMax);
    setGradeRoles(roleIdsFromConfig(cfg, nextMax));
    setGradeIcons(iconsFromRow(editing, nextMax));
    setTier(String(cfg.tier || 'helper'));
    const period = String(cfg.period || 'week');
    setGmpPeriod((GMP_PERIODS as readonly string[]).includes(period) ? period as GmpPeriod : 'week');
  }, [editing]);

  function setMaxGradeSafe(value: number) {
    const next = Math.min(10, Math.max(1, value || 1));
    setMaxGrade(next);
    setGradeRoles((prev) => Array.from({ length: next }, (_, i) => prev[i] || ''));
    setGradeIcons((prev) => Array.from({ length: next }, (_, i) => prev[i] || ''));
  }

  async function uploadIcon(index: number, file: File | null) {
    if (!file) return;
    setUploading(index);
    setError('');
    try {
      const form = new FormData();
      form.append('image', file);
      const data = await request('/api/achievements/icon', { method: 'POST', body: form });
      setGradeIcons((prev) => {
        const next = [...prev];
        next[index] = data.url || `/media/${data.imageId}`;
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let triggerConfig: Record<string, unknown> = {};
    if (triggerType === 'days_in_ranks') {
      const grades = String(form.get('daysGrades') || '')
        .split(/[,\s]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      triggerConfig = { grades: grades.length ? grades : [30], days: grades[0] || 30 };
    } else if (triggerType === 'reached_role') {
      const roleIds = gradeRoles.map(Number).filter((id) => Number.isFinite(id) && id > 0);
      if (roleIds.length < maxGrade) {
        setError('Укажите роль для каждой степени.');
        return;
      }
      triggerConfig = { roleIds, roleId: roleIds[0] };
    } else if (triggerType === 'weekly_top_1') {
      triggerConfig = { tier };
    } else if (triggerType === 'gmp_total' || triggerType === 'gmp_period') {
      const grades = String(form.get('gmpGrades') || '')
        .split(/[,\s]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      triggerConfig = {
        grades: grades.length ? grades : [1],
        count: grades[0] || 1,
        ...(triggerType === 'gmp_period' ? { period: gmpPeriod } : {}),
      };
    }
    const icons = Array.from({ length: maxGrade }, (_, i) => gradeIcons[i] || '');
    const payload = {
      name: String(form.get('name') || '').trim(),
      description: String(form.get('description') || '').trim(),
      icon: icons[0] || '',
      gradeIcons: icons,
      triggerType,
      triggerConfig,
      maxGrade,
      active: form.get('active') === 'on',
      isHidden: form.get('isHidden') === 'on',
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
    if (!(await askConfirm('Удалить достижение?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try {
      await request(`/api/achievements/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const cfg = (editing?.trigger_config || {}) as Row;
  const roleOptions = roles.map((role) => ({ value: String(role.id), label: role.name }));

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{filtered.length}{query.trim() ? ` / ${items.length}` : ''} достижений</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Название, тип…" />
        </div>
        {canEdit ? (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><NavIcon name="plus" /> Создать</button>
        ) : null}
      </div>
      <ErrorText value={error} />
      {filtered.map((item) => {
        const preview = (Array.isArray(item.grade_icons) && item.grade_icons[0]) || item.icon;
        return (
          <div className="roster-row" key={item.id}>
            <div className="ach-icon-wrap">
              {preview ? <img src={preview} alt="" className="ach-icon" /> : <span className="ach-icon ach-icon-empty">★</span>}
            </div>
            <div className="who">
              <div>
                <div className="nickname">{item.name}{!item.active ? ' · выкл.' : ''}{item.is_hidden ? ' · скрытое' : ''}</div>
                <div className="role-tag">
                  {ACHIEVEMENT_TRIGGER_LABELS[item.trigger_type as AchievementTrigger] || item.trigger_type}
                  {' · '}до {item.max_grade} ст.
                </div>
              </div>
            </div>
            {canEdit ? (
              <div className="row-actions">
                <button className="icon-btn" onClick={() => setEditing(item)}><NavIcon name="edit" /></button>
                <button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button>
              </div>
            ) : null}
          </div>
        );
      })}
      {!filtered.length && <div className="empty-state"><h3>{query.trim() ? 'Ничего не найдено' : 'Достижений нет'}</h3></div>}

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
                <Select
                  value={triggerType}
                  onChange={(v) => setTriggerType(v as AchievementTrigger)}
                  options={ACHIEVEMENT_TRIGGERS.map((key) => ({
                    value: key,
                    label: ACHIEVEMENT_TRIGGER_LABELS[key],
                  }))}
                />
              </div>
              <div className="field">
                <label>Макс. степень</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={maxGrade}
                  onChange={(e) => setMaxGradeSafe(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="field">
              <label>Иконки по степеням</label>
              <div className="grade-role-list">
                {Array.from({ length: maxGrade }, (_, index) => (
                  <div className="grade-icon-row" key={index}>
                    <span className="grade-role-label">{index + 1}-я ст.</span>
                    <div className="ach-icon-wrap">
                      {gradeIcons[index]
                        ? <img src={gradeIcons[index]} alt="" className="ach-icon" />
                        : <span className="ach-icon ach-icon-empty">★</span>}
                    </div>
                    <input
                      className="input"
                      placeholder="URL или /media/…"
                      value={gradeIcons[index] || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setGradeIcons((prev) => {
                          const next = [...prev];
                          next[index] = value;
                          return next;
                        });
                      }}
                    />
                    <label className="btn btn-ghost btn-sm">
                      {uploading === index ? '…' : 'Прикрепить файл'}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={uploading != null}
                        onChange={(e) => void uploadIcon(index, e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="field-hint">Для каждой степени можно задать свою иконку (URL или загрузка файла).</div>
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
                <label>Роли по степеням</label>
                <div className="grade-role-list">
                  {Array.from({ length: maxGrade }, (_, index) => (
                    <div className="grade-role-row" key={index}>
                      <span className="grade-role-label">{index + 1}-я степень</span>
                      <Select
                        required
                        value={gradeRoles[index] || ''}
                        placeholder="Выберите роль"
                        onChange={(v) => {
                          setGradeRoles((prev) => {
                            const next = [...prev];
                            next[index] = v;
                            return next;
                          });
                        }}
                        options={roleOptions}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {triggerType === 'weekly_top_1' ? (
              <div className="field">
                <label>Категория топа</label>
                <Select
                  value={tier}
                  onChange={setTier}
                  options={[
                    { value: 'helper', label: 'Хелперы' },
                    { value: 'admin', label: 'Администраторы' },
                  ]}
                />
              </div>
            ) : null}
            {triggerType === 'gmp_period' ? (
              <div className="field">
                <label>Период</label>
                <Select
                  value={gmpPeriod}
                  onChange={(v) => setGmpPeriod(v as GmpPeriod)}
                  options={GMP_PERIODS.map((key) => ({
                    value: key,
                    label: GMP_PERIOD_LABELS[key],
                  }))}
                />
                <div className="field-hint">Считаются ГМП, где сотрудник в staff и дата начала попадает в период.</div>
              </div>
            ) : null}
            {triggerType === 'gmp_total' || triggerType === 'gmp_period' ? (
              <div className="field">
                <label>Пороги числа ГМП по степеням</label>
                <input
                  className="input"
                  name="gmpGrades"
                  defaultValue={Array.isArray(cfg.grades) ? cfg.grades.join(', ') : String(cfg.count || '1, 3, 5')}
                  placeholder="1, 3, 5"
                />
                <div className="field-hint">Через запятую: сколько участий в staff нужно для 1-й, 2-й степени и т.д.</div>
              </div>
            ) : null}
            <div className="form-row-2">
              <label className="qform-check-label">
                <input type="checkbox" name="active" defaultChecked={editing ? editing.active !== false : true} />
                Активно
              </label>
              <label className="qform-check-label">
                <input type="checkbox" name="isHidden" defaultChecked={!!editing?.is_hidden} />
                Скрытое
              </label>
            </div>
            <div className="field-hint">Скрытое: в «Не полученных» внизу списка, в «Полученных» — сверху; описание видят только получившие.</div>
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
