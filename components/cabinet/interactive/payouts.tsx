'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { describeLogEntry } from '@/lib/auditShared';
import { buildExportCommands, type PayoutExportResult } from '@/lib/payoutExport';
import { askConfirm, ErrorText, Modal, request, SearchBox, Select, matchesSearch, RoleName, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  pending_events: 'Есть незаконченные мероприятия',
  ready: 'Готово',
  locked: 'Заблокировано',
};

function money(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function moneyText(v: unknown) {
  return String(money(v));
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
                        step={1}
                        disabled={!canEdit}
                        value={moneyText(r[field])}
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
  const [exportText, setExportText] = useState<PayoutExportResult | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [members, setMembers] = useState<Row[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await request(`/api/payouts/${weekId}`);
    setWeek(data.week || null);
    setRows(data.rows || []);
    setCanEdit(!!data.canEdit);
    setExportText(data.export || null);
  }, [weekId]);

  function openExport() {
    const built = buildExportCommands(
      rows.map((r) => ({
        include_in_payout: !!r.include_in_payout,
        static_id: String(r.static_id || ''),
        nickname: String(r.nickname || ''),
        events_mc: money(r.events_mc),
        events_dollars: money(r.events_dollars),
        fixed_mc: money(r.fixed_mc),
        fixed_dollars: money(r.fixed_dollars),
        bonus_mc: money(r.bonus_mc),
        bonus_dollars: money(r.bonus_dollars),
        comp_static_id: String(r.comp_static_id || ''),
        comp_dollars: money(r.comp_dollars),
      })),
    );
    setExportText(built);
    setShowExport(true);
  }

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

  async function toggleRepType(rowId: number, kind: 'verbal' | 'strict', counted: boolean) {
    if (!canEdit || locked) return;
    setError('');
    const flag = kind === 'verbal' ? 'count_verbal' : 'count_strict';
    setRows((prev) => prev.map((r) => {
      if (Number(r.id) !== rowId) return r;
      const reps = ((r.reprimands || []) as Rep[]).map((rep) => (
        rep.type === kind ? { ...rep, counted } : rep
      ));
      return { ...r, [flag]: counted, reprimands: reps };
    }));
    try {
      const data = await request(`/api/payouts/${weekId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'toggle_reprimand_type', rowId, kind, counted }),
      });
      const updated = data.row as Row | undefined;
      if (updated) {
        setRows((prev) => prev.map((r) => (
          Number(r.id) === rowId
            ? {
              ...r,
              count_verbal: updated.count_verbal ?? r.count_verbal,
              count_strict: updated.count_strict ?? r.count_strict,
              events_mc: updated.events_mc ?? r.events_mc,
              events_dollars: updated.events_dollars ?? r.events_dollars,
              fixed_mc: updated.fixed_mc ?? r.fixed_mc,
              fixed_dollars: updated.fixed_dollars ?? r.fixed_dollars,
            }
            : r
        )));
      } else {
        await load();
      }
    } catch (err) {
      setError((err as Error).message);
      await load().catch(() => undefined);
    }
  }

  async function openDetail(row: Row) {
    setDetailRow(row);
    setDetail(null);
    setDetailLoading(true);
    setError('');
    try {
      const data = await request(`/api/payouts/${weekId}/breakdown?rowId=${row.id}`);
      setDetail(data);
    } catch (err) {
      setError((err as Error).message);
      setDetailRow(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function rebuild(force: boolean) {
    if (!(await askConfirm(force
      ? 'Полный сброс: пересчитать всё, включая вручную изменённые суммы «за мероприятия» и МП/ГМП?'
      : 'Пересобрать автополя? Ручные правки сумм «за мероприятия» и МП/ГМП сохранятся.', {
      title: 'Пересборка',
      confirmLabel: force ? 'Сбросить и пересчитать' : 'Пересобрать',
      danger: force,
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
          <button className="btn btn-ghost btn-sm" onClick={() => openExport()}>Команды</button>
          {canEdit && !locked ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => void openAdd()}>Добавить</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void rebuild(false)}>Пересобрать</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void rebuild(true)}>Сбросить правки</button>
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
      <div className="rp-legend" style={{ marginBottom: 12 }}>
        Галочки выговоров сразу пересчитывают «За мероприятия»: устный −50% за каждый, строгий −100% за каждый (фикс не режется).
      </div>

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
              <th colSpan={2} className="payout-h-fixed">Фикс</th>
              <th colSpan={2} className="payout-h-events">За мероприятия</th>
              <th colSpan={3} className="payout-h-bonus">Доп. бонусы</th>
              <th colSpan={2} className="payout-h-comp">Компенсация</th>
            </tr>
            <tr>
              <th className="payout-h-rep">Устные</th>
              <th className="payout-h-rep">Строгие</th>
              <th className="payout-h-fixed">MC</th>
              <th className="payout-h-fixed">$</th>
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
                  <td className="payout-role">
                    <RoleName name={row.role_name} color={row.role_color} />
                  </td>
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
                  <td className="payout-num">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <input
                        className="input"
                        style={{ width: 46, padding: '4px 6px', textAlign: 'center' }}
                        type="number"
                        step={1}
                        min={0}
                        disabled={!canEdit || locked}
                        title={row.mp_count_override ? 'МП изменено вручную' : 'МП (авто по мероприятиям)'}
                        value={String(row.mp_count ?? 0)}
                        onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, mp_count: e.target.value } : r)))}
                        onBlur={(e) => void patchRow(Number(row.id), { mp_count: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm payout-count-btn"
                        title="Разбор расчёта"
                        onClick={() => void openDetail(row)}
                      >
                        <NavIcon name="history" />
                      </button>
                    </div>
                    {row.mp_count_override ? (
                      <div className="field-hint" style={{ textAlign: 'center', marginTop: 2 }}>вручную</div>
                    ) : null}
                  </td>
                  <td className="payout-num">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <input
                        className="input"
                        style={{ width: 46, padding: '4px 6px', textAlign: 'center' }}
                        type="number"
                        step={1}
                        min={0}
                        disabled={!canEdit || locked}
                        title={row.gmp_count_override ? 'ГМП изменено вручную' : 'ГМП (авто по мероприятиям)'}
                        value={String(row.gmp_count ?? 0)}
                        onChange={(e) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, gmp_count: e.target.value } : r)))}
                        onBlur={(e) => void patchRow(Number(row.id), { gmp_count: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm payout-count-btn"
                        title="Разбор расчёта"
                        onClick={() => void openDetail(row)}
                      >
                        <NavIcon name="history" />
                      </button>
                    </div>
                    {row.gmp_count_override ? (
                      <div className="field-hint" style={{ textAlign: 'center', marginTop: 2 }}>вручную</div>
                    ) : null}
                  </td>
                  <td className="payout-reps">
                    <label className="payout-rep-toggle" title="Устный: −50% к сумме за мероприятия за каждый учтённый">
                      <input
                        type="checkbox"
                        checked={row.count_verbal !== false}
                        disabled={!canEdit || locked || verbal.length === 0}
                        onChange={(e) => void toggleRepType(Number(row.id), 'verbal', e.target.checked)}
                      />
                      уст. {verbal.length}
                    </label>
                  </td>
                  <td className="payout-reps">
                    <label className="payout-rep-toggle" title="Строгий: −100% к сумме за мероприятия за каждый учтённый">
                      <input
                        type="checkbox"
                        checked={row.count_strict !== false}
                        disabled={!canEdit || locked || strict.length === 0}
                        onChange={(e) => void toggleRepType(Number(row.id), 'strict', e.target.checked)}
                      />
                      стр. {strict.length}
                    </label>
                  </td>
                  <td className="payout-num payout-fixed">{moneyText(row.fixed_mc)}</td>
                  <td className="payout-num payout-fixed">{moneyText(row.fixed_dollars)}</td>
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
                        step={1}
                        disabled={!canEdit || locked}
                        value={moneyText(val)}
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
                      step={1}
                      disabled={!canEdit || locked}
                      value={moneyText(row.comp_dollars)}
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
          {exportText.skipped?.length ? (
            <div className="gmp-closed-note" style={{ marginBottom: 14 }}>
              Без Static ID команды не собраны ({exportText.skipped.length}):
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {exportText.skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              Заполните Static в таблице и откройте «Команды» снова.
            </div>
          ) : null}
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Команд MC: {exportText.counts?.mc ?? 0}
            {' · '}
            долларов: {exportText.counts?.dollars ?? 0}
            {' · '}
            компенсация: {exportText.counts?.compensation ?? 0}
          </div>
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

      {detailRow && (
        <Modal
          title={`Расчёт · ${detailRow.nickname}`}
          onClose={() => { setDetailRow(null); setDetail(null); }}
          xl
        >
          {detailLoading || !detail ? (
            <div className="empty-state"><h3>Загрузка…</h3></div>
          ) : (
            <PayoutBreakdownView detail={detail} />
          )}
          <div className="modal-actions">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => { setDetailRow(null); setDetail(null); }}
            >
              Закрыть
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

type BreakdownEvent = {
  kind?: string;
  at?: string;
  title?: string;
  roleName?: string;
  roleColor?: string;
  rateMc?: number;
  rateDollars?: number;
  staffRole?: string;
};

type BreakdownByRole = {
  roleName?: string;
  roleColor?: string;
  mp?: number;
  gmp?: number;
  mc?: number;
  dollars?: number;
};

function formatEventAt(at: unknown) {
  const raw = String(at || '');
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw || '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PayoutBreakdownView({ detail }: { detail: Row }) {
  const row = (detail.row || {}) as Row;
  const totals = (detail.computedTotals || {}) as Row;
  const bd = (detail.breakdown || {}) as Row;
  const events = (Array.isArray(bd.events) ? bd.events : []) as BreakdownEvent[];
  const byRole = (Array.isArray(bd.byRole) ? bd.byRole : []) as BreakdownByRole[];
  const penaltyBits: string[] = [];
  if (bd.countVerbal !== false && Number(bd.verbalCount) > 0) {
    penaltyBits.push(`устные ${bd.verbalCount} × ${bd.verbalPenaltyPct || 0}%`);
  }
  if (bd.countStrict !== false && Number(bd.strictCount) > 0) {
    penaltyBits.push(`строгие ${bd.strictCount} × ${bd.strictPenaltyPct || 0}%`);
  }

  return (
    <div className="payout-breakdown">
      <div className="payout-breakdown-summary">
        <div>
          Роль на конец недели:{' '}
          <RoleName name={totals.roleName || row.roleName} color={totals.roleColor || row.roleColor} />
        </div>
        <div>
          МП {totals.mpCount ?? row.mpCount} · ГМП {totals.gmpCount ?? row.gmpCount}
          {' · '}сырьё {bd.rawMc ?? 0} MC / {bd.rawDollars ?? 0}$
          {bd.eligible
            ? ` · за МП/ГМП ${bd.variableMc ?? totals.eventsMc ?? 0} MC / ${bd.variableDollars ?? totals.eventsDollars ?? 0}$`
            : ` · МП/ГМП не оплачены (мин. ${bd.minMp ?? 0} МП)`}
          {` · фикс ${bd.fixedMc || 0} MC / ${bd.fixedDollars || 0}$`}
          {` · итого ${bd.totalMc ?? (Number(bd.variableMc || 0) + Number(bd.fixedMc || 0))} MC / ${bd.totalDollars ?? (Number(bd.variableDollars || 0) + Number(bd.fixedDollars || 0))}$`}
        </div>
        {(Number(bd.fixedMc) > 0 || Number(bd.fixedDollars) > 0) && (
          <div>Фикс роли начисляется всегда, даже при 0 МП.</div>
        )}
        {penaltyBits.length > 0 && <div>Штрафы: {penaltyBits.join(', ')}</div>}
        {(row.mpCountOverride || row.gmpCountOverride) ? (
          <div className="field-hint">
            МП/ГМП изменены вручную: в ведомости МП {row.mpCount} · ГМП {row.gmpCount}
            {' '}(автосчёт по мероприятиям: МП {totals.mpCount ?? 0} · ГМП {totals.gmpCount ?? 0}).
            {' '}Начислено за МП/ГМП: {row.eventsMc ?? 0} MC / {row.eventsDollars ?? 0}$.
          </div>
        ) : row.eventsOverride ? (
          <div className="field-hint">В ведомости суммы «за мероприятия» изменены вручную ({row.eventsMc} MC / {row.eventsDollars}$).</div>
        ) : null}
      </div>

      {byRole.length > 0 && (
        <div className="payout-breakdown-block">
          <h4>По ролям на момент событий</h4>
          <div className="payout-table-wrap">
            <table className="payout-table">
              <thead>
                <tr>
                  <th>Роль</th>
                  <th>МП</th>
                  <th>ГМП</th>
                  <th>MC</th>
                  <th>$</th>
                </tr>
              </thead>
              <tbody>
                {byRole.map((r, i) => (
                  <tr key={`${r.roleName}-${i}`}>
                    <td><RoleName name={r.roleName} color={r.roleColor} /></td>
                    <td className="payout-num">{r.mp || 0}</td>
                    <td className="payout-num">{r.gmp || 0}</td>
                    <td className="payout-num">{r.mc || 0}</td>
                    <td className="payout-num">{r.dollars || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="payout-breakdown-block">
        <h4>Мероприятия ({events.length})</h4>
        {!events.length ? (
          <div className="role-tag">За неделю участий в МП/ГМП нет.</div>
        ) : (
          <div className="payout-table-wrap">
            <table className="payout-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Дата</th>
                  <th>Название</th>
                  <th>Роль</th>
                  <th>Ставка</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr key={`${ev.kind}-${ev.at}-${i}`}>
                    <td>{ev.kind === 'gmp' ? 'ГМП' : 'МП'}{ev.staffRole === 'organizer' ? ' · орг.' : ''}</td>
                    <td className="payout-muted">{formatEventAt(ev.at)}</td>
                    <td>{ev.title || '—'}</td>
                    <td><RoleName name={ev.roleName} color={ev.roleColor} /></td>
                    <td className="payout-num">{ev.rateMc || 0} MC / {ev.rateDollars || 0}$</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
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
      {log.map((entry) => {
        const desc = describeLogEntry(entry);
        return (
          <div className="roster-row" key={entry.id}>
            <div className="who">
              <div>
                <div className="nickname">{desc.title}</div>
                <div className="role-tag">
                  {entry.actor_nickname || 'система'}
                  {' · '}
                  {new Date(String(entry.created_at)).toLocaleString('ru-RU')}
                </div>
                {desc.lines.length > 0 && (
                  <div className="audit-details" style={{ marginTop: 6 }}>
                    {desc.lines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {!log.length && <div className="empty-state"><h3>Лог пуст</h3></div>}
    </>
  );
}
