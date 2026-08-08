window.Sections = window.Sections || {};
window.Sections.rules = {
  async render(container) {
    let rules = [];
    const openIds = new Set(); // какие карточки сейчас развёрнуты (сохраняется между перерисовками)
    try {
      const data = await api.get('/api/rules');
      rules = data.rules;
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить правила</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    paint();

    function paint() {
      const admin = Auth.hasRoleIn(Auth.ROLE_GROUPS.edit);
      const listHTML = rules.length ? rules.map((r) => {
        const id = String(r.id);
        const isOpen = openIds.has(id);
        return `
        <div class="rules-card${isOpen ? ' open' : ''}" data-id="${id}">
          <div class="rules-card-header" data-toggle="${id}" role="button" tabindex="0" aria-expanded="${isOpen}">
            <div class="rules-thumb">${r.image_id
              ? `<img src="/media/${r.image_id}" alt="">`
              : ICONS.image()}</div>
            <h4 class="rules-title">${esc(r.title)}</h4>
            ${admin ? `
              <div class="rules-card-actions">
                <button type="button" class="icon-btn" data-edit="${id}" title="Редактировать">${ICONS.edit()}</button>
                <button type="button" class="icon-btn danger" data-del="${id}" title="Удалить">${ICONS.trash()}</button>
              </div>` : ''}
            <span class="rules-chevron">${ICONS.chevronDown()}</span>
          </div>
          <div class="rules-panel">
            <div class="rules-panel-inner">
              <div class="rules-panel-text">${r.body ? esc(r.body) : '<span style="color:var(--text-faint)">Описание не добавлено.</span>'}</div>
            </div>
          </div>
        </div>`;
      }).join('')
        : `<div class="empty-state"><h3>Правил пока нет</h3><p>Добавьте первое правило мероприятий.</p></div>`;

      container.innerHTML = `
        <div class="toolbar">
          <div class="toolbar-left">${rules.length} ${pluralRules(rules.length)}</div>
          ${admin ? `<div class="toolbar-right"><button type="button" class="btn btn-primary btn-sm" id="addRuleBtn">${ICONS.plus()} Добавить правило</button></div>` : ''}
        </div>
        ${listHTML}`;

      container.querySelector('#addRuleBtn')?.addEventListener('click', () => openEditModal(null));

      container.querySelectorAll('[data-toggle]').forEach((header) => {
        const id = header.dataset.toggle;
        const toggle = () => {
          const nowOpen = !openIds.has(id);
          if (nowOpen) openIds.add(id); else openIds.delete(id);
          header.closest('.rules-card').classList.toggle('open', nowOpen);
          header.setAttribute('aria-expanded', String(nowOpen));
        };
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      });

      container.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditModal(rules.find((r) => String(r.id) === btn.dataset.edit));
        });
      });
      container.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeRule(btn.dataset.del);
        });
      });
    }

    function pluralRules(n) {
      const mod10 = n % 10, mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'правило';
      if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'правила';
      return 'правил';
    }

    function openEditModal(rule) {
      const isNew = !rule;
      const overlay = Modal.open(`
        <h2>${isNew ? 'Новое правило' : 'Редактирование правила'}</h2>
        <div class="error-text" id="ruleErr"></div>
        <div class="field"><label>Заголовок</label><input class="input" id="ruleTitle" value="${escAttr(rule ? rule.title : '')}"></div>
        <div class="field"><label>Текст (суть правила)</label><textarea class="input" id="ruleBody" rows="6">${esc(rule ? rule.body : '')}</textarea></div>
        <div class="field">
          <label>Картинка</label>
          ${rule && rule.image_id ? `<div class="section-image" style="margin-bottom:10px;max-width:220px;"><img src="/media/${rule.image_id}" alt=""></div>` : ''}
          <input type="file" accept="image/*" id="ruleImage" class="input">
          ${rule && rule.image_id ? `<button type="button" class="btn btn-ghost btn-sm" id="removeImgBtn" style="margin-top:8px;">${ICONS.trash()} Удалить картинку</button>` : ''}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveRuleBtn">Сохранить</button>
        </div>`, { wide: true });

      overlay.querySelector('#saveRuleBtn').addEventListener('click', async () => {
        const title = overlay.querySelector('#ruleTitle').value.trim();
        const body = overlay.querySelector('#ruleBody').value;
        const err = overlay.querySelector('#ruleErr');
        try {
          let id = rule ? rule.id : null;
          if (isNew) {
            const res = await api.post('/api/rules', { title, body });
            id = res.id;
          } else {
            await api.put(`/api/rules/${id}`, { title, body });
          }
          const file = overlay.querySelector('#ruleImage').files[0];
          if (file) {
            const fd = new FormData();
            fd.append('image', file);
            await api.upload(`/api/rules/${id}/image`, fd);
          }
          Modal.close();
          reload();
        } catch (e) { err.textContent = e.message; }
      });

      overlay.querySelector('#removeImgBtn')?.addEventListener('click', async () => {
        try { await api.del(`/api/rules/${rule.id}/image`); Modal.close(); reload(); }
        catch (e) { alert(e.message); }
      });
    }

    async function removeRule(id) {
      Modal.confirm({
        title: 'Удалить это правило?',
        message: 'Действие нельзя отменить.',
        confirmText: 'Удалить',
        onConfirm: async () => { await api.del(`/api/rules/${id}`); reload(); },
      });
    }

    async function reload() {
      const data = await api.get('/api/rules');
      rules = data.rules;
      paint();
    }
  },
};
