// @ts-nocheck
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

// ============================================================================
// Форматирование текста в текстовых разделах (FAQ, Регламент, Первые шаги —
// content_blocks.body) и в правилах МП (rules.body).
//
// История формата поля body:
//  1) Совсем старые записи — обычный текст, перенос строки через "\n"
//     (простой <textarea> при редактировании, esc() на фронте при показе).
//  2) Затем — HTML из contenteditable-редактора с тулбаром (жирный/курсив/
//     размер/шрифт/ссылка на Discord), см. историю public/js/richEditor.js.
//     body хранил уже готовый (прошедший через sanitizeLegacyRichText) HTML.
//  3) Теперь — редактор снова текстовый, но это Markdown (см.
//     public/js/markdownEditor.js). body хранит исходный Markdown-текст "как
//     есть" (без какой-либо санитизации при сохранении — это просто текст,
//     он не исполняется и не рендерится сам по себе; безопасным его делает
//     санитизация HTML, полученного из него, на этапе ОТОБРАЖЕНИЯ, см.
//     renderBody ниже). Кастомный размер/шрифт из формата (2) в Markdown
//     аналога не имеет и при переходе на новый формат теряется — остаются
//     заголовки/жирный/курсив/зачёркивание/списки/цитаты/код/таблицы/ссылки.
//
// Чтобы отличить старый HTML (формат 2, для него нужен старый рендер и
// специальная конвертация в Markdown при открытии на редактирование) от
// нового Markdown-текста (форматы 1 и 3 — их можно просто отдавать в
// markdown-it как есть, включая совсем старый чистый текст: без
// markdown-разметки он отрендерится практически так же, как раньше),
// используется простая эвристика — looksLikeLegacyHtml ниже.
// ============================================================================

// ============================================================================
// Ссылки на каналы Discord ("чипы", см. .discord-chip в style.css и кнопку
// со значком Discord в public/js/markdownEditor.js). И в Markdown-, и в
// HTML-формате разрешаем ссылку ТОЛЬКО когда её href и правда указывает на
// канал/сервер Discord — любая другая ссылка при отображении превращается
// обратно в обычный текст (span без href). Из присланных атрибутов ничего
// не берём "как есть": href нормализуем и проверяем, а target/rel/class
// всегда проставляем сами — так итоговая ссылка всегда открывается в новой
// вкладке безопасным способом и всегда выглядит как чип, даже если запрос к
// API пришёл в обход самого редактора.
// Тот же список доменов и та же проверка продублированы на фронте, в
// public/js/markdownEditor.js (isDiscordChannelUrl) — чтобы форма
// подсказывала пользователю ровно то, что реально примет сервер. Если
// меняете правило здесь, поменяйте и там.
// ============================================================================
const DISCORD_HOST_RE = /^(?:www\.)?(?:canary\.|ptb\.)?discord(?:app)?\.com$/i;

function isDiscordChannelUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl == null ? '' : rawUrl).trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (DISCORD_HOST_RE.test(host)) {
    // /channels/<guildId>/<channelId>[/<messageId>] — ссылка на конкретный
    // канал сервера. Ссылки на личные сообщения (/channels/@me/...)
    // намеренно не поддерживаются: это не то, что вставляют в регламент.
    return /^\/channels\/\d+\/\d+(?:\/\d+)?\/?$/.test(u.pathname);
  }
  if (host === 'discord.gg' || host === 'www.discord.gg') {
    // Инвайт-ссылка на сервер.
    return /^\/[a-zA-Z0-9-]{2,40}\/?$/.test(u.pathname);
  }
  return false;
}

// Приводит присланный <a> к безопасному виду или превращает его в обычный
// span (текст внутри остаётся, просто перестаёт быть ссылкой), если href —
// не ссылка на Discord. Используется и в новом (Markdown), и в старом
// (legacy HTML) пайплайне ниже — правило одно и то же для обоих форматов.
// Discord-ссылки → чип; обычные http(s) → безопасная ссылка; остальное → текст.
function transformDiscordAnchor(tagName, attribs) {
  const href = String(attribs.href == null ? '' : attribs.href).trim();
  if (isDiscordChannelUrl(href)) {
    return {
      tagName: 'a',
      attribs: {
        href,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        class: 'discord-chip',
      },
    };
  }
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return {
        tagName: 'a',
        attribs: {
          href,
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      };
    }
  } catch {
    /* ignore */
  }
  return { tagName: 'span', attribs: {} };
}

