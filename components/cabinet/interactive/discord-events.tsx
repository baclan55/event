'use client';

import { useEffect, useState } from 'react';
import { askConfirm, ErrorText, request, Select, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  completed: 'Проведено',
  open: 'Идёт',
  abandoned: 'Не проведено',
};

const JOB_LABEL: Record<string, string> = {
  pending: 'В очереди у бота…',
  running: 'Бот собирает историю…',
  done: 'Пересборка завершена',
  failed: 'Ошибка пересборки',
};

export function DiscordEventsInteractive() {
  const [events, setEvents] = useState<Row[]>([]);
  const [status, setStatus] = useState('completed');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [canResync, setCanResync] = useState(false);
  const [resyncJob, setResyncJob] = useState<Row | null>(null);
  const [busyResync, setBusyResync] = useState(false);

  async function load(nextStatus = status) {
    const data = await request(`/api/discord-events?status=${encodeURIComponent(nextStatus)}`);
    setEvents(data.events || []);
    setCanResync(!!data.canResync);
    setResyncJob(data.resyncJob || null);
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
  }, [resyncJob?.status, status]);

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

  const jobStatus = String(resyncJob?.status || '');
  const jobBusy = jobStatus === 'pending' || jobStatus === 'running';

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">Сборы МП из Discord-канала</div>
        <div className="row-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v);
                void load(v).catch((err) => setError((err as Error).message));
              }}
              options={[
                { value: 'completed', label: 'Проведённые' },
                { value: 'open', label: 'Идут сейчас' },
                { value: 'abandoned', label: 'Не проведённые' },
                { value: 'all', label: 'Все' },
              ]}
            />
          </div>
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
      {events.map((item) => {
        const id = String(item.message_id);
        const open = expanded === id;
        const participants = (item.participants as Row[]) || [];
        return (
          <div className="card card-pad" key={id} style={{ marginBottom: 12 }}>
            <div className="card-header">
              <h3>{String(item.title || 'Без названия')}</h3>
              <span className={`badge ${
                item.status === 'completed' ? 'badge-green'
                  : item.status === 'open' ? 'badge-amber'
                    : 'badge-muted'
              }`}
              >
                {STATUS_LABEL[String(item.status)] || String(item.status)}
              </span>
            </div>
            <div className="role-tag">
              {new Date(String(item.message_created_at)).toLocaleString('ru-RU')}
              {item.event_key ? ` · ID ${item.event_key}` : ''}
              {' · '}
              участников: {Number(item.participant_count) || participants.length}
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setExpanded(open ? null : id)}
              >
                {open ? 'Скрыть состав' : 'Показать состав'}
              </button>
            </div>
            {open ? (
              <div style={{ marginTop: 10 }}>
                {participants.map((p) => (
                  <div className="role-tag" key={`${id}:${p.discord_id}`}>
                    {p.nickname ? String(p.nickname) : 'не в составе'}
                    {' · '}
                    Discord {String(p.discord_id)}
                  </div>
                ))}
                {!participants.length && <div className="field-hint">Участников нет</div>}
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
    </>
  );
}
