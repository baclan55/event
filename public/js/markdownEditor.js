// ============================================================================
// MarkdownEditor — редактор текста без внешних библиотек: панель (жирный/
// курсив/зачёркнутый/заголовок/списки/цитата/код/ссылка на Discord) над
// обычным <textarea> с Markdown-разметкой, плюс переключатель
// "Написать/Просмотр" (просмотр запрашивает готовый HTML с бэкенда — тот же
// рендер, что увидят на странице после сохранения, см. renderMarkdown в
// src/utils/richText.js и POST /api/markdown/preview).
//
// Пришло на замену прежнему contenteditable-редактору (см. историю
// public/js/richEditor.js) — используется там же: содержимое разделов
// (FAQ/Регламент/Первые шаги — contentSection.js) и текст правил
// (rules.js). Кастомный размер/шрифт из старого редактора здесь больше не
// поддерживается (у Markdown нет для этого разметки) — форматирование
// теперь стандартное: заголовки/жирный/курсив/зачёркнутый/списки/цитаты/
// код/таблицы/ссылки.
//
// Возвращаемый Markdown-текст сохраняется как есть (это просто текст, не
// исполняется) — безопасным его делает санитизация HTML, в который он
// превращается ТОЛЬКО на этапе отображения (renderMarkdown на бэке
// прогоняет результат через sanitize-html) — так что даже прямой запрос к
// API в обход этого редактора не может привести к чему-то большему, чем
// разрешённый набор форматирования.
// ============================================================================

// ============================================================================
// Проверка ссылки на канал/сервер Discord — используется только для того,
// чтобы форма сразу подсказала пользователю, если ссылка не похожа на
// дискордовую, ДО отправки на сервер. Настоящая (и единственная надёжная)
// проверка — на бэкенде, см. isDiscordChannelUrl в src/utils/richText.js;
// логика здесь продублирована и должна совпадать с ней. Если меняете
// правило в одном месте — поменяйте и в другом.
// ============================================================================
const DISCORD_HOST_RE = /^(?:www\.)?(?:canary\.|ptb\.)?discord(?:app)?\.com$/i;

function isDiscordChannelUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (DISCORD_HOST_RE.test(host)) {
    return /^\/channels\/\d+\/\d+(?:\/\d+)?\/?$/.test(u.pathname);
  }
  if (host === 'discord.gg' || host === 'www.discord.gg') {
    return /^\/[a-zA-Z0-9-]{2,40}\/?$/.test(u.pathname);
  }
  return false;
}

