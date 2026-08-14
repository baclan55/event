'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/client/api';

const REQUIRED_KEYS = [
  'nicknameStatic',
  'firstName',
  'staticId',
  'age',
  'avgOnline',
  'timePeriod',
  'experience',
  'ideas',
  'motivation',
] as const;

type FieldKey = (typeof REQUIRED_KEYS)[number];

const TEXTAREA_FIELDS: FieldKey[] = ['experience', 'ideas', 'motivation'];

const REST_FIELDS: Array<[FieldKey, string]> = [
  ['age', 'Ваш возраст'],
  ['avgOnline', 'Средний онлайн'],
  ['timePeriod', 'Время, когда вы доступны'],
  ['experience', 'Опыт проведения мероприятий'],
  ['ideas', 'Идеи для мероприятий'],
  ['motivation', 'Почему хотите вступить в отдел'],
];

type ToastState = { text: string; tone: 'ok' | 'error' } | null;

/** Только форма заявки — кабинет/сайт без AuthProvider. */
export function ApplyForm() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.tone === 'ok' ? 4500 : 5500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const staticIdOk = /^\d{2,6}$/.test((form.staticId || '').trim());
  const canSubmit = useMemo(() => {
    if (!consent || !staticIdOk) return false;
    return REQUIRED_KEYS.every((key) => (form[key] || '').trim().length > 0);
  }, [consent, form, staticIdOk]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || saving) return;
    setToast(null);
    setSaving(true);
    try {
      await api.post('/api/applications', {
        ...form,
        lastName: '',
        consent,
      });
      setForm({});
      setConsent(false);
      setToast({ text: 'Заявка отправлена на рассмотрение.', tone: 'ok' });
    } catch (error) {
      setToast({ text: (error as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form className="qform" onSubmit={submit}>
        <div className="form-row-2 qform-row">
          <div className="qform-card">
            <label className="qform-label" htmlFor="apply-nickname">
              Игровой никнейм
              <span className="qform-required">*</span>
            </label>
            <input
              id="apply-nickname"
              className="input"
              required
              maxLength={80}
              autoComplete="nickname"
              value={form.nicknameStatic || ''}
              onChange={(e) => setField('nicknameStatic', e.target.value)}
            />
          </div>
          <div className="qform-card">
            <label className="qform-label" htmlFor="apply-static">
              StaticID
              <span className="qform-required">*</span>
            </label>
            <input
              id="apply-static"
              className="input"
              required
              inputMode="numeric"
              pattern="\d{2,6}"
              maxLength={6}
              value={form.staticId || ''}
              onChange={(e) => setField('staticId', e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <div className="field-hint">Только цифры, 2–6 символов</div>
          </div>
        </div>

        <div className="qform-card">
          <label className="qform-label" htmlFor="apply-firstname">
            Ваше имя
            <span className="qform-required">*</span>
          </label>
          <input
            id="apply-firstname"
            className="input"
            required
            maxLength={60}
            autoComplete="given-name"
            value={form.firstName || ''}
            onChange={(e) => setField('firstName', e.target.value)}
          />
        </div>

        {REST_FIELDS.map(([key, label]) => {
          const isTextarea = TEXTAREA_FIELDS.includes(key);
          return (
            <div className="qform-card" key={key}>
              <label className="qform-label" htmlFor={`apply-${key}`}>
                {label}
                <span className="qform-required">*</span>
              </label>
              {isTextarea ? (
                <textarea
                  id={`apply-${key}`}
                  className="input"
                  required
                  value={form[key] || ''}
                  onChange={(e) => setField(key, e.target.value)}
                />
              ) : (
                <input
                  id={`apply-${key}`}
                  className="input"
                  required
                  value={form[key] || ''}
                  onChange={(e) => setField(key, e.target.value)}
                />
              )}
            </div>
          );
        })}

        <div className="qform-card qform-consent">
          <label className="qform-check-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>Согласен на обработку персональных данных.</span>
          </label>
        </div>

        <button className="btn btn-primary" type="submit" disabled={!canSubmit || saving}>
          {saving ? 'Отправка…' : 'Отправить заявку'}
        </button>
      </form>

      {mounted && toast
        ? createPortal(
            <div className={`site-toast site-toast-${toast.tone}`} role="status" aria-live="polite">
              <span className="site-toast-text">{toast.text}</span>
              <button type="button" className="site-toast-close" aria-label="Закрыть" onClick={() => setToast(null)}>
                ×
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
