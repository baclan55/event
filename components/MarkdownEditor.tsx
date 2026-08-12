'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  useEffect(() => {
    if (!showPreview) return;
    const timer = window.setTimeout(() => api.post('/api/markdown/preview', { body: value }).then((d) => setPreview(d.html)).catch(() => setPreview('')), 250);
    return () => window.clearTimeout(timer);
  }, [value, showPreview]);
  return <div className="mde">
    <div className="mde-toolbar"><b>Markdown</b><span className="mde-toolbar-spacer" />
      <button className="mde-btn" type="button" onClick={() => setShowPreview(false)}>Написать</button>
      <button className="mde-btn" type="button" onClick={() => setShowPreview(true)}>Просмотр</button>
    </div>
    {showPreview ? <div className="mde-preview md-body" dangerouslySetInnerHTML={{ __html: preview }} /> :
      <textarea className="input mde-textarea" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Текст в формате Markdown" />}
  </div>;
}