// ============================================================================
// НОВЫЙ формат — Markdown (см. MarkdownEditor).
// ============================================================================

const NAMED_COLORS = {
  red: '#f87171',
  orange: '#fb923c',
  amber: '#fbbf24',
  yellow: '#facc15',
  green: '#34d399',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  purple: '#a78bfa',
  pink: '#e879c0',
  white: '#f5f3fb',
  muted: '#8a83a3',
  accent: '#a78bfa',
};

function resolveColorToken(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (NAMED_COLORS[value]) return NAMED_COLORS[value];
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
  return null;
}

function isSafeCssColor(value) {
  const v = String(value || '').trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)
    || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(v);
}

/** `{#ff0000}текст{/}` или `{red}текст{/}` — цветной span. */
function colorPlugin(md) {
  function tokenize(state, silent) {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x7B /* { */) return false;

    const open = /^(?:\{#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\}|\{([a-z]{2,12})\})/.exec(state.src.slice(start));
    if (!open) return false;
    const color = resolveColorToken(open[1] ? `#${open[1]}` : open[2]);
    if (!color) return false;

    const contentStart = start + open[0].length;
    const closeIdx = state.src.indexOf('{/}', contentStart);
    if (closeIdx < 0) return false;
    // Не пересекаем границу абзаца — цвет только inline.
    if (state.src.slice(contentStart, closeIdx).includes('\n')) return false;

    if (!silent) {
      const tokenOpen = state.push('md_color_open', 'span', 1);
      tokenOpen.attrs = [['style', `color:${color}`], ['class', 'md-color']];
      const tokenText = state.push('text', '', 0);
      tokenText.content = state.src.slice(contentStart, closeIdx);
      state.push('md_color_close', 'span', -1);
    }

    state.pos = closeIdx + 3;
    return true;
  }

  md.inline.ruler.before('emphasis', 'md_color', tokenize);
  md.renderer.rules.md_color_open = (tokens, idx) => {
    const style = tokens[idx].attrGet('style') || '';
    const cls = tokens[idx].attrGet('class') || 'md-color';
    return `<span class="${cls}" style="${style}">`;
  };
  md.renderer.rules.md_color_close = () => '</span>';
}

/** `==текст==` → <mark> */
function markPlugin(md) {
  function tokenize(state, silent) {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '==') return false;
    if (start + 4 > state.posMax) return false;

    let end = -1;
    for (let i = start + 2; i < state.posMax - 1; i += 1) {
      if (state.src[i] === '\n') return false;
      if (state.src.slice(i, i + 2) === '==') {
        end = i;
        break;
      }
    }
    if (end < 0 || end === start + 2) return false;

    if (!silent) {
      state.push('mark_open', 'mark', 1);
      const tokenText = state.push('text', '', 0);
      tokenText.content = state.src.slice(start + 2, end);
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  }
  md.inline.ruler.before('emphasis', 'md_mark', tokenize);
}

/** `++текст++` → <u> */
function underlinePlugin(md) {
  function tokenize(state, silent) {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '++') return false;
    let end = -1;
    for (let i = start + 2; i < state.posMax - 1; i += 1) {
      if (state.src[i] === '\n') return false;
      if (state.src.slice(i, i + 2) === '++') {
        end = i;
        break;
      }
    }
    if (end < 0 || end === start + 2) return false;
    if (!silent) {
      state.push('u_open', 'u', 1);
      const tokenText = state.push('text', '', 0);
      tokenText.content = state.src.slice(start + 2, end);
      state.push('u_close', 'u', -1);
    }
    state.pos = end + 2;
    return true;
  }
  md.inline.ruler.before('emphasis', 'md_underline', tokenize);
}

