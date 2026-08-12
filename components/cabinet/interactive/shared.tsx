'use client';

import { ReactNode, useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';

export type Row = Record<string, any>;

export async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка запроса (${response.status})`);
  return data;
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="icon-btn modal-close" onClick={onClose}>×</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ row, size = 40 }: { row: Row; size?: number }) {
  const src = row.avatar_url || row.avatarUrl ||
    (row.avatar_image_id ? `/media/${row.avatar_image_id}` : null) ||
    (row.avatarImageId ? `/media/${row.avatarImageId}` : null);
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : String(row.nickname || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

export function ErrorText({ value }: { value: string }) {
  return value ? <p className="error-text">{value}</p> : null;
}

export function MarkdownFormField({ name, initialValue }: { name: string; initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <><MarkdownEditor value={value} onChange={setValue} /><input type="hidden" name={name} value={value} /></>;
}

export const DEFAULT_LIMITS = {
  helper: { verbalPoints: 1, strictPoints: 2, blockPoints: 4, verbalToStrict: 2 },
  admin: { points: 3, decayDays: 10 },
};

export function ReprimandBadge({ item }: { item: Row }) {
  if (item.type === 'verbal') {
    return <span className={`badge ${item.converted ? 'badge-muted' : 'badge-purple'}`}>{item.converted ? 'Устный · объединён' : 'Устный'}</span>;
  }
  if (item.type === 'strict') {
    return <span className="badge badge-red">{item.auto_generated ? 'Строгий · авто' : 'Строгий'}</span>;
  }
  return <span className={`badge ${item.active === false ? 'badge-muted' : 'badge-amber'}`}>{item.active === false ? 'Балл · списан' : 'Балл'}</span>;
}

export function ReprimandSummary({ items, tier, limits = DEFAULT_LIMITS }: { items: Row[]; tier: string; limits?: Row }) {
  if (tier === 'admin') {
    const active = items.filter((item) => item.type === 'point' && item.active !== false);
    return (
      <div className="rp-group-badges">
        <span className={`badge ${active.length >= limits.admin.points ? 'badge-red' : 'badge-purple'}`}>Баллов: {active.length}/{limits.admin.points}</span>
        <span className="badge badge-muted">списание через {limits.admin.decayDays} дней</span>
      </div>
    );
  }
  const verbal = items.filter((item) => item.type === 'verbal' && !item.converted).length;
  const converted = items.filter((item) => item.type === 'verbal' && item.converted).length;
  const strict = items.filter((item) => item.type === 'strict').length;
  const points = verbal * limits.helper.verbalPoints + strict * limits.helper.strictPoints;
  return (
    <div className="rp-group-badges">
      <span className={`badge ${points >= limits.helper.blockPoints ? 'badge-red' : 'badge-purple'}`}>Баллы: {points}/{limits.helper.blockPoints}</span>
      <span className="badge badge-muted">Устных: {verbal}{converted ? ` (+${converted})` : ''}</span>
      <span className="badge badge-muted">Строгих: {strict}</span>
    </div>
  );
}

export function ReprimandLegend({ tier, limits = DEFAULT_LIMITS }: { tier: string; limits?: Row }) {
  return tier === 'admin'
    ? <div className="rp-legend">Максимум <b>{limits.admin.points} баллов</b>. Каждый балл перестаёт учитываться через <b>{limits.admin.decayDays} дней</b>.</div>
    : <div className="rp-legend">Устный = <b>{limits.helper.verbalPoints} балл</b>, строгий = <b>{limits.helper.strictPoints} балла</b>. При <b>{limits.helper.blockPoints} баллах</b> учётная запись блокируется. Каждые <b>{limits.helper.verbalToStrict} устных</b> объединяются в строгий.</div>;
}
