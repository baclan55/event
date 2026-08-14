'use client';

import { useEffect, useMemo, useState } from 'react';
import { ErrorText, matchesSearch, request, SearchBox, type Row } from './shared';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

const STATUS_LABEL: Record<string, string> = {
  pending: 'На рассмотрении',
  approved: 'Одобрено',
  rejected: 'Отклонено',
};

function statusBadgeClass(status: string) {
  if (status === 'approved') return 'badge-green';
  if (status === 'rejected') return 'badge-red';
  if (status === 'pending') return 'badge-amber';
  return 'badge-muted';
}

export function ProfileModerationInteractive() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [canEdit, setCanEdit] = useState(false);

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    all: rows.length,
  }), [rows]);

  const filtered = useMemo(() => {
    const byStatus = filter === 'all'
      ? rows
      : rows.filter((item) => item.status === filter);
    return byStatus.filter((item) => matchesSearch([
      item.nickname,
      item.discord_username,
      item.first_name,
      item.last_name,
      item.static_id,
      item.reviewer_nickname,
      STATUS_LABEL[String(item.status)] || item.status,
    ], query));
  }, [rows, query, filter]);

  async function load() {
    const data = await request('/api/profile/moderation');
    setRows(data.requests || []);
    setCanEdit(!!data.canEdit);
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
          <span>{filtered.length}{query.trim() ? ` / ${counts[filter]}` : ''} заявок</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Ник, имя, Static…" />
        </div>
      </div>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button type="button" className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
          Активные · {counts.pending}
        </button>
        <button type="button" className={filter === 'approved' ? 'active' : ''} onClick={() => setFilter('approved')}>
          Одобренные · {counts.approved}
        </button>
        <button type="button" className={filter === 'rejected' ? 'active' : ''} onClick={() => setFilter('rejected')}>
          Отклонённые · {counts.rejected}
        </button>
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          Все · {counts.all}
        </button>
      </div>
      <ErrorText value={error} />
      {filter !== 'pending' && filtered.length > 0 ? (
        <div className="rp-legend" style={{ marginBottom: 12 }}>
          История решений по смене имени, фамилии и StaticID. Только просмотр.
        </div>
      ) : null}
      {filtered.map((item) => {
        const status = String(item.status || 'pending');
        const isPending = status === 'pending';
        return (
          <div className="roster-row" key={item.id}>
            <div className="who">
              <div>
                <div className="nickname">
                  {item.nickname || item.discord_username}{' '}
                  <span className={`badge ${statusBadgeClass(status)}`}>
                    {STATUS_LABEL[status] || status}
                  </span>
                </div>
                <div className="role-tag">
                  {[item.first_name, item.last_name, item.static_id && `#${item.static_id}`].filter(Boolean).join(' · ')}
                  {' · подано '}
                  {new Date(String(item.created_at)).toLocaleString('ru-RU')}
                  {!isPending && item.reviewed_at ? (
                    <>
                      {' · решено '}
                      {new Date(String(item.reviewed_at)).toLocaleString('ru-RU')}
                      {item.reviewer_nickname ? ` · ${item.reviewer_nickname}` : ''}
                    </>
                  ) : null}
                  {status === 'rejected' && item.reject_reason ? (
                    <> · причина: {String(item.reject_reason)}</>
                  ) : null}
                </div>
              </div>
            </div>
            {isPending && canEdit ? (
              <div className="row-actions">
                <button className="btn btn-primary btn-sm" onClick={() => void decide(Number(item.id), 'approved')}>Одобрить</button>
                <button className="btn btn-ghost btn-sm" onClick={() => void decide(Number(item.id), 'rejected')}>Отклонить</button>
              </div>
            ) : null}
          </div>
        );
      })}
      {!filtered.length && (
        <div className="empty-state">
          <h3>
            {query.trim()
              ? 'Ничего не найдено'
              : filter === 'pending'
                ? 'Активных заявок нет'
                : filter === 'approved'
                  ? 'Одобренных заявок нет'
                  : filter === 'rejected'
                    ? 'Отклонённых заявок нет'
                    : 'Заявок нет'}
          </h3>
        </div>
      )}
    </>
  );
}
