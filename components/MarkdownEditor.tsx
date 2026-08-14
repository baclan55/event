'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';

const COLOR_SWATCHES: Array<{ key: string; label: string; color: string }> = [
  { key: 'red', label: 'Красный', color: '#f87171' },
  { key: 'orange', label: 'Оранжевый', color: '#fb923c' },
  { key: 'amber', label: 'Янтарный', color: '#fbbf24' },
  { key: 'green', label: 'Зелёный', color: '#34d399' },
  { key: 'cyan', label: 'Бирюзовый', color: '#22d3ee' },
  { key: 'blue', label: 'Синий', color: '#60a5fa' },
  { key: 'purple', label: 'Фиолетовый', color: '#a78bfa' },
  { key: 'pink', label: 'Розовый', color: '#e879c0' },
  { key: 'white', label: 'Белый', color: '#f5f3fb' },
  { key: 'muted', label: 'Серый', color: '#8a83a3' },
];

export function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!showPreview) return;
    const timer = window.setTimeout(
      () => api.post('/api/markdown/preview', { body: value }).then((d) => setPreview(d.html)).catch(() => setPreview('')),
      250,
    );
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

  function insertBlock(block: string) {
    const element = textarea.current;
    if (!element) return;
    const start = element.selectionStart;
    const needsNl = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    onChange(`${value.slice(0, start)}${needsNl}${block}${value.slice(start)}`);
    requestAnimationFrame(() => element.focus());
  }

  function applyColor(key: string) {
    wrap(`{${key}}`, '{/}', 'текст');
    setColorOpen(false);
  }

  return (
    <div className="mde">
      <div className="mde-toolbar">
        <button className="mde-btn mde-btn-bold" type="button" title="Жирный" onClick={() => wrap('**')}>B</button>
        <button className="mde-btn mde-btn-italic" type="button" title="Курсив" onClick={() => wrap('*')}>I</button>
        <button className="mde-btn mde-btn-strike" type="button" title="Зачёркнутый" onClick={() => wrap('~~')}>S</button>
        <button className="mde-btn" type="button" title="Подчёркнутый (++текст++)" onClick={() => wrap('++')}>U</button>
        <button className="mde-btn" type="button" title="Выделение (==текст==)" onClick={() => wrap('==')}>≡</button>
        <span className="mde-sep" />
        <button className="mde-btn" type="button" title="Заголовок H1" onClick={() => line('# ')}>H1</button>
        <button className="mde-btn" type="button" title="Заголовок H2" onClick={() => line('## ')}>H2</button>
        <button className="mde-btn" type="button" title="Заголовок H3" onClick={() => line('### ')}>H3</button>
        <span className="mde-sep" />
        <button className="mde-btn" type="button" title="Маркированный список" onClick={() => line('- ')}>•</button>
        <button className="mde-btn" type="button" title="Нумерованный список" onClick={() => line('1. ')}>1.</button>
        <button className="mde-btn" type="button" title="Чекбокс" onClick={() => line('- [ ] ')}>☑</button>
        <button className="mde-btn" type="button" title="Цитата" onClick={() => line('> ')}>❯</button>
        <span className="mde-sep" />
        <button className="mde-btn mde-btn-code" type="button" title="Инлайн-код" onClick={() => wrap('`')}>{'</>'}</button>
        <button className="mde-btn" type="button" title="Блок кода" onClick={() => wrap('\n```\n', '\n```\n', 'код')}>```</button>
        <button className="mde-btn" type="button" title="Ссылка" onClick={() => wrap('[', '](https://)', 'название')}>🔗</button>
        <button className="mde-btn" type="button" title="Картинка" onClick={() => wrap('![', '](https://)', 'описание')}>🖼</button>
        <button className="mde-btn" type="button" title="Таблица" onClick={() => insertBlock('| A | B |\n| --- | --- |\n| 1 | 2 |\n')}>▤</button>
        <button className="mde-btn" type="button" title="Разделитель" onClick={() => insertBlock('\n---\n')}>—</button>
        <button className="mde-btn" type="button" title="Спойлер" onClick={() => insertBlock('??? Заголовок спойлера\nскрытый текст\n???\n')}>▸</button>
        <span className="mde-sep" />
        <div className="mde-color-wrap">
          <button
            className="mde-btn mde-btn-color"
            type="button"
            title="Цвет текста ({red}текст{/})"
            aria-expanded={colorOpen}
            onClick={() => setColorOpen((v) => !v)}
          >
            A
          </button>
          {colorOpen ? (
            <div className="mde-color-pop" role="listbox" aria-label="Цвет текста">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch.key}
                  type="button"
                  className="mde-color-swatch"
                  title={swatch.label}
                  style={{ '--swatch': swatch.color } as React.CSSProperties}
                  onClick={() => applyColor(swatch.key)}
                >
                  <span style={{ background: swatch.color }} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <span className="mde-toolbar-spacer" />
        <div className="segmented mde-tabs">
          <button className={!showPreview ? 'active' : ''} type="button" onClick={() => { setShowPreview(false); setColorOpen(false); }}>Написать</button>
          <button className={showPreview ? 'active' : ''} type="button" onClick={() => { setShowPreview(true); setColorOpen(false); }}>Просмотр</button>
        </div>
      </div>
      {showPreview ? (
        <div className="mde-preview md-body" dangerouslySetInnerHTML={{ __html: preview }} />
      ) : (
        <textarea
          ref={textarea}
          className="input mde-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={'Markdown: **жирный**, *курсив*, {red}цвет{/}, ==выделение==, ++подчёркивание++, таблицы, списки, ![картинка](url)'}
        />
      )}
    </div>
  );
}
