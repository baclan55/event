'use client';

import { useState } from 'react';
import { api } from '@/lib/client/api';
import { useAuth } from '@/components/AuthProvider';

export function ProfileNicknameForm({ initialNickname }: { initialNickname: string }) {
  const { refresh } = useAuth();
  const [nickname, setNickname] = useState(initialNickname);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put('/api/auth/me/nickname', { nickname });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="field">
        <label>Никнейм</label>
        <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Сохранение…' : 'Сохранить'}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