/** `- [ ]` / `- [x]` → чекбоксы в списках. */
function taskListPlugin(md) {
  md.core.ruler.after('inline', 'md_task_lists', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children?.length) continue;
      const first = token.children[0];
      if (!first || first.type !== 'text') continue;
      const m = /^\[([ xX])\]\s+/.exec(first.content);
      if (!m) continue;
      const checked = m[1].toLowerCase() === 'x';
      first.content = first.content.slice(m[0].length);
      const open = new state.Token('html_inline', '', 0);
      open.content = `<label class="md-task"><input type="checkbox" disabled${checked ? ' checked' : ''}/><span>`;
      const close = new state.Token('html_inline', '', 0);
      close.content = '</span></label>';
      token.children = [open, ...token.children, close];
      // помечаем родительский li
      // ищем ближайший list_item_open до этого inline — через tokens обход снаружи
    }
    for (let i = 0; i < state.tokens.length; i += 1) {
      const t = state.tokens[i];
      if (t.type !== 'list_item_open') continue;
      const inline = state.tokens[i + 2];
      if (inline?.type === 'inline' && inline.children?.[0]?.type === 'html_inline'
        && String(inline.children[0].content).includes('md-task')) {
        t.attrJoin('class', 'md-task-item');
      }
    }
  });
}

// html:true — нужны <span style="color"> / чекбоксы задач; XSS режет sanitize-html.
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: true,
});
md.enable(['table', 'strikethrough']);
md.use(colorPlugin);
md.use(markPlugin);
md.use(underlinePlugin);
md.use(taskListPlugin);

// Глубина цитирования в начале строки (`>`, `> >`, `>>` …).
function blockquoteDepth(line) {
  let depth = 0;
  let i = 0;
  const s = String(line);
  while (i < s.length) {
    let spaces = 0;
    while (spaces < 3 && s[i] === ' ') {
      i += 1;
      spaces += 1;
    }
    if (s[i] !== '>') break;
    depth += 1;
    i += 1;
    if (s[i] === ' ') i += 1;
  }
  return depth;
}

// CommonMark «лениво» продолжает вложенную цитату: после `> > foo`
// строка `> bar` остаётся внутри 2-го уровня. Для регламентов это
// выглядит как баг. Перед рендером при уменьшении глубины вставляем
// пустую строку цитаты нужного уровня (`>`), чтобы закрыть вложенность.
function fixNestedBlockquoteLazyContinuation(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let prevDepth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      prevDepth = 0;
      continue;
    }
    const depth = blockquoteDepth(line);
    if (prevDepth > depth) {
      if (depth > 0) {
        out.push(`${'> '.repeat(depth).trimEnd()}`);
      } else {
        out.push('');
      }
    }
    out.push(line);
    prevDepth = depth;
  }
  return out.join('\n');
}

// Теги, которые может породить рендер Markdown (+ безопасные inline-цвета).
// Картинки разрешены только по http(s) — внешний хотлинк, без javascript:.
const MARKDOWN_ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 's', 'del', 'u', 'mark', 'sub', 'sup', 'kbd', 'abbr',
  'span', 'a', 'img',
  'ul', 'ol', 'li',
  'blockquote',
  'code', 'pre',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'dl', 'dt', 'dd',
  'figure', 'figcaption',
  'label', 'input',
];

