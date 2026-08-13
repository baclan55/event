'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, ErrorText, MarkdownFormField, Modal, request, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  open: 'Открыто',
  closed: 'Закрыто',
};

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
          <select className="input" name="writtenBy" required defaultValue={String(initial?.writtenBy || '')}>
            <option value="">Выберите</option>
            {members.map((m) => (
              <option value={m.id} key={m.id}>{m.nickname} · {m.role_name || 'Без роли'}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Статус</label>
          <select className="input" name="status" defaultValue={initial?.status || 'draft'}>
            <option value="draft">Черновик</option>
            <option value="open">Открыто</option>
            <option value="closed">Закрыто</option>
          </select>
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
              <label className="gmp-staff-row" key={m.id}>
                <input
                  type="checkbox"
                  checked={!!picked}
                  onChange={() => toggleStaff(Number(m.id))}
                />
                <span>{m.nickname}{m.static_id ? ` · #${m.static_id}` : ''}</span>
                {picked ? (
                  <select
                    className="input"
                    value={picked.role}
                    onChange={(e) => setStaffRole(Number(m.id), e.target.value === 'organizer' ? 'organizer' : 'staff')}
                  >
                    <option value="staff">staff</option>
                    <option value="organizer">organizer</option>
                  </select>
                ) : <span />}
              </label>
            );
          })}
          {!filteredMembers.length && <div className="role-tag">Никого не найдено</div>}
        </div>
        <div className="field-hint">Выбрано: {staff.length}. Organizer может редактировать карточку ГМП.</div>
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
        <div className="toolbar-left">
          {canViewAll ? 'Все ГМП' : 'Мои ГМП'} · {events.length}
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
            <select className="input" value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}>
              <option value="">Все авторы</option>
              {members.map((m) => (
                <option value={String(m.id)} key={m.id}>{m.nickname}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 22 }} type="submit">Применить</button>
          </div>
        </form>
      ) : null}

      <ErrorText value={error} />
      {events.map((item) => (
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
                staff {item.staff_count || 0}
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
      {!events.length && (
        <div className="empty-state">
          <h3>ГМП пока нет</h3>
          <p>Создайте первое мероприятие или дождитесь назначения в staff.</p>
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

  async function toggleMark(playerId: number, checkpointId: number, marked: boolean) {
    const key = `${playerId}:${checkpointId}`;
    setBusyMark(key);
    setError('');
    try {
      const data = await request(`/api/gmp/${eventId}/marks`, {
        method: 'PUT',
        body: JSON.stringify({ playerId, checkpointId, marked }),
      });
      if (data.liveStamp) liveStampRef.current = String(data.liveStamp);
      setBundle((prev) => (prev ? {
        ...prev,
        players: data.players,
        marks: data.marks,
        winners: data.winners,
        stats: data.stats,
        liveStamp: data.liveStamp || prev.liveStamp,
      } : prev));
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
              <NavIcon name="edit" /> Редактировать
            </button>
          ) : null}
        </div>
      </div>

      <ErrorText value={error} />

      {isClosed ? (
        <div className="badge badge-muted" style={{ marginBottom: 12, display: 'inline-block' }}>
          ГМП закрыто: отметки и игроки заблокированы. Награды выдаются вручную по списку победителей.
        </div>
      ) : null}

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
        ) : null}
      </div>

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
                {canMark ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id}>
                  <td>#{String(player.static_id)}</td>
                  {checkpoints.map((cp) => {
                    const key = `${player.id}:${cp.id}`;
                    const checked = markSet.has(key);
                    return (
                      <td key={cp.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canMark || busyMark === key || isClosed}
                          onChange={() => void toggleMark(Number(player.id), Number(cp.id), !checked)}
                        />
                      </td>
                    );
                  })}
                  <td>{player.place != null ? String(player.place) : '—'}</td>
                  {canMark ? (
                    <td>
                      <button className="icon-btn danger" type="button" onClick={() => void removePlayer(Number(player.id))}>
                        <NavIcon name="trash" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {!players.length && <div className="empty-state"><h3>Игроков пока нет</h3></div>}
        </div>
      </div>

      <div className="form-row-2" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
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
          {!winners.length && <div className="empty-state"><h3>Места не заданы</h3></div>}
        </div>

        <div className="card card-pad">
          <div className="card-header"><h3>Статистика</h3></div>
          {canViewStats && stats ? (
            <>
              <div className="role-tag">Игроков: {Number(stats.players) || 0}</div>
              <div className="role-tag">Финиш: {Number(stats.finished) || 0}</div>
              <div className="role-tag">Staff: {Number(stats.staff) || 0} (organizer: {Number(stats.organizers) || 0})</div>
              {formatDuration(stats.avgFinishMs as number | null) ? (
                <div className="role-tag">Среднее время финиша: {formatDuration(stats.avgFinishMs as number | null)}</div>
              ) : null}
              {formatDuration(stats.medianFinishMs as number | null) ? (
                <div className="role-tag">Медиана финиша: {formatDuration(stats.medianFinishMs as number | null)}</div>
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
              <div style={{ marginTop: 10 }}>
                {((stats.checkpointStats as Row[]) || []).map((cp) => (
                  <div className="role-tag" key={cp.id}>
                    {String(cp.name)}: {Number(cp.percent) || 0}% ({Number(cp.marked) || 0})
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state"><h3>Нет доступа к статистике</h3></div>
          )}
          <div style={{ marginTop: 12 }}>
            <div className="card-header"><h3>Staff</h3></div>
            {staff.map((s) => (
              <div className="role-tag" key={s.user_id}>
                {String(s.nickname)} · {String(s.role)}
              </div>
            ))}
          </div>
        </div>
      </div>

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
                canManageStaff ? 'staff' : null,
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
    </>
  );
}
