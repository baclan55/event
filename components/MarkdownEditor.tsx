'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!showPreview) return;
    const timer = window.setTimeout(() => api.post('/api/markdown/preview', { body: value }).then((d) => setPreview(d.html)).catch(() => setPreview('')), 250);
    return () => window.clearTimeout(timer);
  }, [value, showPreview]);
  function wrap(before: string, after = before, fallback = 'текст') {
    const element = textarea.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end) || fallback;
    onChange(`${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }
  function line(prefix: string) {
    const element = textarea.current;
    if (!element) return;
    const start = value.lastIndexOf('\n', Math.max(0, element.selectionStart - 1)) + 1;
    onChange(`${value.slice(0, start)}${prefix}${value.slice(start)}`);
    requestAnimationFrame(() => element.focus());
  }

  return <div className="mde">
    <div className="mde-toolbar">
      <button className="mde-btn mde-btn-bold" type="button" title="Жирный" onClick={() => wrap('**')}>B</button>
      <button className="mde-btn mde-btn-italic" type="button" title="Курсив" onClick={() => wrap('*')}>I</button>
      <button className="mde-btn mde-btn-strike" type="button" title="Зачёркнутый" onClick={() => wrap('~~')}>S</button>
      <span className="mde-sep" />
      <button className="mde-btn" type="button" title="Заголовок" onClick={() => line('## ')}>H</button>
      <button className="mde-btn" type="button" title="Маркированный список" onClick={() => line('- ')}>• список</button>
      <button className="mde-btn" type="button" title="Нумерованный список" onClick={() => line('1. ')}>1.</button>
      <button className="mde-btn" type="button" title="Цитата" onClick={() => line('> ')}>❯</button>
      <button className="mde-btn mde-btn-code" type="button" title="Код" onClick={() => wrap('`')}>{'</>'}</button>
      <button className="mde-btn" type="button" title="Ссылка" onClick={() => wrap('[', '](https://)', 'название')}>🔗</button>
      <span className="mde-toolbar-spacer" />
      <div className="segmented mde-tabs">
        <button className={!showPreview ? 'active' : ''} type="button" onClick={() => setShowPreview(false)}>Написать</button>
        <button className={showPreview ? 'active' : ''} type="button" onClick={() => setShowPreview(true)}>Просмотр</button>
      </div>
    </div>
    {showPreview ? <div className="mde-preview md-body" dangerouslySetInnerHTML={{ __html: preview }} /> :
      <textarea ref={textarea} className="input mde-textarea" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Текст в формате Markdown" />}
  </div>;
}
