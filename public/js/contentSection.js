const ContentSection = {
  async render(container, opts) {
    container.innerHTML = '<div class="empty-state">Загрузка…</div>';
    let data;
    try {
      data = await api.get(`/api/content/${opts.section}`);
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><h3>Не удалось загрузить раздел</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    // Сотрудники тира "хелперы" не видят вкладку/содержимое "Event
    // Administrator" — тот же тир, что решает доступ к системе выговоров
    // (см. src/utils/tier.js), и то же самое уже отфильтровано на бэкенде
    // (см. src/routes/content.js — блок 'administrator' туда просто не
    // приходит для этого тира). Здесь только UI: показываем переключатель
    // вкладок, только если пользователю есть между чем переключаться.
    const showToggle = opts.hasToggle && Auth.isAdminTier();
    let audience = opts.hasToggle ? 'helper' : 'general';

    function segmentedHTML(active) {
      return `<div class="segmented">
        <button type="button" data-aud="helper" class="${active === 'helper' ? 'active' : ''}">Event Helper</button>
        <button type="button" data-aud="administrator" class="${active === 'administrator' ? 'active' : ''}">Event Administrator</button>
      </div>`;
    }

    function paint() {
      const block = data.blocks[audience] || { body: '', bodyRaw: '', imageId: null };
      container.innerHTML = `
        <div class="card card-pad">
          <div class="card-header">
            ${showToggle ? segmentedHTML(audience) : `<h3>${esc(opts.hasToggle ? 'Event Helper' : (opts.heading || ''))}</h3>`}
            ${Auth.hasRoleIn(Auth.ROLE_GROUPS.edit) ? `<button type="button" class="btn btn-ghost btn-sm" id="editBtn">${ICONS.edit()} Редактировать</button>` : ''}
          </div>
          <div class="md-body">${block.body ? block.body : '<span style="color:var(--text-faint)">Текст пока не добавлен.</span>'}</div>
          ${block.imageId ? `<div class="section-image"><img src="/media/${block.imageId}" alt=""></div>` : ''}
          ${block.updatedAt ? `<div class="meta-line">Обновлено ${formatDate(block.updatedAt)}${block.updatedBy ? ' · ' + esc(block.updatedBy) : ''}</div>` : ''}
        </div>`;

      if (showToggle) {
        container.querySelectorAll('[data-aud]').forEach((btn) => {
          btn.addEventListener('click', () => { audience = btn.dataset.aud; paint(); });
        });
      }
      container.querySelector('#editBtn')?.addEventListener('click', openEditModal);
    }

    function openEditModal() {
      const block = data.blocks[audience] || { body: '', bodyRaw: '', imageId: null };
      const overlay = Modal.open(`
        <h2>Редактирование</h2>
        <div class="modal-sub">${opts.hasToggle ? (audience === 'helper' ? 'Event Helper' : 'Event Administrator') : esc(opts.heading || '')}</div>
        <div class="error-text" id="editErr"></div>
        <div class="field"><label>Текст (Markdown)</label><div id="editBodyMount"></div></div>
        <div class="field">
          <label>Картинка</label>
          ${block.imageId ? `<div class="section-image" style="margin-bottom:10px;"><img src="/media/${block.imageId}" alt=""></div>` : ''}
          <input type="file" accept="image/*" id="editImage" class="input">
          ${block.imageId ? `<button type="button" class="btn btn-ghost btn-sm" id="removeImageBtn" style="margin-top:8px;">${ICONS.trash()} Удалить картинку</button>` : ''}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal-close>Отмена</button>
          <button type="button" class="btn btn-primary" id="saveBtn">Сохранить</button>
        </div>`, { wide: true });

      const editor = MarkdownEditor.mount(overlay.querySelector('#editBodyMount'), block.bodyRaw);

      overlay.querySelector('#saveBtn').addEventListener('click', async () => {
        const body = editor.getMarkdown();
        const err = overlay.querySelector('#editErr');
        try {
          await api.put(`/api/content/${opts.section}`, { audience, body });
          const file = overlay.querySelector('#editImage').files[0];
          if (file) {
            const fd = new FormData();
            fd.append('image', file);
            fd.append('audience', audience);
            await api.upload(`/api/content/${opts.section}/image`, fd);
          }
          Modal.close();
          ContentSection.render(container, opts);
        } catch (e) { err.textContent = e.message; }
      });

      overlay.querySelector('#removeImageBtn')?.addEventListener('click', async () => {
        try {
          await api.del(`/api/content/${opts.section}/image?audience=${audience}`);
          Modal.close();
          ContentSection.render(container, opts);
        } catch (e) { alert(e.message); }
      });
    }

    paint();
  },
};
