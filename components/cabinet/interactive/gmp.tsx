'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, ErrorText, MarkdownFormField, matchesSearch, Modal, request, SearchBox, Select, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  open: 'Открыто',
  closed: 'Закрыто',
};

const STAFF_ROLE_LABEL: Record<string, string> = {
  staff: 'Помощник',
  organizer: 'Организатор',
};

function staffRoleLabel(role: unknown) {
  const key = String(role || 'staff');
  return STAFF_ROLE_LABEL[key] || key;
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}ч ${m}м ${s}с`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

function toLocalInputValue(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function GmpStatsCharts({ stats }: { stats: Row }) {
  const players = Number(stats.players) || 0;
  const finished = Number(stats.finished) || 0;
  const blocked = Number(stats.blocked) || 0;
  const inProgress = Number(stats.inProgress) || 0;
  const notStarted = Number(stats.notStarted) || Math.max(0, players - finished - blocked - inProgress);
  const checkpointStats = ((stats.checkpointStats as Row[]) || []);
  const barMax = Math.max(100, ...checkpointStats.map((cp) => Number(cp.percent) || 0), 1);

  const donutR = 54;
  const donutC = 2 * Math.PI * donutR;
  const finishFrac = players > 0 ? finished / players : 0;
  const finishLen = donutC * finishFrac;

  const statusParts = [
    { key: 'finished', label: 'Финиш', value: finished, className: 'gmp-dot-finish' },
    { key: 'progress', label: 'В процессе', value: inProgress, className: 'gmp-dot-progress' },
    { key: 'idle', label: 'Без отметок', value: notStarted, className: 'gmp-dot-rest' },
    { key: 'blocked', label: 'Блок', value: blocked, className: 'gmp-dot-blocked' },
  ];

  return (
    <div className="gmp-charts">
      <div className="gmp-chart-card">
        <div className="gmp-chart-title">Финиш</div>
        <div className="gmp-donut-wrap">
          <svg className="gmp-donut" viewBox="0 0 140 140" aria-hidden>
            <circle className="gmp-donut-track" cx="70" cy="70" r={donutR} />
            <circle
              className="gmp-donut-value"
              cx="70"
              cy="70"
              r={donutR}
              strokeDasharray={`${finishLen} ${donutC - finishLen}`}
              strokeDashoffset={donutC * 0.25}
            />
          </svg>
          <div className="gmp-donut-center">
            <strong>{players ? Math.round(finishFrac * 100) : 0}%</strong>
            <span>{finished}/{players}</span>
          </div>
        </div>
        <div className="gmp-chart-legend">
          {statusParts.map((part) => (
            <span key={part.key}><i className={`gmp-dot ${part.className}`} /> {part.label} · {part.value}</span>
          ))}
        </div>
      </div>

      <div className="gmp-chart-card">
        <div className="gmp-chart-title">Отметки по точкам</div>
        {checkpointStats.length ? (
          <div className="gmp-bars" role="img" aria-label="Процент отметок по контрольным точкам">
            {checkpointStats.map((cp) => {
              const pct = Number(cp.percent) || 0;
              const h = Math.max(4, (pct / barMax) * 100);
              return (
                <div className="gmp-bar-col" key={cp.id} title={`${String(cp.name)}: ${pct}%`}>
                  <div className="gmp-bar-value">{pct}%</div>
                  <div className="gmp-bar-track">
                    <div className="gmp-bar-fill" style={{ height: `${h}%` }} />
                  </div>
                  <div className="gmp-bar-label">{String(cp.name)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="field-hint">Нет контрольных точек</div>
        )}
      </div>
    </div>
  );
}

type StaffPick = { userId: number; role: 'staff' | 'organizer' };
type WinnerRow = {
  place: number;
  staticId: string;
  dollars: number;
  mc: number;
  battlePassXp: number;
};

function GmpFormFields({
  members,
  initial,
}: {
  members: Row[];
  initial?: {
    title?: string;
    startsAt?: string;
    writtenBy?: number | string;
    body?: string;
    status?: string;
    checkpoints?: string[];
    staff?: StaffPick[];
    winners?: WinnerRow[];
  };
}) {
  const [checkpoints, setCheckpoints] = useState<string[]>(
    initial?.checkpoints?.length ? initial.checkpoints : ['Старт', 'Финиш'],
  );
  const [staff, setStaff] = useState<StaffPick[]>(initial?.staff || []);
  const [staffQuery, setStaffQuery] = useState('');
  const [winners, setWinners] = useState<WinnerRow[]>(
    initial?.winners?.length
      ? initial.winners
      : [{ place: 1, staticId: '', dollars: 0, mc: 0, battlePassXp: 0 }],
  );

  function toggleStaff(userId: number) {
    setStaff((prev) => {
      if (prev.some((s) => s.userId === userId)) return prev.filter((s) => s.userId !== userId);
      return [...prev, { userId, role: 'staff' }];
    });
  }

  function setStaffRole(userId: number, role: 'staff' | 'organizer') {
    setStaff((prev) => prev.map((s) => (s.userId === userId ? { ...s, role } : s)));
  }

  const filteredMembers = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const nick = String(m.nickname || '').toLowerCase();
      const role = String(m.role_name || '').toLowerCase();
      const staticId = String(m.static_id || '');
      return nick.includes(q) || role.includes(q) || staticId.includes(q);
    });
  }, [members, staffQuery]);

  return (
    <>
      <div className="form-row-2">
        <div className="field">
          <label>Название</label>
          <input className="input" name="title" required defaultValue={initial?.title || ''} />
        </div>
        <div className="field">
          <label>Дата и время</label>
          <input
            className="input"
            type="datetime-local"
            name="startsAtLocal"
            required
            defaultValue={toLocalInputValue(initial?.startsAt)}
          />
        </div>
        <div className="field">
          <label>Кто написал ГМП</label>
          <Select
            name="writtenBy"
            required
            placeholder="Выберите"
            defaultValue={String(initial?.writtenBy || '')}
            options={members.map((m) => ({
              value: String(m.id),
              label: `${m.nickname} · ${m.role_name || 'Без роли'}`,
            }))}
          />
        </div>
        <div className="field">
          <label>Статус</label>
          <Select
            name="status"
            defaultValue={initial?.status || 'draft'}
            options={[
              { value: 'draft', label: 'Черновик' },
              { value: 'open', label: 'Открыто' },
              { value: 'closed', label: 'Закрыто' },
            ]}
          />
        </div>
      </div>

      <div className="field">
        <label>Описание (Markdown)</label>
        <MarkdownFormField name="body" initialValue={initial?.body || ''} />
      </div>

      <div className="field">
        <label>Чекпоинты</label>
        {checkpoints.map((name, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              value={name}
              onChange={(e) => {
                const next = [...checkpoints];
                next[index] = e.target.value;
                setCheckpoints(next);
              }}
              placeholder={`Чекпоинт ${index + 1}`}
            />
            <button
              type="button"
              className="icon-btn danger"
              disabled={checkpoints.length <= 1}
              onClick={() => setCheckpoints(checkpoints.filter((_, i) => i !== index))}
            >
              <NavIcon name="trash" />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCheckpoints([...checkpoints, ''])}>
          <NavIcon name="plus" /> Чекпоинт
        </button>
        <input type="hidden" name="checkpointsJson" value={JSON.stringify(checkpoints.filter((c) => c.trim()))} />
      </div>

      <div className="field">
        <label>Staff (состав ивента)</label>
        <input
          className="input"
          style={{ marginBottom: 8 }}
          value={staffQuery}
          onChange={(e) => setStaffQuery(e.target.value)}
          placeholder="Поиск по нику, роли, StaticID"
        />
        <div className="gmp-staff-pick">
          {filteredMembers.map((m) => {
            const picked = staff.find((s) => s.userId === Number(m.id));
            return (
              <div className="gmp-staff-row" key={m.id}>
                <label className="gmp-staff-check">
                  <input
                    type="checkbox"
                    checked={!!picked}
                    onChange={() => toggleStaff(Number(m.id))}
                  />
                  <span>{m.nickname}{m.static_id ? ` · #${m.static_id}` : ''}</span>
                </label>
                {picked ? (
                  <Select
                    value={picked.role}
                    onChange={(v) => setStaffRole(Number(m.id), v === 'organizer' ? 'organizer' : 'staff')}
                    options={[
                      { value: 'staff', label: staffRoleLabel('staff') },
                      { value: 'organizer', label: staffRoleLabel('organizer') },
                    ]}
                  />
                ) : <span />}
              </div>
            );
          })}
          {!filteredMembers.length && <div className="role-tag">Никого не найдено</div>}
        </div>
        <div className="field-hint">
          Выбрано: {staff.length}. Организатор может редактировать карточку ГМП.
        </div>
        <input type="hidden" name="staffJson" value={JSON.stringify(staff)} />
      </div>

      <div className="field">
        <label>Список победителей (места и награды)</label>
        <div className="field-hint" style={{ marginBottom: 8 }}>
          Начисления проводятся вручную. Здесь только список мест, StaticID и награды (Dollars / MC / опыт БП).
        </div>
        {winners.map((winner, index) => (
          <div className="form-row-2" key={index} style={{ marginBottom: 8 }}>
            <div className="field">
              <label>Место</label>
              <input
                className="input"
                type="number"
                min={1}
                value={winner.place}
                onChange={(e) => {
                  const next = [...winners];
                  next[index] = { ...winner, place: Number(e.target.value) || 1 };
                  setWinners(next);
                }}
              />
            </div>
            <div className="field">
              <label>StaticID</label>
              <input
                className="input"
                maxLength={6}
                value={winner.staticId}
                onChange={(e) => {
                  const next = [...winners];
                  next[index] = { ...winner, staticId: e.target.value.replace(/\D/g, '').slice(0, 6) };
                  setWinners(next);
                }}
                placeholder="необязательно"
              />
            </div>
            <div className="field">
              <label>Dollars</label>
              <input
                className="input"
                type="number"
                min={0}
                value={winner.dollars}
                onChange={(e) => {
                  const next = [...winners];
                  next[index] = { ...winner, dollars: Number(e.target.value) || 0 };
                  setWinners(next);
                }}
              />
            </div>
            <div className="field">
              <label>MC</label>
              <input
                className="input"
                type="number"
                min={0}
                value={winner.mc}
                onChange={(e) => {
                  const next = [...winners];
                  next[index] = { ...winner, mc: Number(e.target.value) || 0 };
                  setWinners(next);
                }}
              />
            </div>
            <div className="field">
              <label>Опыт БП</label>
              <input
                className="input"
                type="number"
                min={0}
                value={winner.battlePassXp}
                onChange={(e) => {
                  const next = [...winners];
                  next[index] = { ...winner, battlePassXp: Number(e.target.value) || 0 };
                  setWinners(next);
                }}
              />
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="icon-btn danger"
                style={{ marginTop: 22 }}
                disabled={winners.length <= 1}
                onClick={() => setWinners(winners.filter((_, i) => i !== index))}
              >
                <NavIcon name="trash" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setWinners([
            ...winners,
            { place: winners.length + 1, staticId: '', dollars: 0, mc: 0, battlePassXp: 0 },
          ])}
        >
          <NavIcon name="plus" /> Место
        </button>
        <input type="hidden" name="winnersJson" value={JSON.stringify(winners)} />
      </div>
    </>
  );
}

