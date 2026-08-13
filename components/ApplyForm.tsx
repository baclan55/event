'use client';

import { FormEvent, useState } from 'react';
import { api } from '@/lib/client/api';

const fields = [
  ['nicknameStatic', 'Игровой никнейм'],
  ['firstName', 'Имя'],
  ['lastName', 'Фамилия'],
  ['staticId', 'StaticID'],
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
    const staticId = (form.staticId || '').trim();
    if (!/^\d{2,6}$/.test(staticId)) {
      setMessage('StaticID: только цифры, от 2 до 6 символов.');
      return;
    }
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
          {key === 'staticId' ? (
            <input
              className="input"
              required
              inputMode="numeric"
              pattern="\d{2,6}"
              maxLength={6}
              value={form[key] || ''}
              onChange={(event) => setForm({ ...form, [key]: event.target.value.replace(/\D/g, '').slice(0, 6) })}
            />
          ) : (
            <textarea
              className="input"
              required
              value={form[key] || ''}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          )}
          {key === 'staticId' ? <div className="field-hint">Только цифры, 2–6 символов</div> : null}
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