const MARKDOWN_SANITIZE_OPTIONS = {
  allowedTags: MARKDOWN_ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'class', 'title'],
    code: ['class'],
    span: ['style', 'class'],
    mark: ['class'],
    img: ['src', 'alt', 'title'],
    th: ['align', 'colspan', 'rowspan'],
    td: ['align', 'colspan', 'rowspan'],
    ol: ['start', 'type'],
    li: ['class'],
    label: ['class'],
    input: ['type', 'checked', 'disabled'],
    abbr: ['title'],
  },
  allowedClasses: {
    a: ['discord-chip'],
    code: [/^language-[\w-]*$/],
    span: ['md-color'],
    mark: ['md-mark'],
    li: ['md-task-item'],
    label: ['md-task'],
  },
  allowedSchemes: ['https', 'http'],
  allowedSchemesByTag: {
    img: ['https', 'http'],
    a: ['https', 'http'],
  },
  allowedStyles: {
    span: {
      color: [/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, /^rgba?\(/i],
      'background-color': [/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, /^rgba?\(/i],
    },
  },
  transformTags: {
    a: transformDiscordAnchor,
    span: (tagName, attribs) => {
      const style = String(attribs.style || '');
      const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
      const bgMatch = /(?:^|;)\s*background-color\s*:\s*([^;]+)/i.exec(style);
      const parts = [];
      if (colorMatch && isSafeCssColor(colorMatch[1])) parts.push(`color:${colorMatch[1].trim()}`);
      if (bgMatch && isSafeCssColor(bgMatch[1])) parts.push(`background-color:${bgMatch[1].trim()}`);
      if (!parts.length) return { tagName: 'span', attribs: {} };
      return {
        tagName: 'span',
        attribs: { class: 'md-color', style: parts.join(';') },
      };
    },
    input: (tagName, attribs) => {
      if (String(attribs.type || '').toLowerCase() !== 'checkbox') {
        return { tagName: 'span', attribs: {} };
      }
      const next = { type: 'checkbox', disabled: 'disabled' };
      if (attribs.checked != null || attribs.checked === '') next.checked = 'checked';
      return { tagName: 'input', attribs: next };
    },
  },
  disallowedTagsMode: 'discard',
};

// Рендерит Markdown-исходник в безопасный HTML для отображения.
function renderMarkdown(source) {
  const text = String(source == null ? '' : source);
  if (!text.trim()) return '';
  const rawHtml = md.render(fixNestedBlockquoteLazyContinuation(text));
  return sanitizeHtml(rawHtml, MARKDOWN_SANITIZE_OPTIONS);
}

// Приводит присланный из markdown-редактора текст к виду для сохранения в
// БД. Это НЕ HTML-санитизация (сохраняем как обычный текст, безопасным его
// делает renderMarkdown при отображении) — только нормализация переносов
// строк.
function normalizeMarkdownSource(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n');
}

// ============================================================================
// СТАРЫЙ формат — HTML из прежнего contenteditable-редактора (и совсем
// старый чистый текст до его появления). Оставлено только для отображения и
// для конвертации в Markdown при первом открытии такой записи на
// редактирование — новых записей в этом формате больше не появляется.
// ============================================================================

const LEGACY_ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'span', 'br', 'a'];