function payloadFromForm(form: FormData) {
  return {
    title: String(form.get('title') || '').trim(),
    startsAt: fromLocalInputValue(String(form.get('startsAtLocal') || '')),
    writtenBy: Number(form.get('writtenBy') || 0),
    body: String(form.get('body') || ''),
    status: String(form.get('status') || 'draft'),
    checkpoints: JSON.parse(String(form.get('checkpointsJson') || '[]')) as string[],
    staff: JSON.parse(String(form.get('staffJson') || '[]')) as StaffPick[],
    winners: JSON.parse(String(form.get('winnersJson') || '[]')) as WinnerRow[],
  };
}

export function GmpInteractive() {
  const router = useRouter();
  const [events, setEvents] = useState<Row[]>([]);
  const [members, setMembers] = useState<Row[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canViewAll, setCanViewAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => events.filter((item) => matchesSearch([
      item.title,
      item.status,
      STATUS_LABEL[String(item.status)],
      item.written_by_nickname,
      item.body,
    ], query)),
    [events, query],
  );

  async function load(writtenBy?: string) {
    const qs = writtenBy ? `?writtenBy=${encodeURIComponent(writtenBy)}` : '';
    const [gmp, roster] = await Promise.all([
      request(`/api/gmp${qs}`),
      request('/api/roster').catch(() => ({ members: [] })),
    ]);
    setEvents(gmp.events || []);
    setCanCreate(!!gmp.canCreate);
    setCanViewAll(!!gmp.canViewAll);
    setMembers((roster.members || []).filter((m: Row) => !m.is_blocked));
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const payload = payloadFromForm(new FormData(event.currentTarget));
      const data = await request('/api/gmp', { method: 'POST', body: JSON.stringify(payload) });
      setCreating(false);
      router.push(`/app/gmp/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!(await askConfirm('Удалить ГМП?', { title: 'ГМП', confirmLabel: 'Удалить', danger: true }))) return;
    try {
      await request(`/api/gmp/${id}`, { method: 'DELETE' });
      await load(authorFilter);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{canViewAll ? 'Все ГМП' : 'Мои ГМП'} · {filtered.length}{query.trim() ? ` / ${events.length}` : ''}</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Название, статус, автор…" />
        </div>
        {canCreate ? (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <NavIcon name="plus" /> Создать ГМП
          </button>
        ) : null}
      </div>

      {canViewAll ? (
        <form
          className="form-row-2"
          style={{ marginBottom: 14, maxWidth: 480 }}
          onSubmit={(e) => {
            e.preventDefault();
            void load(authorFilter).catch((err) => setError((err as Error).message));
          }}
        >
          <div className="field">
            <label>Фильтр: кто написал</label>
            <Select
              value={authorFilter}
              onChange={setAuthorFilter}
              placeholder="Все авторы"
              options={[
                { value: '', label: 'Все авторы' },
                ...members.map((m) => ({ value: String(m.id), label: String(m.nickname) })),
              ]}
            />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 22 }} type="submit">Применить</button>
          </div>
        </form>
      ) : null}

      <ErrorText value={error} />
      {filtered.map((item) => (
        <div className="roster-row" key={item.id}>
          <div className="who">
            <div>
              <div className="nickname">
                <Link href={`/app/gmp/${item.id}`}>{item.title}</Link>
              </div>
              <div className="role-tag">
                {new Date(String(item.starts_at)).toLocaleString('ru-RU')}
                {' · '}
                {STATUS_LABEL[String(item.status)] || item.status}
                {' · '}
                написал {item.written_by_nickname || '—'}
                {' · '}
                состав {item.staff_count || 0}
                {' · '}
                игроков {item.player_count || 0}
              </div>
            </div>
          </div>
          <div className="row-actions">
            <Link className="btn btn-ghost btn-sm" href={`/app/gmp/${item.id}`}>Открыть</Link>
            {canCreate ? (
              <button className="icon-btn danger" onClick={() => void remove(Number(item.id))}>
                <NavIcon name="trash" />
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {!filtered.length && (
        <div className="empty-state">
          <h3>{query.trim() ? 'Ничего не найдено' : 'ГМП пока нет'}</h3>
          {!query.trim() ? (
            <p>Создайте первое мероприятие или дождитесь назначения в состав.</p>
          ) : null}
        </div>
      )}

      {creating && (
        <Modal title="Новое ГМП" onClose={() => setCreating(false)} editor>
          <form onSubmit={create}>
            <ErrorText value={error} />
            <GmpFormFields members={members} />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Отмена</button>
              <button className="btn btn-primary">Создать</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function GmpDetailInteractive({ eventId }: { eventId: number }) {
  const [bundle, setBundle] = useState<Row | null>(null);
  const [members, setMembers] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingWinners, setEditingWinners] = useState(false);
  const [staticId, setStaticId] = useState('');
  const [busyMark, setBusyMark] = useState('');
  const [winnerDraft, setWinnerDraft] = useState<WinnerRow[]>([]);
  const [detailTab, setDetailTab] = useState<'info' | 'table' | 'stats' | 'winners'>('info');
  const [blockingPlayer, setBlockingPlayer] = useState<Row | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [busyBlock, setBusyBlock] = useState(false);
  const liveStampRef = useRef('');

  async function load() {
    const [data, roster] = await Promise.all([
      request(`/api/gmp/${eventId}`),
      request('/api/roster').catch(() => ({ members: [] })),
    ]);
    setBundle(data);
    liveStampRef.current = String(data.liveStamp || '');
    setMembers((roster.members || []).filter((m: Row) => !m.is_blocked));
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [eventId]);

  useEffect(() => {
    if (!bundle) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const since = liveStampRef.current;
      const url = `/api/gmp/${eventId}/live${since ? `?since=${encodeURIComponent(since)}` : ''}`;
      void fetch(url, {
        credentials: 'same-origin',
        headers: since ? { 'If-None-Match': `"${since}"` } : undefined,
      }).then(async (response) => {
        if (cancelled || response.status === 304 || !response.ok) return;
        const live = await response.json();
        liveStampRef.current = String(live.liveStamp || '');
        setBundle((prev) => (prev ? {
          ...prev,
          players: live.players,
          marks: live.marks,
          winners: live.winners,
          stats: live.stats,
          canMark: live.canMark,
          event: { ...(prev.event as Row), status: live.status },
          liveStamp: live.liveStamp,
        } : prev));
      }).catch(() => undefined);
    };
    const ms = () => (document.visibilityState === 'hidden' ? 15000 : 2500);
    let timer = window.setInterval(run, ms());
    const onVis = () => {
      window.clearInterval(timer);
      timer = window.setInterval(run, ms());
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [!!bundle, eventId]);

  const markSet = useMemo(() => {
    const set = new Set<string>();
    for (const mark of (bundle?.marks as Row[] | undefined) || []) {
      set.add(`${mark.player_id}:${mark.checkpoint_id}`);
    }
    return set;
  }, [bundle?.marks]);

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const full = payloadFromForm(new FormData(event.currentTarget));
      const payload: Record<string, unknown> = {};
      if (bundle?.canEditBody) {
        payload.title = full.title;
        payload.startsAt = full.startsAt;
        payload.writtenBy = full.writtenBy;
        payload.body = full.body;
        payload.status = full.status;
      }
      if (bundle?.canManageStaff) payload.staff = full.staff;
      if (bundle?.canEditCheckpoints) payload.checkpoints = full.checkpoints;
      if (bundle?.canEditWinners) payload.winners = full.winners;
      const data = await request(`/api/gmp/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setBundle(data);
      liveStampRef.current = String(data.liveStamp || '');
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setStatus(status: string) {
    setError('');
    if (status === 'closed') {
      const okClose = await askConfirm(
        'Закрыть ГМП? После закрытия нельзя менять отметки и состав игроков. Награды выдаются вручную по списку победителей.',
        { title: 'Закрыть ГМП', confirmLabel: 'Закрыть' },
      );
      if (!okClose) return;
    }
    try {
      const data = await request(`/api/gmp/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setBundle(data);
      liveStampRef.current = String(data.liveStamp || '');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addPlayer(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await request(`/api/gmp/${eventId}/players`, {
        method: 'POST',
        body: JSON.stringify({ staticId }),
      });
      setStaticId('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removePlayer(playerId: number) {
    if (!(await askConfirm('Убрать игрока из таблицы?', { title: 'ГМП', confirmLabel: 'Убрать', danger: true }))) return;
    try {
      await request(`/api/gmp/${eventId}/players`, {
        method: 'DELETE',
        body: JSON.stringify({ playerId }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function applyPlayersLive(data: Row) {
    if (data.liveStamp) liveStampRef.current = String(data.liveStamp);
    setBundle((prev) => (prev ? {
      ...prev,
      players: data.players,
      marks: data.marks,
      winners: data.winners,
      stats: data.stats,
      liveStamp: data.liveStamp || prev.liveStamp,
    } : prev));
  }

  async function submitBlock(event: FormEvent) {
    event.preventDefault();
    if (!blockingPlayer) return;
    const reason = blockReason.trim();
    if (!reason) return setError('Укажите причину блокировки.');
    setBusyBlock(true);
    setError('');
    try {
      const data = await request(`/api/gmp/${eventId}/players`, {
        method: 'PUT',
        body: JSON.stringify({
          action: 'block',
          playerId: Number(blockingPlayer.id),
          reason,
        }),
      });
      applyPlayersLive(data);
      setBlockingPlayer(null);
      setBlockReason('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyBlock(false);
    }
  }

  async function unblockPlayer(player: Row) {
    if (!(await askConfirm(
      `Снять блокировку с #${player.static_id}? Отметки снова можно будет менять.`,
      { title: 'ГМП', confirmLabel: 'Разблокировать', danger: false },
    ))) return;
    setError('');
    try {
      const data = await request(`/api/gmp/${eventId}/players`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'unblock', playerId: Number(player.id) }),
      });
      applyPlayersLive(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleMark(playerId: number, checkpointId: number, marked: boolean) {
    const key = `${playerId}:${checkpointId}`;
    setBusyMark(key);
    setError('');
    try {
      const data = await request(`/api/gmp/${eventId}/marks`, {
        method: 'PUT',
        body: JSON.stringify({ playerId, checkpointId, marked }),
      });
      applyPlayersLive(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyMark('');
    }
  }

  function openWinnersEditor() {
    const list = ((bundle?.winners as Row[]) || []).map((w) => ({
      place: Number(w.place),
      staticId: String(w.static_id || ''),
      dollars: Number(w.dollars) || 0,
      mc: Number(w.mc) || 0,
      battlePassXp: Number(w.battle_pass_xp) || 0,
    }));
    setWinnerDraft(list.length ? list : [{ place: 1, staticId: '', dollars: 0, mc: 0, battlePassXp: 0 }]);
    setEditingWinners(true);
  }

  async function saveWinners(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const data = await request(`/api/gmp/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ winners: winnerDraft }),
      });
      setBundle(data);
      liveStampRef.current = String(data.liveStamp || '');
      setEditingWinners(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!bundle?.event) {
    return <ErrorText value={error || 'Загрузка…'} />;
  }

  const event = bundle.event as Row;
  const checkpoints = (bundle.checkpoints as Row[]) || [];
  const players = (bundle.players as Row[]) || [];
  const winners = (bundle.winners as Row[]) || [];
  const staff = (bundle.staff as Row[]) || [];
  const stats = (bundle.stats as Row) || {};
  const canEditBody = !!bundle.canEditBody;
  const canManageStaff = !!bundle.canManageStaff;
  const canEditWinners = !!bundle.canEditWinners;
  const canEditCheckpoints = !!bundle.canEditCheckpoints;
  const canViewStats = !!bundle.canViewStats;
  const canMark = !!bundle.canMark;
  const canEditMeta = canEditBody || canManageStaff || canEditCheckpoints || canEditWinners;
  const isClosed = String(event.status) === 'closed';

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <Link className="btn btn-ghost btn-sm" href="/app/gmp">← К списку</Link>
        </div>
        <div className="row-actions">
          {canEditBody && event.status !== 'open' ? (
            <button className="btn btn-ghost btn-sm" onClick={() => void setStatus('open')}>Открыть</button>
          ) : null}
          {canEditBody && !isClosed ? (
            <button className="btn btn-primary btn-sm" onClick={() => void setStatus('closed')}>Закрыть</button>
          ) : null}
          {canEditMeta ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Редактировать
            </button>
          ) : null}
        </div>
      </div>

      <ErrorText value={error} />

      {isClosed ? (
        <div className="gmp-closed-note">
          ГМП закрыто: отметки и игроки заблокированы. Награды выдаются вручную по списку победителей.
        </div>
      ) : null}

      <div className="segmented roster-tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={detailTab === 'info' ? 'active' : ''}
          onClick={() => setDetailTab('info')}
        >
          Описание
        </button>
        <button
          type="button"
          className={detailTab === 'table' ? 'active' : ''}
          onClick={() => setDetailTab('table')}
        >
          Таблица · {players.length}
        </button>
        <button
          type="button"
          className={detailTab === 'stats' ? 'active' : ''}
          onClick={() => setDetailTab('stats')}
        >
          Статистика
        </button>
        <button
          type="button"
          className={detailTab === 'winners' ? 'active' : ''}
          onClick={() => setDetailTab('winners')}
        >
          Победители · {winners.filter((w) => w.static_id).length}/{winners.length || 0}
        </button>
      </div>

      {detailTab === 'info' ? (
        <>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>{String(event.title)}</h3>
              <span className={`badge ${isClosed ? 'badge-muted' : event.status === 'open' ? 'badge-green' : 'badge-amber'}`}>
                {STATUS_LABEL[String(event.status)] || String(event.status)}
              </span>
            </div>
            <div className="role-tag">
              {new Date(String(event.starts_at)).toLocaleString('ru-RU')}
              {' · написал '}
              {String(event.written_by_nickname || '—')}
            </div>
            {event.bodyHtml ? (
              <div className="md-body" style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: String(event.bodyHtml) }} />
            ) : (
              <div className="field-hint" style={{ marginTop: 12 }}>Описание пока не заполнено.</div>
            )}
          </div>

          <div className="form-row-2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="card-header"><h3>Чекпоинты</h3></div>
              {checkpoints.length ? (
                <ol className="gmp-checkpoint-list">
                  {checkpoints.map((cp) => (
                    <li key={cp.id}>{String(cp.name)}</li>
                  ))}
                </ol>
              ) : (
                <div className="empty-state"><h3>Точки не заданы</h3></div>
              )}
            </div>
            <div className="card card-pad">
              <div className="card-header"><h3>Состав</h3></div>
              {staff.length ? staff.map((s) => (
                <div className="roster-row" key={s.user_id}>
                  <div className="who">
                    <div>
                      <div className="nickname">{String(s.nickname)}</div>
                      <div className="role-tag">{staffRoleLabel(s.role)}</div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="empty-state"><h3>Состав не назначен</h3></div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {detailTab === 'table' ? (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>Таблица отметок</h3></div>
          {canMark ? (
            <form className="gmp-add-player" onSubmit={addPlayer}>
              <input
                className="input"
                value={staticId}
                maxLength={6}
                placeholder="StaticID"
                onChange={(e) => setStaticId(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <button className="btn btn-primary btn-sm" type="submit" disabled={staticId.length < 2}>
                <NavIcon name="plus" /> Игрок
              </button>
            </form>
          ) : null}
          <div className="gmp-table-wrap">
            <table className="gmp-table">
              <thead>
                <tr>
                  <th>StaticID</th>
                  {checkpoints.map((cp) => <th key={cp.id}>{String(cp.name)}</th>)}
                  <th>Место</th>
                  <th>Статус</th>
                  {canMark ? <th>Действия</th> : null}
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const blocked = !!player.is_blocked;
                  return (
                    <tr key={player.id} className={blocked ? 'is-blocked' : undefined}>
                      <td>#{String(player.static_id)}</td>
                      {checkpoints.map((cp) => {
                        const key = `${player.id}:${cp.id}`;
                        const checked = markSet.has(key);
                        return (
                          <td key={cp.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canMark || blocked || busyMark === key || isClosed}
                              onChange={() => void toggleMark(Number(player.id), Number(cp.id), !checked)}
                            />
                          </td>
                        );
                      })}
                      <td>{player.place != null ? String(player.place) : '—'}</td>
                      <td className="gmp-status-cell">
                        {blocked ? (
                          <div className="gmp-block-info">
                            <span className="badge badge-red">Заблокирован</span>
                            <div className="gmp-block-reason">{String(player.block_reason || '—')}</div>
                            <div className="gmp-block-meta">
                              {player.blocked_by_nickname
                                ? String(player.blocked_by_nickname)
                                : 'неизвестно'}
                              {player.blocked_at
                                ? ` · ${new Date(String(player.blocked_at)).toLocaleString('ru-RU')}`
                                : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="role-tag">Активен</span>
                        )}
                      </td>
                      {canMark ? (
                        <td className="gmp-actions-cell">
                          {blocked ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={isClosed}
                              onClick={() => void unblockPlayer(player)}
                            >
                              Разблокировать
                            </button>
                          ) : (
                            <button
                              className="btn btn-danger btn-sm"
                              type="button"
                              disabled={isClosed}
                              onClick={() => {
                                setError('');
                                setBlockReason('');
                                setBlockingPlayer(player);
                              }}
                            >
                              Заблокировать
                            </button>
                          )}
                          <button
                            className="icon-btn danger"
                            type="button"
                            title="Убрать из таблицы"
                            disabled={isClosed}
                            onClick={() => void removePlayer(Number(player.id))}
                          >
                            <NavIcon name="trash" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!players.length && <div className="empty-state"><h3>Игроков пока нет</h3></div>}
          </div>
        </div>
      ) : null}

      {detailTab === 'stats' ? (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="card-header"><h3>Статистика</h3></div>
          {canViewStats && stats ? (
            <>
              <div className="gmp-stats-tags">
                <div className="role-tag">Игроков: {Number(stats.players) || 0}</div>
                <div className="role-tag">Активных: {Number(stats.active) || 0}</div>
                <div className="role-tag">Финиш: {Number(stats.finished) || 0} ({Number(stats.finishRate) || 0}%)</div>
                <div className="role-tag">В процессе: {Number(stats.inProgress) || 0}</div>
                <div className="role-tag">Без отметок: {Number(stats.notStarted) || 0}</div>
                <div className="role-tag">Заблокировано: {Number(stats.blocked) || 0}</div>
                <div className="role-tag">
                  Состав: {Number(stats.staff) || 0}
                  {' · '}
                  {staffRoleLabel('organizer')}: {Number(stats.organizers) || 0}
                  {' · '}
                  {staffRoleLabel('staff')}: {Number(stats.helpers) || 0}
                </div>
                <div className="role-tag">
                  Отметок: {Number(stats.marksTotal) || 0}
                  {Number(stats.marksPossible) ? ` / ${Number(stats.marksPossible)}` : ''}
                </div>
                <div className="role-tag">Среднее отметок на игрока: {Number(stats.avgMarksPerPlayer) || 0}</div>
                <div className="role-tag">
                  Победители: {Number(stats.winnersAssigned) || 0}/{Number(stats.winnersTotal) || 0}
                </div>
                {formatDuration(stats.avgFinishMs as number | null) ? (
                  <div className="role-tag">Среднее время финиша: {formatDuration(stats.avgFinishMs as number | null)}</div>
                ) : null}
                {formatDuration(stats.medianFinishMs as number | null) ? (
                  <div className="role-tag">Медиана финиша: {formatDuration(stats.medianFinishMs as number | null)}</div>
                ) : null}
                {formatDuration(stats.minFinishMs as number | null) ? (
                  <div className="role-tag">Лучшее время: {formatDuration(stats.minFinishMs as number | null)}</div>
                ) : null}
                {formatDuration(stats.maxFinishMs as number | null) ? (
                  <div className="role-tag">Худшее время: {formatDuration(stats.maxFinishMs as number | null)}</div>
                ) : null}
                {stats.avgMarkedAt ? (
                  <div className="role-tag">
                    Среднее время отметок: {new Date(String(stats.avgMarkedAt)).toLocaleString('ru-RU')}
                  </div>
                ) : null}
                {stats.medianMarkedAt ? (
                  <div className="role-tag">
                    Медиана отметок: {new Date(String(stats.medianMarkedAt)).toLocaleString('ru-RU')}
                  </div>
                ) : null}
              </div>
              <GmpStatsCharts stats={stats} />
              <div className="form-row-2" style={{ marginTop: 14 }}>
                <div>
                  <div className="card-header"><h3>По точкам</h3></div>
                  {((stats.checkpointStats as Row[]) || []).map((cp) => (
                    <div className="role-tag" key={cp.id}>
                      {String(cp.name)}: {Number(cp.percent) || 0}% ({Number(cp.marked) || 0})
                    </div>
                  ))}
                  {!((stats.checkpointStats as Row[]) || []).length && (
                    <div className="field-hint">Нет контрольных точек</div>
                  )}
                </div>
                <div>
                  <div className="card-header"><h3>Лидеры финиша</h3></div>
                  {((stats.leaders as Row[]) || []).map((leader) => (
                    <div className="roster-row" key={leader.id}>
                      <div className="who">
                        <div>
                          <div className="nickname">
                            {leader.place != null ? `${leader.place}. ` : ''}
                            #{String(leader.static_id)}
                          </div>
                          <div className="role-tag">
                            {formatDuration(leader.durationMs as number | null) || 'время н/д'}
                            {leader.finished_at
                              ? ` · ${new Date(String(leader.finished_at)).toLocaleString('ru-RU')}`
                              : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!((stats.leaders as Row[]) || []).length && (
                    <div className="field-hint">Пока никто не финишировал</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state"><h3>Нет доступа к статистике</h3></div>
          )}
        </div>
      ) : null}

      {detailTab === 'winners' ? (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3>Победители</h3>
            {canEditWinners ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={openWinnersEditor}>
                <NavIcon name="edit" /> Изменить
              </button>
            ) : null}
          </div>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Список для ручной выдачи наград. Автозаполнение StaticID из финиша — только в пустые места.
          </div>
          <div className="gmp-winners-grid">
            {winners.map((w) => (
              <div className="roster-row" key={w.place}>
                <div className="who">
                  <div>
                    <div className="nickname">
                      {Number(w.place)}. · {w.static_id ? `#${w.static_id}` : 'не назначен'}
                    </div>
                    <div className="role-tag">
                      ${Number(w.dollars) || 0} · {Number(w.mc) || 0} MC · {Number(w.battle_pass_xp) || 0} опыта БП
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!winners.length && <div className="empty-state"><h3>Места не заданы</h3></div>}
        </div>
      ) : null}

      {editing && (
        <Modal title="Редактирование ГМП" onClose={() => setEditing(false)} editor>
          <form onSubmit={saveEdit}>
            <ErrorText value={error} />
            {!canEditBody && !canManageStaff && !canEditCheckpoints && !canEditWinners ? (
              <p className="error-text">Нет прав на изменение полей этой формы.</p>
            ) : null}
            <GmpFormFields
              members={members}
              initial={{
                title: String(event.title || ''),
                startsAt: String(event.starts_at || ''),
                writtenBy: Number(event.written_by),
                body: String(event.body || ''),
                status: String(event.status || 'draft'),
                checkpoints: checkpoints.map((c) => String(c.name)),
                staff: staff.map((s) => ({
                  userId: Number(s.user_id),
                  role: s.role === 'organizer' ? 'organizer' : 'staff',
                })),
                winners: winners.map((w) => ({
                  place: Number(w.place),
                  staticId: String(w.static_id || ''),
                  dollars: Number(w.dollars) || 0,
                  mc: Number(w.mc) || 0,
                  battlePassXp: Number(w.battle_pass_xp) || 0,
                })),
              }}
            />
            <div className="field-hint">
              Сохранятся только поля, на которые есть права
              {[
                canEditBody ? 'описание/статус' : null,
                canManageStaff ? 'состав' : null,
                canEditCheckpoints ? 'точки' : null,
                canEditWinners ? 'победители' : null,
              ].filter(Boolean).join(', ') || '—'}.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Отмена</button>
              <button className="btn btn-primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}

      {editingWinners && canEditWinners && (
        <Modal title="Победители и награды" onClose={() => setEditingWinners(false)} wide>
          <form onSubmit={saveWinners}>
            <ErrorText value={error} />
            <div className="field-hint" style={{ marginBottom: 12 }}>
              Можно менять места, StaticID и награды. Выплата — вручную вне портала.
            </div>
            {winnerDraft.map((winner, index) => (
              <div className="form-row-2" key={index} style={{ marginBottom: 8 }}>
                <div className="field">
                  <label>Место</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={winner.place}
                    onChange={(e) => {
                      const next = [...winnerDraft];
                      next[index] = { ...winner, place: Number(e.target.value) || 1 };
                      setWinnerDraft(next);
                    }}
                  />
                </div>
                <div className="field">
                  <label>StaticID</label>
                  <input
                    className="input"
                    maxLength={6}
                    value={winner.staticId}
                    onChange={(e) => {
                      const next = [...winnerDraft];
                      next[index] = { ...winner, staticId: e.target.value.replace(/\D/g, '').slice(0, 6) };
                      setWinnerDraft(next);
                    }}
                  />
                </div>
                <div className="field">
                  <label>Dollars</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={winner.dollars}
                    onChange={(e) => {
                      const next = [...winnerDraft];
                      next[index] = { ...winner, dollars: Number(e.target.value) || 0 };
                      setWinnerDraft(next);
                    }}
                  />
                </div>
                <div className="field">
                  <label>MC</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={winner.mc}
                    onChange={(e) => {
                      const next = [...winnerDraft];
                      next[index] = { ...winner, mc: Number(e.target.value) || 0 };
                      setWinnerDraft(next);
                    }}
                  />
                </div>
                <div className="field">
                  <label>Опыт БП</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={winner.battlePassXp}
                    onChange={(e) => {
                      const next = [...winnerDraft];
                      next[index] = { ...winner, battlePassXp: Number(e.target.value) || 0 };
                      setWinnerDraft(next);
                    }}
                  />
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="icon-btn danger"
                    style={{ marginTop: 22 }}
                    disabled={winnerDraft.length <= 1}
                    onClick={() => setWinnerDraft(winnerDraft.filter((_, i) => i !== index))}
                  >
                    <NavIcon name="trash" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setWinnerDraft([
                ...winnerDraft,
                { place: winnerDraft.length + 1, staticId: '', dollars: 0, mc: 0, battlePassXp: 0 },
              ])}
            >
              <NavIcon name="plus" /> Место
            </button>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditingWinners(false)}>Отмена</button>
              <button className="btn btn-primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}

      {blockingPlayer && canMark && (
        <Modal
          title={`Блокировка #${blockingPlayer.static_id}`}
          onClose={() => {
            if (!busyBlock) {
              setBlockingPlayer(null);
              setBlockReason('');
            }
          }}
        >
          <form onSubmit={submitBlock}>
            <ErrorText value={error} />
            <p className="modal-sub" style={{ textAlign: 'left' }}>
              Отметки игрока будут заморожены. Причину увидят все, у кого есть доступ к таблице.
            </p>
            <div className="field">
              <label>Причина</label>
              <textarea
                className="input"
                required
                maxLength={300}
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Укажите причину блокировки"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyBlock}
                onClick={() => {
                  setBlockingPlayer(null);
                  setBlockReason('');
                }}
              >
                Отмена
              </button>
              <button className="btn btn-danger" disabled={busyBlock || !blockReason.trim()}>
                {busyBlock ? 'Блокировка…' : 'Заблокировать'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
