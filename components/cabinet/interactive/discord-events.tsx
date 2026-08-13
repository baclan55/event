'use client';

import { useEffect, useState } from 'react';
import { ErrorText, request, Select, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  completed: 'Проведено',
  open: 'Идёт',
  abandoned: 'Не проведено',
};

export function DiscordEventsInteractive() {
  const [events, setEvents] = useState<Row[]>([]);
  const [status, setStatus] = useState('completed');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load(nextStatus = status) {
    const data = await request(`/api/discord-events?status=${encodeURIComponent(nextStatus)}`);
    setEvents(data.events || []);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">Сборы МП из Discord-канала</div>
        <div className="row-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
        </div>
      </div>
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
          <p>Бот ещё не зафиксировал сборы с выбранным статусом.</p>
        </div>
      )}
    </>
  );
}
