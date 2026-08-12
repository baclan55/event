'use client';

import { useCallback, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { Avatar, ErrorText, request, type Row } from './shared';

export function ApplicationsInteractive({ initialRows, initialIsOpen = true, candidates = false }: { initialRows: Row[]; initialIsOpen?: boolean; candidates?: boolean }) {
  const [rows, setRows] = useState(initialRows);
  const [isOpen, setIsOpen] = useState(initialIsOpen);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const data = await request(candidates ? '/api/applications/candidates' : '/api/applications');
      setRows(candidates ? data.candidates || [] : data.applications || []);
      if (typeof data.isOpen === 'boolean') setIsOpen(data.isOpen);
    } catch (err) { setError((err as Error).message); }
  }, [candidates]);
  useEffect(() => { void reload(); }, [reload]);
  async function update(id: number, status: string) {
    try { await request(`/api/applications/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function call(id: number, passed: boolean) {
    if (!confirm(passed ? 'Кандидат прошёл обзвон?' : 'Кандидат не прошёл обзвон?')) return;
    try { await request(`/api/applications/${id}/call`, { method: 'POST', body: JSON.stringify({ passed }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function remove(id: number) {
    if (!confirm('Удалить заявку?')) return;
    try { await request(`/api/applications/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function toggle() {
    try { const data = await request('/api/applications/status', { method: 'PUT', body: JSON.stringify({ isOpen: !isOpen }) }); setIsOpen(data.isOpen); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{rows.length} {candidates ? 'кандидатов ожидают обзвона' : 'заявок'}</div>{!candidates && <div className="toolbar-right"><span className={`badge ${isOpen ? 'badge-green' : 'badge-red'}`}>{isOpen ? 'Набор открыт' : 'Набор закрыт'}</span><button className="btn btn-ghost btn-sm" onClick={() => void toggle()}>{isOpen ? 'Закрыть набор' : 'Открыть набор'}</button></div>}</div>
      <ErrorText value={error} />
      {candidates && rows.length > 0 && <div className="rp-legend">После обзвона кандидат получает роль <b>Mini Event Helper</b> и автоматически попадает в состав либо снимается с рассмотрения.</div>}
      {rows.map((item) => <article className="rule-card" key={item.id}><div className="rule-body">{candidates ? <div className="who"><Avatar row={{ nickname: item.candidate_nickname || item.nickname_static, avatar_url: item.candidate_avatar_url, avatar_image_id: item.candidate_avatar_image_id }} /><div><h4>{item.candidate_nickname || item.nickname_static || item.applicant_name}</h4><div className="role-tag">Discord: {item.discord}</div></div></div> : <><h4>{item.nickname_static || item.applicant_name} <span className="badge badge-muted">{item.status}</span></h4><div className="rule-text"><b>Discord:</b> {item.discord}<br /><b>Возраст:</b> {item.age} · <b>Онлайн:</b> {item.avg_online}<br /><b>Время в игре:</b> {item.time_period}<br /><b>Опыт:</b> {item.experience}<br /><b>Идеи:</b> {item.ideas}<br /><b>Мотивация:</b> {item.motivation}</div></>}<div className="meta-line">{new Date(item.created_at).toLocaleString('ru-RU')}{item.reviewed_by_nickname ? ` · рассмотрел ${item.reviewed_by_nickname}` : ''}</div></div><div className="rule-actions">{candidates ? <><button className="btn btn-primary btn-sm" onClick={() => void call(item.id, true)}>Прошёл обзвон</button><button className="btn btn-danger btn-sm" onClick={() => void call(item.id, false)}>Не прошёл</button></> : <><button className="btn btn-primary btn-sm" onClick={() => void update(item.id, 'approved')}>Одобрить</button><button className="btn btn-ghost btn-sm" onClick={() => void update(item.id, 'rejected')}>Отклонить</button><button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button></>}</div></article>)}
      {!rows.length && <div className="empty-state"><h3>{candidates ? 'Кандидатов нет' : 'Заявок нет'}</h3></div>}
    </>
  );
}
