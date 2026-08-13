'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { ErrorText, request, type Row } from './shared';

export function BlacklistInteractive() {
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ userId: '', discordId: '', staticId: '', reason: '' });

  async function load() {
    const data = await request('/api/blacklist');
    setItems(data.items || []);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await request('/api/blacklist', {
        method: 'POST',
        body: JSON.stringify({
          userId: form.userId ? Number(form.userId) : null,
          discordId: form.discordId.trim() || null,
          staticId: form.staticId.trim() || null,
          reason: form.reason.trim(),
        }),
      });
      setForm({ userId: '', discordId: '', staticId: '', reason: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!confirm('Убрать из чёрного списка?')) return;
    try {
      await request(`/api/blacklist/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={add}>
        <div className="card-header"><h3>Добавить в ЧС</h3></div>
        <ErrorText value={error} />
        <div className="form-row-2">
          <div className="field">
            <label>ID пользователя на сайте</label>
            <input className="input" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value.replace(/\D/g, '') })} placeholder="необязательно" />
          </div>
          <div className="field">
            <label>Discord ID</label>
            <input className="input" value={form.discordId} onChange={(e) => setForm({ ...form, discordId: e.target.value.trim() })} placeholder="необязательно" />
          </div>
          <div className="field">
            <label>StaticID</label>
            <input className="input" value={form.staticId} maxLength={6} onChange={(e) => setForm({ ...form, staticId: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="2–6 цифр" />
          </div>
          <div className="field">
            <label>Причина</label>
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>
        <div className="field-hint">Нужен хотя бы один идентификатор. Таким людям нельзя выдать роли; заявки отклоняются автоматически.</div>
        <button className="btn btn-primary btn-sm" type="submit"><NavIcon name="plus" /> Добавить</button>
      </form>
      {items.map((item) => (
        <div className="roster-row" key={item.id}>
          <div className="who">
            <div>
              <div className="nickname">
                {item.user_nickname || 'Внешний'}
                {item.user_id ? ` · #${item.user_id}` : ''}
              </div>
              <div className="role-tag">
                {[item.discord_id && `Discord ${item.discord_id}`, item.static_id && `Static ${item.static_id}`, item.reason]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
          <div className="row-actions">
            <button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button>
          </div>
        </div>
      ))}
      {!items.length && <div className="empty-state"><h3>Список пуст</h3></div>}
    </>
  );
}
