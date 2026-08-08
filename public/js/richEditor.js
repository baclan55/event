// ============================================================================
// RichEditor — маленький редактор форматированного текста без внешних
// библиотек: панель (жирный/курсив/размер/шрифт/очистить форматирование)
// над contenteditable-полем. Любое форматирование применяется ТОЛЬКО к
// выделенному фрагменту текста — если ничего не выделено, кнопки/списки
// ничего не делают (ровно то, что просили: "выделить текст и только в
// выделенном менять").
//
// Используется вместо обычной <textarea> там, где раньше редактировали
// содержимое разделов (FAQ/Регламент/Первые шаги — contentSection.js) и
// текст правил (rules.js). Возвращаемый HTML сохраняется как есть, а
// финальную защиту от "лишних" тегов/атрибутов делает бэкенд
// (src/utils/richText.js, sanitizeRichText) — так что даже прямой запрос к
// API в обход этого редактора не пройдёт ничего, кроме разрешённого набора
// форматирования.
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

const RichEditor = {
  FONT_SIZES: [12, 14, 16, 18, 20, 24, 28, 32, 40],
  FONT_FAMILIES: [
    { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
    { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
    { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
    { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
    { label: 'Courier New', value: '"Courier New", Courier, monospace' },
    { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  ],

  // Создаёт разметку тулбара + поля редактирования и вставляет её в
  // container. initialHTML — уже безопасный HTML (пришедший с бэкенда).
  // Возвращает объект с методами getHTML()/focus() для дальнейшей работы.
  mount(container, initialHTML) {
    const uid = 'rte' + Math.random().toString(36).slice(2, 9);

    container.innerHTML = `
      <div class="rte" id="${uid}">
        <div class="rte-toolbar">
          <button type="button" class="rte-btn rte-btn-bold" data-cmd="bold" title="Жирный">Ж</button>
          <button type="button" class="rte-btn rte-btn-italic" data-cmd="italic" title="Курсив">К</button>
          <span class="rte-sep"></span>
          <select class="rte-select" data-role="size" title="Размер текста">
            <option value="">Размер</option>
            ${RichEditor.FONT_SIZES.map((px) => `<option value="${px}">${px}px</option>`).join('')}
          </select>
          <select class="rte-select" data-role="family" title="Шрифт">
            <option value="">Шрифт</option>
            ${RichEditor.FONT_FAMILIES.map((f) => `<option value="${escAttr(f.value)}">${esc(f.label)}</option>`).join('')}
          </select>
          <span class="rte-sep"></span>
          <button type="button" class="rte-btn rte-btn-clear" data-cmd="clear" title="Очистить форматирование">${ICONS.eraser()}</button>
          <span class="rte-sep"></span>
          <button type="button" class="rte-btn rte-btn-discord" title="Вставить ссылку на канал Discord">${ICONS.discord()}</button>
        </div>
        <div class="rte-discord-pop" data-role="discordPop" hidden>
          <div class="field">
            <label>Ссылка на канал Discord</label>
            <input type="text" class="input" data-role="discordUrl" placeholder="https://discord.com/channels/…">
          </div>
          <div class="field">
            <label>Название канала</label>
            <input type="text" class="input" data-role="discordLabel" placeholder="например: 🏆・победители">
          </div>
          <div class="error-text" data-role="discordErr"></div>
          <div class="rte-discord-pop-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-role="discordCancel">Отмена</button>
            <button type="button" class="btn btn-primary btn-sm" data-role="discordInsert">Вставить</button>
          </div>
        </div>
        <div class="rte-editor input" contenteditable="true" data-role="editor"></div>
      </div>`;

    const root = container.querySelector(`#${uid}`);
    const editorEl = root.querySelector('[data-role="editor"]');
    editorEl.innerHTML = initialHTML || '';
    // Ссылки-чипы, загруженные из уже сохранённого текста, тоже делаем
    // "неделимыми" при редактировании — см. пояснение у contentEditable
    // ниже, у только что вставленной ссылки.
    editorEl.querySelectorAll('a.discord-chip').forEach((a) => { a.setAttribute('contenteditable', 'false'); });

    let savedRange = null;

    function inEditor(node) {
      return !!node && editorEl.contains(node);
    }

    function currentSelectionRange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      if (sel.isCollapsed) return null;
      if (!inEditor(sel.anchorNode) || !inEditor(sel.focusNode)) return null;
      return sel.getRangeAt(0);
    }

    // Запоминаем последнее непустое выделение внутри редактора — нужно для
    // элементов <select>, которые сами забирают фокус при открытии списка
    // (в отличие от кнопок, где фокус не даём перехватить вовсе, см. ниже).
    function rememberSelection() {
      const range = currentSelectionRange();
      if (range) savedRange = range.cloneRange();
    }
    editorEl.addEventListener('mouseup', rememberSelection);
    editorEl.addEventListener('keyup', rememberSelection);

    function restoreSelection() {
      if (!savedRange) return false;
      editorEl.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return true;
    }

    // В отличие от currentSelectionRange() (нужна для кнопок форматирования,
    // где действие имеет смысл только над выделенным текстом), для вставки
    // ссылки достаточно места, куда её вставить — обычного схлопнутого
    // курсора. Поэтому здесь допускаем и sel.isCollapsed === true.
    function currentCaretOrSelectionRange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      if (!inEditor(sel.anchorNode) || !inEditor(sel.focusNode)) return null;
      return sel.getRangeAt(0);
    }

    function notifyChange() {
      root.dispatchEvent(new Event('rte-change'));
    }

    // Оборачивает текущее выделение в <span style="prop:value"> — работает
    // и для выделений, затрагивающих сразу несколько узлов/тегов. Приём:
    // помечаем выделение через execCommand('fontSize', ..., '7') — браузер
    // сам аккуратно разбивает выделение по границам существующих узлов и
    // вставляет <font size="7">…</font>; дальше просто заменяем эти <font>
    // на нужный <span> с нужным стилем.
    function applyStyleToSelection(styleProp, styleValue) {
      document.execCommand('fontSize', false, '7');
      root.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        span.style[styleProp] = styleValue;
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }

    // --- Кнопки (жирный/курсив/очистить) ------------------------------
    // mousedown + preventDefault — чтобы клик по кнопке не забирал фокус
    // с редактора и не сбрасывал выделение (иначе к моменту обработки
    // click-события выделения бы уже не было).
    root.querySelectorAll('.rte-btn[data-cmd]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!currentSelectionRange()) return; // ничего не выделено — не делаем ничего
        const cmd = btn.dataset.cmd;
        if (cmd === 'bold' || cmd === 'italic') {
          document.execCommand(cmd);
        } else if (cmd === 'clear') {
          document.execCommand('removeFormat');
        }
        notifyChange();
      });
    });

    // --- Выпадающие списки (размер/шрифт) ------------------------------
    // <select> при открытии сам забирает фокус, поэтому восстанавливаем
    // сохранённое выделение перед применением стиля. После применения
    // возвращаем список к плейсхолдеру — он работает как разовое действие,
    // а не как индикатор текущего размера/шрифта (для смешанного выделения
    // единого значения всё равно не существует).
    root.querySelector('[data-role="size"]').addEventListener('change', (e) => {
      const px = e.target.value;
      e.target.value = '';
      if (!px) return;
      if (!restoreSelection()) return;
      applyStyleToSelection('fontSize', px + 'px');
      notifyChange();
    });

    root.querySelector('[data-role="family"]').addEventListener('change', (e) => {
      const family = e.target.value;
      e.target.value = '';
      if (!family) return;
      if (!restoreSelection()) return;
      applyStyleToSelection('fontFamily', family);
      notifyChange();
    });

    // --- Ссылка на канал Discord ("чип") --------------------------------
    // Кнопка открывает небольшую панель прямо под тулбаром (не всплывающее
    // модальное окно поверх — этот редактор сам обычно уже находится внутри
    // модалки Modal, а она умеет показывать только одно окно за раз, второе
    // просто закрыло бы первое вместе с несохранёнными правками).
    const discordBtn = root.querySelector('.rte-btn-discord');
    const discordPop = root.querySelector('[data-role="discordPop"]');
    const discordUrlInput = root.querySelector('[data-role="discordUrl"]');
    const discordLabelInput = root.querySelector('[data-role="discordLabel"]');
    const discordErr = root.querySelector('[data-role="discordErr"]');
    let discordInsertRange = null;

    function closeDiscordPop() {
      discordPop.hidden = true;
      discordErr.textContent = '';
    }

    discordBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // не терять фокус/выделение раньше времени
      const range = currentCaretOrSelectionRange();
      discordInsertRange = range ? range.cloneRange() : null;
      discordUrlInput.value = '';
      discordLabelInput.value = range && !range.collapsed ? range.toString() : '';
      discordErr.textContent = '';
      discordPop.hidden = false;
      discordUrlInput.focus();
    });

    // БАГФИКС: discordInsertRange раньше запоминался только один раз — в
    // момент клика по иконке Discord (открытие попапа). Если в этот момент
    // курсор ещё не стоял в тексте (или стоял не там), место вставки
    // навсегда оставалось "не определено": попытка поставить курсор в
    // тексте ПОСЛЕ открытия попапа никак на discordInsertRange не влияла —
    // клик по "Вставить" читал всё ту же пустую переменную и снова выдавал
    // "поставьте курсор", как ни старайся. Поэтому, пока попап открыт,
    // обновляем discordInsertRange при каждой перестановке курсора в
    // редакторе (клик или клавиши со стрелками) — тогда повторная попытка
    // после ошибки действительно подхватывает новое место.
    function refreshInsertRangeIfPopupOpen() {
      if (discordPop.hidden) return;
      const range = currentCaretOrSelectionRange();
      if (range) {
        discordInsertRange = range.cloneRange();
        discordErr.textContent = '';
      }
    }
    editorEl.addEventListener('mouseup', refreshInsertRangeIfPopupOpen);
    editorEl.addEventListener('keyup', refreshInsertRangeIfPopupOpen);

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
      if (!discordInsertRange) {
        discordErr.textContent = 'Не удалось определить место вставки — поставьте курсор в текст и попробуйте снова.';
        return;
      }

      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.className = 'discord-chip';
      link.textContent = label;
      // Ссылка ведёт себя как единый "чип": курсор заходит только до/после
      // неё, а не внутрь по буквам, и Backspace удаляет её целиком — то же
      // поведение, что у упоминаний каналов в самом Discord. Через
      // setAttribute, а не через свойство .contentEditable — так надёжнее
      // работает во всех браузерах.
      link.setAttribute('contenteditable', 'false');

      editorEl.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(discordInsertRange);
      discordInsertRange.deleteContents();
      discordInsertRange.insertNode(link);

      // Ставим курсор сразу после вставленного чипа (через неразрывный
      // пробел — обычный пробел браузер иногда "теряет" на границе с
      // contenteditable=false узлом), чтобы можно было сразу продолжить
      // печатать текст дальше, а не оказаться "внутри" ссылки.
      const spacer = document.createTextNode('\u00A0');
      link.after(spacer);
      const afterRange = document.createRange();
      afterRange.setStartAfter(spacer);
      afterRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(afterRange);

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

    // Пока идёт редактирование, чип не должен никуда переходить по клику —
    // иначе вместо того, чтобы поставить курсор рядом с ним, человек
    // случайно уходил бы на канал Discord. На самой странице (вне
    // редактора) этот обработчик не висит, там ссылка работает как обычно.
    editorEl.addEventListener('click', (e) => {
      if (e.target.closest('a.discord-chip')) e.preventDefault();
    });

    // --- Enter — всегда просто перенос строки, без <div>/<p> -----------
    editorEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertLineBreak');
        notifyChange();
      }
    });

    // --- Вставка — всегда как обычный текст, без стороннего форматирования
    editorEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
      notifyChange();
    });

    editorEl.addEventListener('input', notifyChange);

    return {
      el: root,
      getHTML() { return editorEl.innerHTML; },
      focus() { editorEl.focus(); },
      onChange(fn) { root.addEventListener('rte-change', fn); },
    };
  },
};
