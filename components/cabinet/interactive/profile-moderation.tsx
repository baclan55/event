'use client';

import { useEffect, useState } from 'react';
import { ErrorText, request, type Row } from './shared';

export function ProfileModerationInteractive() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');

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
      <ErrorText value={error} />
      {rows.map((item) => (
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
      {!rows.length && <div className="empty-state"><h3>Заявок нет</h3></div>}
    </>
  );
}