const LEGACY_SANITIZE_OPTIONS = {
  allowedTags: LEGACY_ALLOWED_TAGS,
  allowedAttributes: {
    span: ['style'],
    a: ['href', 'target', 'rel', 'class'],
  },
  allowedClasses: {
    a: ['discord-chip'],
  },
  allowedSchemes: ['https'],
  transformTags: {
    a: transformDiscordAnchor,
  },
  allowedStyles: {
    span: {
      'font-weight': [/^bold$/],
      'font-style': [/^italic$/],
      'font-size': [/^\d{1,2}px$/],
      'font-family': [/^[a-zA-Zа-яА-ЯёЁ0-9 ,'"-]+$/],
    },
  },
  disallowedTagsMode: 'discard',
};

function sanitizeLegacyHtml(html) {
  return sanitizeHtml(String(html == null ? '' : html), LEGACY_SANITIZE_OPTIONS);
}

// Похоже ли на то, что строка — HTML старого формата (2), а не Markdown-
// текст (форматы 1 и 3, которые дальше просто идут в renderMarkdown).
// Markdown сам по себе почти никогда не содержит "<тег>" — угловые скобки
// в обычном тексте единичны и полностью экранируются при рендере, так что
// ложных срабатываний в другую сторону можно не бояться.
// Старый contenteditable: только inline-теги. Структурный HTML (p/ul/h…) —
// это либо ошибочно сохранённый render, либо Markdown; его нельзя гонять
// через legacy-sanitize (он выкинет p/ul/h и «съест» оформление).
const LOOKS_LIKE_LEGACY_INLINE_RE = /<(?:b|strong|i|em|span|br|a)\b/i;
const LOOKS_LIKE_STRUCTURAL_HTML_RE = /<(?:p|div|ul|ol|li|h[1-6]|blockquote|table|pre|hr)\b/i;

function looksLikeLegacyHtml(body) {
  const s = String(body == null ? '' : body);
  if (!s.trim()) return false;
  if (LOOKS_LIKE_STRUCTURAL_HTML_RE.test(s)) return false;
  return LOOKS_LIKE_LEGACY_INLINE_RE.test(s);
}

function looksLikeStructuralHtml(body) {
  return LOOKS_LIKE_STRUCTURAL_HTML_RE.test(String(body == null ? '' : body));
}

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&nbsp;/gi, '\u00A0')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// Лучшее возможное (не идеальное, но достаточное) преобразование старого
// HTML (уже прошедшего через sanitizeLegacyHtml, то есть ограниченного
// LEGACY_ALLOWED_TAGS) в Markdown-эквивалент — нужно только для того, чтобы
// при первом открытии старой записи в новом редакторе форма показывала
// осмысленный текст, а не сырые теги. Кастомный размер/шрифт (font-size/
// font-family у span) аналога в Markdown не имеет и отбрасывается — текст
// при этом не теряется, теряется только это конкретное оформление.
// Как только запись пересохранят из нового редактора, body будет содержать
// уже настоящий Markdown-исходник, и эта функция для неё больше не
// понадобится.
function legacyHtmlToMarkdown(html) {
  let s = sanitizeLegacyHtml(html);
  if (!s) return '';

  // Ссылка-чип: подпись всегда простой текст без вложенных тегов (см.
  // markdownEditor.js/старый richEditor.js — подпись чипа всегда
  // textContent), поэтому её можно безопасно захватить нежадным [^<]*.
  s = s.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/gi, (_, href, label) =>
    `[${decodeHtmlEntities(label)}](${href})`
  );

  // Перенос строки.
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // Жирный/курсив — и через <b>/<strong>/<i>/<em>, и через span[style].
  // Проход повторяется несколько раз, чтобы корректно разворачивались
  // случаи с одним уровнем вложенности (например, span с размером текста
  // вокруг <b>) — на каждой итерации внутренние теги уже становятся
  // обычным текстом, и следующий проход "видит" внешний тег.
  for (let i = 0; i < 4; i++) {
    let changed = false;
    s = s.replace(/<span([^>]*)>([^<]*)<\/span>/gi, (_, attrs, inner) => {
      changed = true;
      const styleMatch = /style="([^"]*)"/i.exec(attrs || '');
      const style = styleMatch ? styleMatch[1] : '';
      let out = inner;
      if (/font-weight\s*:\s*bold/i.test(style)) out = `**${out}**`;
      if (/font-style\s*:\s*italic/i.test(style)) out = `*${out}*`;
      return out;
    });
    s = s.replace(/<(?:b|strong)>([^<]*)<\/(?:b|strong)>/gi, (_, inner) => { changed = true; return `**${inner}**`; });
    s = s.replace(/<(?:i|em)>([^<]*)<\/(?:i|em)>/gi, (_, inner) => { changed = true; return `*${inner}*`; });
    if (!changed) break;
  }

  // На случай чего-то неучтённого — снимаем оставшиеся теги, не трогая их
  // содержимое (дополнительная подстраховка, в норме тут уже ничего нет).
  s = s.replace(/<[^>]+>/g, '');

  return decodeHtmlEntities(s).trim();
}

// ============================================================================
// Публичный API модуля.
// ============================================================================

// Рендерит body из базы в безопасный HTML для отображения на фронтенде
// (вставляется через innerHTML). Определяет формат автоматически: старый
// HTML — через старый рендер (визуально ничего не меняется для уже
// сохранённого контента), всё остальное (новый Markdown-текст и совсем
// старый чистый текст без какой-либо разметки) — через renderMarkdown.
function renderBody(rawBody) {
  const body = String(rawBody == null ? '' : rawBody);
  if (!body.trim()) return '';
  // Уже готовый структурный HTML (в т.ч. если в БД попал результат рендера).
  if (looksLikeStructuralHtml(body)) {
    return sanitizeHtml(body, MARKDOWN_SANITIZE_OPTIONS);
  }
  if (looksLikeLegacyHtml(body)) return sanitizeLegacyHtml(body);
  return renderMarkdown(body);
}

// Возвращает body в виде, пригодном для показа в textarea markdown-редактора
// при открытии на редактирование: для старого HTML — конвертирует в
// Markdown-эквивалент (см. legacyHtmlToMarkdown), для всего остального —
// отдаёт как есть (это уже исходный текст, который и хранится, и
// редактируется).
function rawBodyForEdit(rawBody) {
  const body = String(rawBody == null ? '' : rawBody);
  if (!body) return '';
  return looksLikeLegacyHtml(body) ? legacyHtmlToMarkdown(body) : body;
}

export {
  renderBody,
  rawBodyForEdit,
  normalizeMarkdownSource,
  renderMarkdown,
  isDiscordChannelUrl,
  NAMED_COLORS,
};
