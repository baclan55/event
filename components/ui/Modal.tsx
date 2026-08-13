'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  editor = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** Крупная панель под Markdown-редактор (FAQ / регламент / правила МП). */
  editor?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sizeClass = editor ? ' editor' : wide ? ' wide' : '';
  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <section className={`modal-dialog${sizeClass}`} onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <h2>{title}</h2>
        {children}
      </section>
    </div>,
    document.body,
  );
}
