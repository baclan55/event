'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { DEFAULT_CLOSED_MESSAGE } from '@/lib/auditShared';
import { askConfirm, Avatar, ErrorText, matchesSearch, request, SearchBox, type Row } from './shared';

const STATUS_LABEL: Record<string, string> = {
  pending: 'На рассмотрении',
  approved: 'Одобрена',
  rejected: 'Отклонена',
  call_passed: 'Обзвон пройден',
  call_failed: 'Обзвон не пройден',
};

function statusBadgeClass(status: string) {
  if (status === 'approved' || status === 'call_passed') return 'badge-green';
  if (status === 'rejected' || status === 'call_failed') return 'badge-red';
  return 'badge-muted';
}

export function ApplicationsInteractive({
  initialRows,
  initialIsOpen = true,
  initialClosedMessage = DEFAULT_CLOSED_MESSAGE,
  candidates = false,
  history = false,
}: {
  initialRows: Row[];
  initialIsOpen?: boolean;
  initialClosedMessage?: string;
  candidates?: boolean;
  history?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [isOpen, setIsOpen] = useState(initialIsOpen);
  const [closedMessage, setClosedMessage] = useState(initialClosedMessage);
  const [draftMessage, setDraftMessage] = useState(initialClosedMessage);
  const [error, setError] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => rows.filter((item) => matchesSearch([
      item.nickname_static,
      item.applicant_name,
      item.discord,
      item.static_id,
      item.first_name,
      item.age,
      item.avg_online,
      item.motivation,
      item.status,
      STATUS_LABEL[String(item.status)],
      item.reject_reason,
      item.reviewed_by_nickname,
    ], query)),
    [rows, query],
  );

  const reload = useCallback(async () => {
    try {
      const url = candidates
        ? '/api/applications/candidates'
        : history
          ? '/api/applications/history'
          : '/api/applications';
      const data = await request(url);
      setRows(candidates ? data.candidates || [] : data.applications || []);
      if (typeof data.isOpen === 'boolean') setIsOpen(data.isOpen);
      if (typeof data.closedMessage === 'string') {
        setClosedMessage(data.closedMessage);
        setDraftMessage(data.closedMessage);
      }
    } catch (err) { setError((err as Error).message); }
  }, [candidates, history]);
  useEffect(() => { void reload(); }, [reload]);

  async function update(id: number, status: string) {
    try { await request(`/api/applications/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function call(id: number, passed: boolean) {
    if (!(await askConfirm(passed ? 'Кандидат прошёл обзвон?' : 'Кандидат не прошёл обзвон?', {
      title: 'Подтверждение',
      confirmLabel: passed ? 'Да, прошёл' : 'Не прошёл',
      danger: !passed,
    }))) return;
    try { await request(`/api/applications/${id}/call`, { method: 'POST', body: JSON.stringify({ passed }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function remove(id: number) {
    if (!(await askConfirm('Удалить заявку?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try { await request(`/api/applications/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function toggle() {
    try {
      const data = await request('/api/applications/status', {
        method: 'PUT',
        body: JSON.stringify({ isOpen: !isOpen, closedMessage: draftMessage }),
      });
      setIsOpen(data.isOpen);
      if (typeof data.closedMessage === 'string') {
        setClosedMessage(data.closedMessage);
        setDraftMessage(data.closedMessage);
      }
    } catch (err) { setError((err as Error).message); }
  }
  async function saveMessage(event: FormEvent) {
    event.preventDefault();
    setSavingMessage(true); setError('');
    try {
      const data = await request('/api/applications/status', {
        method: 'PUT',
        body: JSON.stringify({ closedMessage: draftMessage }),
      });
      setClosedMessage(data.closedMessage || draftMessage);
      setDraftMessage(data.closedMessage || draftMessage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingMessage(false);
    }
  }

  const listLabel = candidates ? 'кандидатов' : history ? 'в истории' : 'заявок';

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{filtered.length}{query.trim() ? ` / ${rows.length}` : ''} {listLabel}</span>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={candidates ? 'Ник, Discord, Static…' : 'Ник, Discord, статус…'}
          />
        </div>
        {!candidates && !history && (
          <div className="toolbar-right">
            <span className={`badge ${isOpen ? 'badge-green' : 'badge-red'}`}>{isOpen ? 'Набор открыт' : 'Набор закрыт'}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void toggle()}>{isOpen ? 'Закрыть набор' : 'Открыть набор'}</button>
          </div>
        )}
      </div>
      <ErrorText value={error} />
      {!candidates && !history && (
        <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={saveMessage}>
          <div className="card-header">
            <h3>Сообщение при закрытом наборе</h3>
            <span className="badge badge-muted">/apply</span>
          </div>
          <div className="field">
            <textarea
              className="input"
              rows={2}
              maxLength={280}
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              placeholder={DEFAULT_CLOSED_MESSAGE}
            />
            <div className="field-hint">Показывается на странице заявки, пока набор закрыт. Сейчас: «{closedMessage}»</div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={savingMessage || draftMessage.trim() === closedMessage}>
            Сохранить сообщение
          </button>
        </form>
      )}
      {history && rows.length > 0 && (
        <div className="rp-legend">Архив одобренных и отклонённых заявок с сайта. Только просмотр.</div>
      )}
      {candidates && rows.length > 0 && <div className="rp-legend">После обзвона кандидат получает роль <b>Mini Event Helper</b> и автоматически попадает в состав либо снимается с рассмотрения.</div>}
      {filtered.map((item) => (
        <article className="rule-card" id={`app-${item.id}`} key={item.id}>
          <div className="rule-body">
            {candidates ? (
              <div className="who">
                <Avatar row={{ nickname: item.candidate_nickname || item.nickname_static, avatar_url: item.candidate_avatar_url, avatar_image_id: item.candidate_avatar_image_id }} />
                <div>
                  <h4>{item.candidate_nickname || item.nickname_static || item.applicant_name}</h4>
                  <div className="role-tag">Discord: {item.discord}</div>
                </div>
              </div>
            ) : (
              <>
                <h4>
                  {item.nickname_static || item.applicant_name}{' '}
                  <span className={`badge ${statusBadgeClass(String(item.status))}`}>
                    {STATUS_LABEL[String(item.status)] || item.status}
                  </span>
                </h4>
                <div className="rule-text">
                  <b>Discord:</b> {item.discord}<br />
                  <b>Имя:</b> {item.first_name || '—'} · <b>StaticID:</b> {item.static_id || '—'}<br />
                  <b>Возраст:</b> {item.age} · <b>Онлайн:</b> {item.avg_online}<br />
                  <b>Время в игре:</b> {item.time_period}<br />
                  <b>Опыт:</b> {item.experience}<br />
                  <b>Идеи:</b> {item.ideas}<br />
                  <b>Мотивация:</b> {item.motivation}
                  {item.reject_reason ? <><br /><b>Причина отказа:</b> {item.reject_reason}</> : null}
                </div>
              </>
            )}
            <div className="meta-line">
              {new Date(item.created_at).toLocaleString('ru-RU')}
              {item.reviewed_by_nickname ? ` · рассмотрел ${item.reviewed_by_nickname}` : ''}
            </div>
          </div>
          {!history && (
            <div className="rule-actions">
              {candidates ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => void call(item.id, true)}>Прошёл обзвон</button>
                  <button className="btn btn-danger btn-sm" onClick={() => void call(item.id, false)}>Не прошёл</button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => void update(item.id, 'approved')}>Одобрить</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void update(item.id, 'rejected')}>Отклонить</button>
                  <button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button>
                </>
              )}
            </div>
          )}
        </article>
      ))}
      {!filtered.length && (
        <div className="empty-state">
          <h3>{query.trim() ? 'Ничего не найдено' : (candidates ? 'Кандидатов нет' : history ? 'История пуста' : 'Заявок нет')}</h3>
        </div>
      )}
    </>
  );
}
