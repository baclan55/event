'use client';

import {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { MarkdownEditor } from '@/components/MarkdownEditor';

export type Row = Record<string, any>;

/** Поиск: все слова запроса должны встретиться в любом из полей. */
export function matchesSearch(fields: unknown[], query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = fields.map((v) => String(v ?? '').toLowerCase()).join(' · ');
  return q.split(/\s+/).filter(Boolean).every((token) => hay.includes(token));
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Поиск…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-input">
      <span aria-hidden>⌕</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

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
  xl = false,
  editor = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Ещё шире — сетка доступов ролей. */
  xl?: boolean;
  /** Крупная панель под Markdown (FAQ / регламент / правила МП). */
  editor?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sizeClass = editor ? ' editor' : xl ? ' xl' : wide ? ' wide' : '';
  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal-dialog${sizeClass}`} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="icon-btn modal-close" onClick={onClose}>×</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

type SelectOption = { value: string; label: string; disabled?: boolean };

/** Кастомный выпадающий список в стиле сайта (нативный option-list не красится). */
export function Select({
  name,
  value,
  defaultValue,
  options,
  onChange,
  required,
  placeholder = 'Выберите',
  disabled,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [internal, setInternal] = useState(defaultValue || '');
  const current = value !== undefined ? value : internal;
  const selected = options.find((opt) => opt.value === current);

  useEffect(() => setMounted(true), []);

  const placeMenu = useCallback(() => {
    const trigger = rootRef.current?.querySelector('.ui-select-trigger') as HTMLElement | null;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuMax = 240;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceBelow < Math.min(menuMax, 160) && rect.top > spaceBelow;
    setMenuStyle({
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: rect.width,
      top: openUp ? undefined : rect.bottom + gap,
      bottom: openUp ? Math.max(8, window.innerHeight - rect.top + gap) : undefined,
      maxHeight: Math.min(menuMax, openUp ? rect.top - gap - 8 : spaceBelow),
      zIndex: 420,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
  }, [open, options.length, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onReposition = () => placeMenu();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, placeMenu]);

  function pick(next: string) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
    setOpen(false);
  }

  const menu = open ? (
    <ul className="ui-select-menu ui-select-menu-portal" role="listbox" ref={menuRef} style={menuStyle}>
      {options.map((opt) => (
        <li key={opt.value}>
          <button
            type="button"
            role="option"
            aria-selected={opt.value === current}
            className={`ui-select-option${opt.value === current ? ' is-active' : ''}`}
            disabled={opt.disabled}
            onClick={() => pick(opt.value)}
          >
            {opt.label}
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div className={`ui-select${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`} ref={rootRef}>
      <select
        id={id}
        className="ui-select-native"
        name={name}
        required={required}
        disabled={disabled}
        value={current}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => pick(event.target.value)}
        tabIndex={-1}
        aria-hidden
      >
        {!current ? <option value="">{placeholder}</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        ))}
      </select>
      <button
        type="button"
        className="ui-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? '' : 'is-placeholder'}>{selected?.label || placeholder}</span>
        <span className="ui-select-chevron" aria-hidden>▾</span>
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
};

let confirmSetter: ((state: ConfirmState | null) => void) | null = null;

/** Стилизованная замена window.confirm. */
export function askConfirm(
  message: string,
  opts?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmSetter) {
      resolve(window.confirm(message));
      return;
    }
    confirmSetter({
      title: opts?.title || 'Подтверждение',
      message,
      confirmLabel: opts?.confirmLabel || 'Подтвердить',
      cancelLabel: opts?.cancelLabel || 'Отмена',
      danger: opts?.danger !== false,
      resolve,
    });
  });
}

export function ConfirmHost() {
  const [state, setState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    confirmSetter = setState;
    return () => {
      confirmSetter = null;
    };
  }, []);

  const close = useCallback((ok: boolean) => {
    setState((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  if (!state) return null;
  return createPortal(
    <div className="modal-overlay confirm-overlay" onMouseDown={(event) => event.target === event.currentTarget && close(false)}>
      <div className="modal-dialog confirm-modal" role="dialog" aria-modal="true" aria-label={state.title}>
        <div className={`confirm-icon${state.danger ? '' : ' confirm-icon-neutral'}`}>
          {state.danger ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3 2.5 19.5A1 1 0 0 0 3.4 21h17.2a1 1 0 0 0 .9-1.5L12 3Z" />
              <line x1="12" y1="9.5" x2="12" y2="13.5" />
              <line x1="12" y1="16.5" x2="12" y2="16.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5" />
              <path d="M12 16h.01" />
            </svg>
          )}
        </div>
        <h2>{state.title}</h2>
        <p className="modal-sub">{state.message}</p>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>{state.cancelLabel}</button>
          <button
            type="button"
            className={state.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => close(true)}
            autoFocus
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
