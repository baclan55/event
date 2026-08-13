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
function transformDiscordAnchor(tagName, attribs) {
  if (isDiscordChannelUrl(attribs.href)) {
    return {
      tagName: 'a',
      attribs: {
        href: String(attribs.href).trim(),
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        class: 'discord-chip',
      },
    };
  }
  return { tagName: 'span', attribs: {} };
}

// ============================================================================
// НОВЫЙ формат — Markdown (см. public/js/markdownEditor.js).
// ============================================================================

// html:false — сырой HTML в исходнике не парсится, а экранируется как
// обычный текст (это и есть первая линия защиты: даже если кто-то напишет
// "<script>..." прямо в Markdown-поле, на выходе будет "&lt;script&gt;...",
// а не исполняемый тег). linkify — голые ссылки (например, просто вставленный
// discord.gg/приглашение без markdown-скобок) тоже становятся кликабельными.
// breaks — одиночный перенос строки (Enter) становится <br>, без breaks
// markdown-it сжал бы его в пробел — так и раньше в этом редакторе Enter
// был обычным переносом строки, а не новым абзацем.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

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

// Теги, которые может породить рендер Markdown, плюс 'span' — то, во что
// превращается не-discord-ссылка (см. transformDiscordAnchor). Картинки
// (![]())  сознательно НЕ разрешены: для картинок в разделах уже есть
// отдельная, контролируемая загрузка (см. "Картинка" в contentSection.js/
// rules.js) — разрешать ещё и произвольные внешние картинки прямо в тексте
// значило бы разрешить хотлинк на что угодно в обход этого контроля.
const MARKDOWN_ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'em', 's', 'del',
  'span', 'a',
  'ul', 'ol', 'li',
  'blockquote',
  'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const MARKDOWN_SANITIZE_OPTIONS = {
  allowedTags: MARKDOWN_ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'class'],
    // class="language-xxx" — то, что markdown-it ставит на <code> внутри
    // блоков ```кода с указанным языком (```js ... ```). Подсветки синтаксиса
    // у нас нет, но сам класс безобиден и полезен, если она появится позже.
    code: ['class'],
  },
  allowedClasses: {
    a: ['discord-chip'],
    code: [/^language-[\w-]*$/],
  },
  allowedSchemes: ['https'],
  transformTags: { a: transformDiscordAnchor },
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
const LOOKS_LIKE_LEGACY_HTML_RE = /<[a-zA-Z/][^<>]*>/;

function looksLikeLegacyHtml(body) {
  return LOOKS_LIKE_LEGACY_HTML_RE.test(String(body == null ? '' : body));
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
  return looksLikeLegacyHtml(body) ? sanitizeLegacyHtml(body) : renderMarkdown(body);
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

export { renderBody, rawBodyForEdit, normalizeMarkdownSource, renderMarkdown, isDiscordChannelUrl };
