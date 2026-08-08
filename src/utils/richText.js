const sanitizeHtml = require('sanitize-html');

// ============================================================================
// Форматирование текста (жирный/курсив/размер/шрифт) в текстовых разделах
// (FAQ, Регламент, Первые шаги — content_blocks.body) и в правилах МП
// (rules.body). Раньше эти поля были обычным текстом (esc() на фронте при
// отображении, простой <textarea> при редактировании). Теперь редактор —
// contenteditable с тулбаром (см. public/js/richEditor.js), и body хранит
// HTML. Разрешён только небольшой белый список тегов/стилей, достаточный
// для форматирования текста — никаких скриптов, ссылок, картинок и т.п.
// ============================================================================

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'span', 'br', 'a'];

// ============================================================================
// Ссылки на каналы Discord ("чипы", см. .discord-chip в style.css и кнопку
// со значком Discord в public/js/richEditor.js). Разрешаем тег <a>, но
// ТОЛЬКО когда его href и правда указывает на канал/сервер Discord — любая
// другая ссылка при сохранении превращается обратно в обычный текст (span
// без href). Из присланных атрибутов ничего не берём "как есть": href
// нормализуем и проверяем, а target/rel/class всегда проставляем сами —
// так итоговая ссылка всегда открывается в новой вкладке безопасным
// способом и всегда выглядит как чип, даже если запрос к API пришёл в обход
// самого редактора.
// Тот же список доменов и та же проверка продублированы на фронте, в
// public/js/richEditor.js (isDiscordChannelUrl) — чтобы форма подсказывала
// пользователю ровно то, что реально примет сервер. Если меняете правило
// здесь, поменяйте и там.
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
// не ссылка на Discord.
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

const SANITIZE_OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    span: ['style'],
    a: ['href', 'target', 'rel', 'class'],
  },
  allowedClasses: {
    a: ['discord-chip'],
  },
  // Ссылки допускаем только по https — этого достаточно и для discord.com,
  // и для discord.gg, а заодно исключает javascript:/data: и т.п.
  allowedSchemes: ['https'],
  transformTags: {
    a: transformDiscordAnchor,
  },
  allowedStyles: {
    span: {
      'font-weight': [/^bold$/],
      'font-style': [/^italic$/],
      // Размер задаётся только в px, только целыми числами — панель
      // редактора предлагает фиксированный набор размеров (см.
      // richEditor.js), это ограничение — просто дополнительная защита на
      // случай прямого запроса к API в обход интерфейса.
      'font-size': [/^\d{1,2}px$/],
      // Семейство шрифта — только буквы/цифры/пробелы/дефисы/запятые/кавычки,
      // чтобы исключить любые посторонние CSS-конструкции в значении.
      'font-family': [/^[a-zA-Zа-яА-ЯёЁ0-9 ,'"-]+$/],
    },
  },
  // Теги не из белого списка вырезаются, но их текстовое содержимое
  // остаётся (это и есть безопасное поведение по умолчанию у sanitize-html —
  // если очень нужно, скрипт/стиль всё равно вырезаются целиком со своим
  // содержимым, см. её документацию).
  disallowedTagsMode: 'discard',
};

// Очищает HTML, пришедший из редактора, перед сохранением в базу.
function sanitizeRichText(html) {
  return sanitizeHtml(String(html == null ? '' : html), SANITIZE_OPTIONS);
}

// Похоже ли на то, что строка уже содержит HTML-разметку (новый формат) —
// в отличие от старых записей, где body — обычный текст с "\n" в качестве
// переноса строки (как раньше вставлялось из <textarea>, без каких-либо
// тегов вообще).
const LOOKS_LIKE_HTML_RE = /<[a-zA-Z/][^<>]*>/;

// Приводит body из базы к безопасному HTML для отправки на фронтенд и
// вставки через innerHTML. Старые записи (до появления форматирования)
// хранятся как обычный текст — их нужно экранировать и превратить переносы
// строк в <br>, иначе они либо схлопнутся в пробел (обычное поведение HTML
// для "\n"), либо (в редких случаях, если в старом тексте случайно
// встретилась подстрока вида "<...>") могут быть неверно истолкованы как
// теги. Новые записи уже являются HTML, прошедшим через sanitizeRichText
// при сохранении, — их достаточно ещё раз (недорого) прогнать через тот же
// санитайзер для дополнительной защиты и вернуть как есть.
function toDisplayHtml(rawBody) {
  const body = String(rawBody == null ? '' : rawBody);
  if (!body) return '';
  const prepared = LOOKS_LIKE_HTML_RE.test(body)
    ? body
    : body.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
  return sanitizeRichText(prepared);
}

module.exports = { sanitizeRichText, toDisplayHtml };
