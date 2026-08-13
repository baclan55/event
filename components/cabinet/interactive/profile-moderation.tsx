'use client';

import { useEffect, useMemo, useState } from 'react';
import { ErrorText, matchesSearch, request, SearchBox, type Row } from './shared';

export function ProfileModerationInteractive() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => rows.filter((item) => matchesSearch([
      item.nickname,
      item.discord_username,
      item.first_name,
      item.last_name,
      item.static_id,
    ], query)),
    [rows, query],
  );

  async function load() {
    const data = await request('/api/profile/moderation');
    setRows(data.requests || []);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  async function decide(id: number, status: 'approved' | 'rejected') {
    try {
      await request('/api/profile/moderation', {
        method: 'PUT',
        body: JSON.stringify({ id, status }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{filtered.length}{query.trim() ? ` / ${rows.length}` : ''} заявок</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Ник, имя, Static…" />
        </div>
      </div>
      <ErrorText value={error} />
      {filtered.map((item) => (
        <div className="roster-row" key={item.id}>
          <div className="who">
            <div>
              <div className="nickname">{item.nickname || item.discord_username}</div>
              <div className="role-tag">
                {[item.first_name, item.last_name, item.static_id && `#${item.static_id}`].filter(Boolean).join(' · ')}
                {' · '}
                {new Date(item.created_at).toLocaleString('ru-RU')}
              </div>
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void decide(item.id, 'approved')}>Одобрить</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void decide(item.id, 'rejected')}>Отклонить</button>
          </div>
        </div>
      ))}
      {!filtered.length && <div className="empty-state"><h3>{query.trim() ? 'Ничего не найдено' : 'Заявок нет'}</h3></div>}
    </>
  );
}
