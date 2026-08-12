'use client';

import { useEffect } from 'react';

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-overlay" onMouseDown={onClose}>
    <section className={`modal-dialog${wide ? ' wide' : ''}`} onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-btn modal-close" onClick={onClose} aria-label="Закрыть">×</button>
      <h2>{title}</h2>{children}
    </section>
  </div>;
}
