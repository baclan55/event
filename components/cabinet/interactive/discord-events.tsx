'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, Avatar, ErrorText, request, SearchBox, Select, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  completed: 'Проведено',
  open: 'Идёт',
  abandoned: 'Отменено',
};

const JOB_LABEL: Record<string, string> = {
  pending: 'В очереди у бота…',
  running: 'Бот собирает историю…',
  done: 'Пересборка завершена',
  failed: 'Ошибка пересборки',
};

type Caps = {
  editParticipants: boolean;
  editStatus: boolean;
  delete: boolean;
};

const PAGE_SIZE = 20;

export function DiscordEventsInteractive() {
  const [events, setEvents] = useState<Row[]>([]);
  const [status, setStatus] = useState('completed');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [canResync, setCanResync] = useState(false);
  const [caps, setCaps] = useState<Caps>({
    editParticipants: false,
    editStatus: false,
    delete: false,
  });
  const [resyncJob, setResyncJob] = useState<Row | null>(null);
  const [busyResync, setBusyResync] = useState(false);
  const [busyDedupe, setBusyDedupe] = useState(false);
  const [busyId, setBusyId] = useState('');

  async function load(nextStatus = status, nextPage = page, nextQuery = query) {
    const params = new URLSearchParams({
      status: nextStatus,
      page: String(nextPage),
      pageSize: String(PAGE_SIZE),
    });
    if (nextQuery.trim()) params.set('q', nextQuery.trim());
    const data = await request(`/api/discord-events?${params}`);
    setEvents(data.events || []);
    setCanResync(!!data.canResync);
    setCaps({
      editParticipants: !!data.caps?.editParticipants,
      editStatus: !!data.caps?.editStatus,
      delete: !!data.caps?.delete,
    });
    setResyncJob(data.resyncJob || null);
    setTotal(Number(data.total) || 0);
    setTotalPages(Math.max(1, Number(data.totalPages) || 1));
    setPage(Number(data.page) || nextPage);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    const jobStatus = String(resyncJob?.status || '');
    if (jobStatus !== 'pending' && jobStatus !== 'running') return;
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [resyncJob?.status, status, page, query]);

  const searchReady = useRef(false);
  useEffect(() => {
    if (!searchReady.current) {
      searchReady.current = true;
      return;
    }
    const timer = setTimeout(() => {
      setPage(1);
      setExpanded(null);
      void load(status, 1, query).catch((err) => setError((err as Error).message));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function requestResync() {
    if (!(await askConfirm(
      'Бот заново пройдёт историю канала Discord и импортирует все доступные сборы МП. Уже учтённые начисления не задублируются. Запустить?',
      { title: 'Пересобрать МП', confirmLabel: 'Запустить', danger: false },
    ))) return;
    setBusyResync(true);
    setError('');
    try {
      const data = await request('/api/discord-events/resync', { method: 'POST', body: '{}' });
      setResyncJob(data.job || null);
      if (data.alreadyQueued) {
        setError('Пересборка уже в очереди или выполняется.');
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyResync(false);
    }
  }

  async function requestDedupe() {
    if (!(await askConfirm(
      'Удалит дубликаты по Discord message id и проведённые МП с одинаковым названием в один день (останется самое раннее сообщение). Продолжить?',
      { title: 'Удалить дубликаты', confirmLabel: 'Удалить', danger: true },
    ))) return;
    setBusyDedupe(true);
    setError('');
    setNotice('');
    try {
      const data = await request('/api/discord-events', {
        method: 'POST',
        body: JSON.stringify({ action: 'dedupe' }),
      });
      const removed = Number(data.removed) || 0;
      setNotice(removed
        ? `Удалено дубликатов: ${removed}`
          + (data.orphans ? ` · сиротских записей: ${data.orphans}` : '')
        : 'Дубликатов не найдено.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyDedupe(false);
    }
  }

  async function setEventStatus(messageId: string, nextStatus: string) {
    setBusyId(messageId);
    setError('');
    try {
      await request('/api/discord-events', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'setStatus', messageId, status: nextStatus }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function removeEvent(messageId: string, title: string) {
    if (!(await askConfirm(
      `Удалить мероприятие «${title || 'без названия'}» и весь список участников?`,
      { title: 'Удаление мероприятия', confirmLabel: 'Удалить', danger: true },
    ))) return;
    setBusyId(messageId);
    setError('');
    try {
      await request('/api/discord-events', {
        method: 'DELETE',
        body: JSON.stringify({ messageId }),
      });
      if (expanded === messageId) setExpanded(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function removeParticipant(messageId: string, discordId: string, label: string) {
    if (!(await askConfirm(
      `Убрать участника ${label} из состава мероприятия?`,
      { title: 'Участник', confirmLabel: 'Убрать', danger: true },
    ))) return;
    setBusyId(`${messageId}:${discordId}`);
    setError('');
    try {
      await request('/api/discord-events', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'removeParticipant', messageId, discordId }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>, messageId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const discordId = String(form.get('discordId') || '').replace(/\D/g, '');
    if (!discordId) return;
    setBusyId(`${messageId}:add`);
    setError('');
    try {
      await request('/api/discord-events', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'addParticipant', messageId, discordId }),
      });
      event.currentTarget.reset();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  const jobStatus = String(resyncJob?.status || '');
  const jobBusy = jobStatus === 'pending' || jobStatus === 'running';

  return (
    <>
      <div className="toolbar devent-toolbar">
        <div className="toolbar-left">
          Сборы МП из Discord-канала
          {total ? ` · ${total} всего` : ''}
        </div>
        <div className="toolbar-right devent-toolbar-actions">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Название, ID, участник…"
          />
          <div className="devent-toolbar-status">
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
                setExpanded(null);
                void load(v, 1, query).catch((err) => setError((err as Error).message));
              }}
              options={[
                { value: 'completed', label: 'Проведённые' },
                { value: 'open', label: 'Идут сейчас' },
                { value: 'abandoned', label: 'Отменённые' },
                { value: 'all', label: 'Все' },
              ]}
            />
          </div>
          <div className="devent-toolbar-btns">
            {caps.delete ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busyDedupe}
                onClick={() => void requestDedupe()}
              >
                {busyDedupe ? 'Очистка…' : 'Удалить дубликаты'}
              </button>
            ) : null}
            {canResync ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busyResync || jobBusy}
                onClick={() => void requestResync()}
              >
                {jobBusy ? 'Пересборка…' : 'Пересобрать МП'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {resyncJob ? (
        <div className="field-hint" style={{ marginBottom: 12 }}>
          {JOB_LABEL[jobStatus] || jobStatus}
          {resyncJob.finished_at
            ? ` · ${new Date(String(resyncJob.finished_at)).toLocaleString('ru-RU')}`
            : ''}
          {resyncJob.result && typeof resyncJob.result === 'object' ? (
            <>
              {' · '}
              страниц {(resyncJob.result as Row).pages ?? '—'}
              {', сообщений '}
              {(resyncJob.result as Row).scanned ?? '—'}
              {', от источника '}
              {(resyncJob.result as Row).fromSource ?? '—'}
            </>
          ) : null}
          {resyncJob.error ? ` · ${String(resyncJob.error)}` : ''}
        </div>
      ) : null}

      <ErrorText value={error} />
      {notice ? <div className="field-hint" style={{ marginBottom: 12 }}>{notice}</div> : null}
      {events.map((item) => {
        const id = String(item.message_id);
        const open = expanded === id;
        const participants = (item.participants as Row[]) || [];
        const title = String(item.title || 'Без названия');
        const busy = busyId === id || busyId.startsWith(`${id}:`);
        return (
          <div className="card devent-card" key={id}>
            <div className="devent-card-top">
              <div className="devent-card-main">
                <h3>{title}</h3>
                <div className="devent-card-meta">
                  <span className={`badge ${
                    item.status === 'completed' ? 'badge-green'
                      : item.status === 'open' ? 'badge-amber'
                        : 'badge-muted'
                  }`}
                  >
                    {STATUS_LABEL[String(item.status)] || String(item.status)}
                  </span>
                  {' · '}
                  {new Date(String(item.message_created_at)).toLocaleString('ru-RU')}
                  {item.event_key ? ` · ${item.event_key}` : ''}
                  {' · '}
                  {Number(item.participant_count) || participants.length} уч.
                </div>
              </div>
              <div className="devent-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExpanded(open ? null : id)}
                >
                  {open ? 'Скрыть' : 'Состав'}
                </button>
                {caps.editStatus ? (
                  <Select
                    value={String(item.status)}
                    disabled={busy}
                    onChange={(v) => void setEventStatus(id, v)}
                    options={[
                      { value: 'completed', label: 'Проведено' },
                      { value: 'open', label: 'Идёт' },
                      { value: 'abandoned', label: 'Отменено' },
                    ]}
                  />
                ) : null}
                {caps.delete ? (
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Удалить"
                    disabled={busy}
                    onClick={() => void removeEvent(id, title)}
                  >
                    <NavIcon name="trash" />
                  </button>
                ) : null}
              </div>
            </div>
            {open ? (
              <div className="devent-card-body">
                {participants.map((p) => {
                  const discordId = String(p.discord_id);
                  const onSite = !!p.on_site || !!p.user_id;
                  const nickname = p.nickname
                    ? String(p.nickname)
                    : (p.discord_username ? String(p.discord_username) : `Discord ${discordId}`);
                  const subtitle = [
                    onSite
                      ? (p.role_name ? String(p.role_name) : 'В составе')
                      : 'Ещё не на сайте',
                    p.discord_username && String(p.discord_username) !== nickname
                      ? String(p.discord_username)
                      : null,
                    `Discord ${discordId}`,
                  ].filter(Boolean).join(' · ');
                  const profileHref = p.user_id ? `/app/profile/${p.user_id}` : null;
                  const who = (
                    <>
                      <Avatar
                        row={{
                          nickname,
                          avatar_url: p.avatar_url,
                          avatar_image_id: p.avatar_image_id,
                        }}
                        size={32}
                      />
                      <span className="member-copy">
                        <span className="nickname">{nickname}</span>
                        <span className="role-tag">{subtitle}</span>
                      </span>
                    </>
                  );
                  return (
                    <div className="roster-row" key={`${id}:${discordId}`}>
                      {profileHref ? (
                        <a className="who member-profile-trigger who-clickable" href={profileHref}>
                          {who}
                        </a>
                      ) : (
                        <div className="who">{who}</div>
                      )}
                      {!onSite ? <span className="badge badge-muted">не на сайте</span> : null}
                      {caps.editParticipants ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-btn danger"
                            title="Убрать из состава"
                            disabled={busy}
                            onClick={() => void removeParticipant(id, discordId, nickname)}
                          >
                            <NavIcon name="trash" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!participants.length && <div className="field-hint">Участников нет</div>}
                {caps.editParticipants ? (
                  <form
                    className="inline-form"
                    style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
                    onSubmit={(e) => void addParticipant(e, id)}
                  >
                    <div className="field" style={{ margin: 0, minWidth: 200, flex: 1 }}>
                      <label>Discord ID</label>
                      <input className="input" name="discordId" inputMode="numeric" required placeholder="123456789012345678" />
                    </div>
                    <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
                      <NavIcon name="plus" /> Добавить
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {!events.length && (
        <div className="empty-state">
          <h3>Записей нет</h3>
          <p>Бот ещё не зафиксировал сборы с выбранным статусом. Можно запустить «Пересобрать МП».</p>
        </div>
      )}

      {total > 0 ? (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <div className="toolbar-left">
            Страница {page} из {totalPages}
          </div>
          <div className="row-actions" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => {
                const next = page - 1;
                setPage(next);
                setExpanded(null);
                void load(status, next).catch((err) => setError((err as Error).message));
              }}
            >
              Назад
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page >= totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                setExpanded(null);
                void load(status, next).catch((err) => setError((err as Error).message));
              }}
            >
              Вперёд
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
