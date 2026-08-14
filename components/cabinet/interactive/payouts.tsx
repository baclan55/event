'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, ErrorText, Modal, request, SearchBox, Select, matchesSearch, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  pending_events: 'Есть незаконченные мероприятия',
  ready: 'Готово',
  locked: 'Заблокировано',
};

function money(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Tint строки по названию helper-роли (как в Google-таблице). */
function payoutRoleTintClass(roleName: unknown): string {
  const name = String(roleName || '').toLowerCase();
  if (name.includes('chief') && name.includes('helper') && !name.includes('dep')) return 'payout-tint-chief';
  if (name.includes('dep') && name.includes('helper')) return 'payout-tint-dep';
  if (name.includes('senior')) return 'payout-tint-senior';
  if (name.includes('mini')) return 'payout-tint-mini';
  if (name.includes('helper')) return 'payout-tint-helper';
  return 'payout-tint-default';
}

function formatWeek(weekStart: string) {
  try {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')}`;
  } catch {
    return weekStart;
  }
}

export function PayoutsListInteractive() {
  const [weeks, setWeeks] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await request('/api/payouts');
    setWeeks(data.weeks || []);
    setCanEdit(!!data.canEdit);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [load]);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/payouts/generate', { method: 'POST', body: '{}' });
      await load();
      if (data.weekId) window.location.href = `/app/payouts/${data.weekId}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">{weeks.length} недель</div>
        <div className="row-actions">
          <Link className="btn btn-ghost btn-sm" href="/app/payouts/settings">Ставки ролей</Link>
          {canEdit ? (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void generate()}>
              <NavIcon name="plus" /> Сформировать прошлую неделю
            </button>
          ) : null}
        </div>
      </div>
      <ErrorText value={error} />
      {weeks.map((w) => (
        <div className="roster-row" key={w.id}>
          <div className="who">
            <div>
              <div className="nickname">
                <Link href={`/app/payouts/${w.id}`}>{formatWeek(String(w.week_start).slice(0, 10))}</Link>
              </div>
              <div className="role-tag">
                {STATUS_LABEL[String(w.status)] || w.status}
                {' · '}
                {w.row_count || 0} строк
              </div>
            </div>
          </div>
          <div className="row-actions">
            <Link className="btn btn-ghost btn-sm" href={`/app/payouts/${w.id}`}>Открыть</Link>
            <Link className="btn btn-ghost btn-sm" href={`/app/payouts/${w.id}/log`}>Лог</Link>
          </div>
        </div>
      ))}
      {!weeks.length && (
        <div className="empty-state">
          <h3>Выплат пока нет</h3>
          <p>Сформируйте прошлую неделю вручную или дождитесь понедельника 00:01.</p>
        </div>
      )}
    </>
  );
}

export function PayoutSettingsInteractive() {
  const [roles, setRoles] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await request('/api/payouts/settings');
    setRoles(data.roles || []);
    setCanEdit(!!data.canEdit);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [load]);

  function patch(id: number, field: string, value: string) {
    setRoles((prev) => prev.map((r) => (Number(r.id) === id ? { ...r, [field]: value } : r)));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await request('/api/payouts/settings', {
        method: 'PUT',
        body: JSON.stringify({
          roles: roles.map((r) => ({
            roleId: Number(r.id),
            mp_rate_mc: money(r.mp_rate_mc),
            mp_rate_dollars: money(r.mp_rate_dollars),
            gmp_rate_mc: money(r.gmp_rate_mc),
            gmp_rate_dollars: money(r.gmp_rate_dollars),
            min_mp: money(r.min_mp),
            fixed_mc: money(r.fixed_mc),
            fixed_dollars: money(r.fixed_dollars),
            verbal_penalty_pct: money(r.verbal_penalty_pct),
            strict_penalty_pct: money(r.strict_penalty_pct),
          })),
        }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <Link className="btn btn-ghost btn-sm" href="/app/payouts">← К выплатам</Link>
        </div>
        {canEdit ? (
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
            Сохранить ставки
          </button>
        ) : null}
      </div>
      <ErrorText value={error} />
      <div className="payout-table-wrap">
        <table className="payout-table">
          <thead>
            <tr>
              <th>Роль</th>
              <th>МП MC</th>
              <th>МП $</th>
              <th>ГМП MC</th>
              <th>ГМП $</th>
              <th>Мин. МП</th>
              <th>Фикс MC</th>
              <th>Фикс $</th>
              <th>Устный %</th>
              <th>Строгий %</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td className="payout-role">{r.name}</td>
                {([
                  'mp_rate_mc',
                  'mp_rate_dollars',
                  'gmp_rate_mc',
                  'gmp_rate_dollars',
                  'min_mp',
                  'fixed_mc',
                  'fixed_dollars',
                  'verbal_penalty_pct',
                  'strict_penalty_pct',
                ] as const).map((field) => (
                  <td key={field}>
                    <input
                      className="input payout-cell"
                      type="number"
                      step="any"
                      disabled={!canEdit}
                      value={String(r[field] ?? 0)}
                      onChange={(e) => patch(Number(r.id), field, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type Rep = Row & { reprimand_id?: number; counted?: boolean; type?: string; reason?: string };

export function PayoutWeekInteractive({ weekId }: { weekId: number }) {
  const [week, setWeek] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [exportText, setExportText] = useState<{ mc: string; dollars: string; compensation: string; all: string } | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [members, setMembers] = useState<Row[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [showExport, setShowExport] = useState(false);

  const load = useCallback(async () => {
    const data = await request(`/api/payouts/${weekId}`);
    setWeek(data.week || null);
    setRows(data.rows || []);
    setCanEdit(!!data.canEdit);
    setExportText(data.export || null);
  }, [weekId]);

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => matchesSearch([
      r.nickname, r.role_name, r.static_id, r.bonus_note,
    ], query)),
    [rows, query],
  );

  const locked = String(week?.status) === 'locked';

  async function patchRow(rowId: number, patch: Record<string, unknown>) {
    if (!canEdit || locked) return;
    setError('');
    try {
      await request(`/api/payouts/${weekId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update_row', rowId, ...patch }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleRep(rowId: number, reprimandId: number, counted: boolean) {
    if (!canEdit || locked) return;
    try {
      await request(`/api/payouts/${weekId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'toggle_reprimand', rowId, reprimandId, counted }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rebuild(force: boolean) {
    if (!(await askConfirm(force
      ? 'Полностью пересобрать автополя (включая вручную правленые события)?'
      : 'Пересобрать автополя (ручные правки events сохранятся)?', {
      title: 'Пересборка',
      confirmLabel: 'Пересобрать',
    }))) return;
    try {
      await request(`/api/payouts/${weekId}/rebuild`, {
        method: 'POST',
        body: JSON.stringify({ force }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function lock(lock: boolean) {
    try {
      await request(`/api/payouts/${weekId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: lock ? 'lock' : 'unlock' }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openAdd() {
    setAdding(true);
    try {
      const data = await request(`/api/payouts/members?weekId=${weekId}`);
      setMembers(data.members || []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addUser() {
    if (!addUserId) return;
    try {
      await request(`/api/payouts/${weekId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'add_user', userId: Number(addUserId) }),
      });
      setAdding(false);
      setAddUserId('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError('Не удалось скопировать');
    }
  }

  function download(text: string, name: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost btn-sm" href="/app/payouts">← К списку</Link>
          <SearchBox value={query} onChange={setQuery} placeholder="Ник, роль, Static…" />
        </div>
        <div className="row-actions">
          <Link className="btn btn-ghost btn-sm" href={`/app/payouts/${weekId}/log`}>Лог</Link>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExport(true)}>Команды</button>
          {canEdit && !locked ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => void openAdd()}>Добавить</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void rebuild(false)}>Пересобрать</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void lock(true)}>Заблокировать</button>
            </>
          ) : null}
          {canEdit && locked ? (
            <button className="btn btn-ghost btn-sm" onClick={() => void lock(false)}>Разблокировать</button>
          ) : null}
        </div>
      </div>

      {week?.status === 'pending_events' ? (
        <div className="gmp-closed-note" style={{ marginBottom: 14 }}>
          Есть незаконченные мероприятия — дождитесь их закрытия или пересоберите неделю.
        </div>
      ) : null}

      <ErrorText value={error} />

      <div className="payout-table-wrap">
        <table className="payout-table payout-table-wide">
          <thead>
            <tr>
              <th rowSpan={2}>Вкл</th>
              <th rowSpan={2}>Роль</th>
              <th rowSpan={2}>Ник</th>
              <th rowSpan={2}>Static</th>
              <th rowSpan={2}>МП</th>
              <th rowSpan={2}>ГМП</th>
              <th colSpan={2} className="payout-h-rep">Выговоры</th>
              <th colSpan={2} className="payout-h-events">За мероприятия</th>
              <th colSpan={3} className="payout-h-bonus">Доп. бонусы</th>
              <th colSpan={2} className="payout-h-comp">Компенсация</th>
            </tr>
            <tr>
              <th className="payout-h-rep">Устные</th>
              <th className="payout-h-rep">Строгие</th>
              <th className="payout-h-events">MC</th>
              <th className="payout-h-events">$</th>
              <th className="payout-h-bonus">MC</th>
              <th className="payout-h-bonus">$</th>
              <th className="payout-h-bonus">Заметка</th>
              <th className="payout-h-comp">Static</th>
              <th className="payout-h-comp">$</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const reps = (row.reprimands || []) as Rep[];
              const verbal = reps.filter((r) => r.type === 'verbal');
              const strict = reps.filter((r) => r.type === 'strict');
              const tint = payoutRoleTintClass(row.role_name);
              const rowClass = [tint, !row.include_in_payout ? 'payout-row-off' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <tr key={row.id} className={rowClass}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!row.include_in_payout}
                      disabled={!canEdit || locked}
                      onChange={(e) => void patchRow(Number(row.id), { include_in_payout: e.target.checked })}
                    />
                  </td>
                  <td className="payout-role">{row.role_name || '—'}</td>
                  <td>{row.nickname}</td>
                  <td>
                    <input
                      className="input payout-cell"
                      disabled={!canEdit || locked}
                      value={String(row.static_id || '')}
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, static_id: e.target.value } : r)))}
                      onBlur={(e) => void patchRow(Number(row.id), { static_id: e.target.value })}
                    />
                  </td>
                  <td className="payout-num">{row.mp_count}</td>
                  <td className="payout-num">{row.gmp_count}</td>
                  <td className="payout-reps">
                    {verbal.length ? verbal.map((r) => (
                      <label key={String(r.reprimand_id)} className="payout-rep-toggle" title={String(r.reason || '')}>
                        <input
                          type="checkbox"
                          checked={!!r.counted}
                          disabled={!canEdit || locked}
                          onChange={(e) => void toggleRep(Number(row.id), Number(r.reprimand_id), e.target.checked)}
                        />
                        уст.
                      </label>
                    )) : <span className="payout-muted">0</span>}
                  </td>
                  <td className="payout-reps">
                    {strict.length ? strict.map((r) => (
                      <label key={String(r.reprimand_id)} className="payout-rep-toggle" title={String(r.reason || '')}>
                        <input
                          type="checkbox"
                          checked={!!r.counted}
                          disabled={!canEdit || locked}
                          onChange={(e) => void toggleRep(Number(row.id), Number(r.reprimand_id), e.target.checked)}
                        />
                        стр.
                      </label>
                    )) : <span className="payout-muted">0</span>}
                  </td>
                  {([
                    ['events_mc', row.events_mc],
                    ['events_dollars', row.events_dollars],
                    ['bonus_mc', row.bonus_mc],
                    ['bonus_dollars', row.bonus_dollars],
                  ] as const).map(([field, val]) => (
                    <td key={field}>
                      <input
                        className="input payout-cell"
                        type="number"
                        step="any"
                        disabled={!canEdit || locked}
                        value={String(val ?? 0)}
                        onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: e.target.value } : r)))}
                        onBlur={(e) => void patchRow(Number(row.id), { [field]: money(e.target.value) })}
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      className="input payout-cell payout-cell-note"
                      disabled={!canEdit || locked}
                      value={String(row.bonus_note || '')}
                      placeholder="Комментарий"
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, bonus_note: e.target.value } : r)))}
                      onBlur={(e) => void patchRow(Number(row.id), { bonus_note: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input payout-cell"
                      disabled={!canEdit || locked}
                      value={String(row.comp_static_id || '')}
                      placeholder={String(row.static_id || '')}
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, comp_static_id: e.target.value } : r)))}
                      onBlur={(e) => void patchRow(Number(row.id), { comp_static_id: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input payout-cell"
                      type="number"
                      step="any"
                      disabled={!canEdit || locked}
                      value={String(row.comp_dollars ?? 0)}
                      onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, comp_dollars: e.target.value } : r)))}
                      onBlur={(e) => void patchRow(Number(row.id), { comp_dollars: money(e.target.value) })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!filtered.length && <div className="empty-state"><h3>{query.trim() ? 'Никого не найдено' : 'Строк нет'}</h3></div>}

      {adding && (
        <Modal title="Добавить в выплату" onClose={() => setAdding(false)}>
          <div className="field">
            <label>Сотрудник</label>
            <Select
              value={addUserId}
              onChange={setAddUserId}
              placeholder="Выберите"
              options={members.map((m) => ({
                value: String(m.id),
                label: `${m.nickname} · ${m.role_name || '—'} · ${m.static_id || 'без Static'}`,
              }))}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Отмена</button>
            <button className="btn btn-primary" disabled={!addUserId} onClick={() => void addUser()}>Добавить</button>
          </div>
        </Modal>
      )}

      {showExport && exportText && (
        <Modal title="Команды выдачи" onClose={() => setShowExport(false)} editor>
          <div className="field">
            <label>MC (/givedonate … eventhelper)</label>
            <textarea className="input" rows={6} readOnly value={exportText.mc} />
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(exportText.mc)}>Копировать</button>
              <button className="btn btn-ghost btn-sm" onClick={() => download(exportText.mc, `payout-${weekId}-mc.txt`)}>Скачать</button>
            </div>
          </div>
          <div className="field">
            <label>Доллары (/givemoney … eventhelper)</label>
            <textarea className="input" rows={6} readOnly value={exportText.dollars} />
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(exportText.dollars)}>Копировать</button>
              <button className="btn btn-ghost btn-sm" onClick={() => download(exportText.dollars, `payout-${weekId}-money.txt`)}>Скачать</button>
            </div>
          </div>
          <div className="field">
            <label>Компенсация (/givemoney … compenseh)</label>
            <textarea className="input" rows={4} readOnly value={exportText.compensation} />
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(exportText.compensation)}>Копировать</button>
              <button className="btn btn-ghost btn-sm" onClick={() => download(exportText.compensation, `payout-${weekId}-comp.txt`)}>Скачать</button>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={() => void copy(exportText.all)}>Копировать всё</button>
            <button className="btn btn-ghost" onClick={() => setShowExport(false)}>Закрыть</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PayoutLogInteractive({ weekId }: { weekId: number }) {
  const [log, setLog] = useState<Row[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void request(`/api/payouts/${weekId}/log`)
      .then((data) => setLog(data.log || []))
      .catch((err) => setError((err as Error).message));
  }, [weekId]);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <Link className="btn btn-ghost btn-sm" href={`/app/payouts/${weekId}`}>← К таблице</Link>
        </div>
      </div>
      <ErrorText value={error} />
      {log.map((entry) => (
        <div className="roster-row" key={entry.id}>
          <div className="who">
            <div>
              <div className="nickname">{entry.action}</div>
              <div className="role-tag">
                {new Date(String(entry.created_at)).toLocaleString('ru-RU')}
                {' · '}
                {entry.actor_nickname || 'система'}
              </div>
              <div className="field-hint" style={{ marginTop: 4 }}>
                {JSON.stringify(entry.details || {})}
              </div>
            </div>
          </div>
        </div>
      ))}
      {!log.length && <div className="empty-state"><h3>Лог пуст</h3></div>}
    </>
  );
}