const MarkdownEditor = {
  // Создаёт разметку тулбара + textarea/просмотра и вставляет её в
  // container. initialMarkdown — исходный текст (bodyRaw с бэкенда).
  // Возвращает объект с методами getMarkdown()/focus() для дальнейшей работы.
  mount(container, initialMarkdown) {
    const uid = 'mde' + Math.random().toString(36).slice(2, 9);

    container.innerHTML = `
      <div class="mde" id="${uid}">
        <div class="mde-toolbar">
          <button type="button" class="mde-btn mde-btn-bold" data-md="bold" title="Жирный">Ж</button>
          <button type="button" class="mde-btn mde-btn-italic" data-md="italic" title="Курсив">К</button>
          <button type="button" class="mde-btn mde-btn-strike" data-md="strike" title="Зачёркнутый">S</button>
          <span class="mde-sep"></span>
          <button type="button" class="mde-btn" data-md="heading" title="Заголовок">H</button>
          <button type="button" class="mde-btn" data-md="quote" title="Цитата">&rdquo;</button>
          <button type="button" class="mde-btn" data-md="ul" title="Маркированный список">&bull;</button>
          <button type="button" class="mde-btn" data-md="ol" title="Нумерованный список">1.</button>
          <button type="button" class="mde-btn mde-btn-code" data-md="code" title="Код">&lt;/&gt;</button>
          <span class="mde-sep"></span>
          <button type="button" class="mde-btn mde-btn-discord" title="Вставить ссылку на канал Discord">${ICONS.discord()}</button>
          <span class="mde-toolbar-spacer"></span>
          <div class="segmented mde-tabs">
            <button type="button" data-tab="write" class="active">Написать</button>
            <button type="button" data-tab="preview">Просмотр</button>
          </div>
        </div>
        <div class="mde-discord-pop" data-role="discordPop" hidden>
          <div class="field">
            <label>Ссылка на канал Discord</label>
            <input type="text" class="input" data-role="discordUrl" placeholder="https://discord.com/channels/…">
          </div>
          <div class="field">
            <label>Название канала</label>
            <input type="text" class="input" data-role="discordLabel" placeholder="например: 🏆・победители">
          </div>
          <div class="error-text" data-role="discordErr"></div>
          <div class="mde-discord-pop-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-role="discordCancel">Отмена</button>
            <button type="button" class="btn btn-primary btn-sm" data-role="discordInsert">Вставить</button>
          </div>
        </div>
        <textarea class="mde-textarea input" data-role="textarea" spellcheck="true"></textarea>
        <div class="mde-preview md-body" data-role="preview" hidden></div>
      </div>
      <div class="field-hint">Поддерживается Markdown: **жирный**, *курсив*, # Заголовок, списки, &gt; цитата, \`код\`. Ссылка на канал Discord — через кнопку со значком Discord на панели выше (другие ссылки при показе превращаются в обычный текст).</div>`;

    const root = container.querySelector(`#${uid}`);
    const textarea = root.querySelector('[data-role="textarea"]');
    const preview = root.querySelector('[data-role="preview"]');
    textarea.value = initialMarkdown || '';

    function notifyChange() {
      root.dispatchEvent(new Event('mde-change'));
    }

    // --- Написать / Просмотр --------------------------------------------
    // Просмотр запрашивается у бэкенда (POST /api/markdown/preview) — это
    // тот же renderMarkdown, что рендерит страницу после сохранения, так
    // что предпросмотр всегда совпадает с итогом (включая обработку ссылок:
    // не-Discord ссылка в просмотре тоже станет обычным текстом).
    const tabButtons = root.querySelectorAll('[data-tab]');
    function setTab(tab) {
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      if (tab === 'preview') {
        textarea.hidden = true;
        preview.hidden = false;
        preview.innerHTML = '<div class="empty-state">Загрузка…</div>';
        api.post('/api/markdown/preview', { body: textarea.value })
          .then((res) => {
            preview.innerHTML = res.html || '<span style="color:var(--text-faint)">Текст пока не добавлен.</span>';
          })
          .catch((e) => {
            preview.innerHTML = `<div class="error-text">Не удалось загрузить просмотр: ${esc(e.message)}</div>`;
          });
      } else {
        textarea.hidden = false;
        preview.hidden = true;
      }
    }
    tabButtons.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

    // --- Вспомогательные функции работы с textarea -----------------------

    // Оборачивает выделение маркерами markdown (например ** для жирного).
    // Если ничего не выделено — вставляет маркеры с текстом-подсказкой
    // внутри и сразу выделяет её, чтобы можно было просто начать печатать
    // (как это делают редакторы Markdown на GitHub и подобных сервисах).
    function wrapSelection(before, after, placeholder) {
      after = after == null ? before : after;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const hasSelection = start !== end;
      const inner = hasSelection ? value.slice(start, end) : placeholder;
      const next = value.slice(0, start) + before + inner + after + value.slice(end);
      textarea.value = next;
      const selStart = start + before.length;
      const selEnd = selStart + inner.length;
      textarea.focus();
      textarea.setSelectionRange(selStart, selEnd);
      notifyChange();
    }

    // Добавляет префикс (например "- " или "> ") к началу каждой строки,
    // затронутой текущим выделением — так работает список/цитата, даже
    // если выделено сразу несколько строк.
    function prefixLines(prefix, numbered) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      let lineStart = value.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = value.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = value.length;
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split('\n');
      const newBlock = lines.map((line, i) => (numbered ? `${i + 1}. ${line}` : `${prefix}${line}`)).join('\n');
      const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
      textarea.value = next;
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + newBlock.length);
      notifyChange();
    }

    root.querySelectorAll('.mde-btn[data-md]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switch (btn.dataset.md) {
          case 'bold': wrapSelection('**', '**', 'жирный текст'); break;
          case 'italic': wrapSelection('*', '*', 'курсив'); break;
          case 'strike': wrapSelection('~~', '~~', 'зачёркнутый текст'); break;
          case 'code': wrapSelection('`', '`', 'код'); break;
          case 'heading': prefixLines('## '); break;
          case 'quote': prefixLines('> '); break;
          case 'ul': prefixLines('- '); break;
          case 'ol': prefixLines('', true); break;
        }
      });
    });

    // --- Ссылка на канал Discord ("чип") --------------------------------
    const discordBtn = root.querySelector('.mde-btn-discord');
    const discordPop = root.querySelector('[data-role="discordPop"]');
    const discordUrlInput = root.querySelector('[data-role="discordUrl"]');
    const discordLabelInput = root.querySelector('[data-role="discordLabel"]');
    const discordErr = root.querySelector('[data-role="discordErr"]');
    let discordInsertStart = null;
    let discordInsertEnd = null;

    function closeDiscordPop() {
      discordPop.hidden = true;
      discordErr.textContent = '';
    }

    discordBtn.addEventListener('click', () => {
      discordInsertStart = textarea.selectionStart;
      discordInsertEnd = textarea.selectionEnd;
      discordUrlInput.value = '';
      discordLabelInput.value = discordInsertStart !== discordInsertEnd
        ? textarea.value.slice(discordInsertStart, discordInsertEnd)
        : '';
      discordErr.textContent = '';
      discordPop.hidden = false;
      discordUrlInput.focus();
    });

    root.querySelector('[data-role="discordCancel"]').addEventListener('click', closeDiscordPop);

    root.querySelector('[data-role="discordInsert"]').addEventListener('click', () => {
      const url = discordUrlInput.value.trim();
      const label = discordLabelInput.value.trim();

      if (!isDiscordChannelUrl(url)) {
        discordErr.textContent = 'Это не похоже на ссылку канала Discord. Пример: https://discord.com/channels/…';
        return;
      }
      if (!label) {
        discordErr.textContent = 'Укажите название канала — оно будет показано вместо ссылки.';
        return;
      }

      const value = textarea.value;
      const markdownLink = `[${label}](${url})`;
      const start = discordInsertStart == null ? value.length : discordInsertStart;
      const end = discordInsertEnd == null ? value.length : discordInsertEnd;
      textarea.value = value.slice(0, start) + markdownLink + value.slice(end);
      textarea.focus();
      const caret = start + markdownLink.length;
      textarea.setSelectionRange(caret, caret);

      closeDiscordPop();
      notifyChange();
    });

    [discordUrlInput, discordLabelInput].forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          root.querySelector('[data-role="discordInsert"]').click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeDiscordPop();
        }
      });
    });

    textarea.addEventListener('input', notifyChange);

    return {
      el: root,
      getMarkdown() { return textarea.value; },
      focus() { textarea.focus(); },
      onChange(fn) { root.addEventListener('mde-change', fn); },
    };
  },
};
