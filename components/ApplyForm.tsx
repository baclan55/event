'use client';

import { FormEvent, useState } from 'react';
import { api } from '@/lib/client/api';

const fields = [
  ['nicknameStatic', 'Игровой никнейм'],
  ['age', 'Ваш возраст'],
  ['avgOnline', 'Средний онлайн'],
  ['timePeriod', 'Время, когда вы доступны'],
  ['experience', 'Опыт проведения мероприятий'],
  ['ideas', 'Идеи для мероприятий'],
  ['motivation', 'Почему хотите вступить в отдел'],
] as const;

/** Только форма заявки — кабинет/сайт без AuthProvider. */
export function ApplyForm() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api.post('/api/applications', { ...form, consent });
      setMessage(`Заявка #${result.id} отправлена на рассмотрение.`);
      setForm({});
      setConsent(false);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <form className="qform" onSubmit={submit}>
      {fields.map(([key, label]) => (
        <div className="qform-card" key={key}>
          <label className="qform-label">
            {label}
            <span className="qform-required">*</span>
          </label>
          <textarea
            className="input"
            required
            value={form[key] || ''}
            onChange={(event) => setForm({ ...form, [key]: event.target.value })}
          />
        </div>
      ))}
      <div className="qform-card">
        <label className="qform-check-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            required
          />
          Согласен на обработку персональных данных.
        </label>
      </div>
      {message ? (
        <p className={message.startsWith('Заявка') ? 'badge badge-green' : 'error-text'}>{message}</p>
      ) : null}
      <button className="btn btn-primary" type="submit">
        Отправить заявку
      </button>
    </form>
  );
}
