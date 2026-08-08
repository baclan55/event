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
        </div>
        <div class="rte-editor input" contenteditable="true" data-role="editor"></div>
      </div>`;

    const root = container.querySelector(`#${uid}`);
    const editorEl = root.querySelector('[data-role="editor"]');
    editorEl.innerHTML = initialHTML || '';

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
