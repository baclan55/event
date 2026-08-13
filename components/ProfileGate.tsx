'use client';

import { FormEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { PublicUser } from '@/lib/authShared';
import { requiresLastName } from '@/lib/profileGame';

/** Незакрываемое окно первого заполнения игрового профиля. */
export function ProfileGate({ user }: { user: PublicUser }) {
  const router = useRouter();
  const needLast = requiresLastName({
    isEventHelper: user.isEventHelper,
    isAdministrator: user.isAdministrator,
  });
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [staticId, setStaticId] = useState(user.staticId || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/profile/game', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, staticId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить.');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay profile-gate-overlay">
      <div className="modal-dialog wide" role="dialog" aria-modal="true" aria-labelledby="profile-gate-title">
        <h2 id="profile-gate-title">Игровые данные</h2>
        <p className="modal-sub">
          Укажите имя{needLast ? ', фамилию' : ''} и StaticID — без этого кабинет недоступен.
        </p>
        <form onSubmit={submit}>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="field">
            <label>Имя</label>
            <input className="input" required maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          {needLast ? (
            <div className="field">
              <label>Фамилия</label>
              <input className="input" required maxLength={60} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          ) : null}
          <div className="field">
            <label>StaticID</label>
            <input
              className="input"
              required
              inputMode="numeric"
              pattern="\d{2,6}"
              maxLength={6}
              value={staticId}
              onChange={(e) => setStaticId(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <div className="field-hint">Только цифры, 2–6 символов</div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
