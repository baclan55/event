'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { describeLogEntry } from '@/lib/auditShared';
import { askConfirm, Avatar, ErrorText, MarkdownFormField, matchesSearch, Modal, request, SearchBox, type Row } from './shared';

export function OwnerInteractive({ canManageOwners }: { canManageOwners: boolean }) {
  const [users, setUsers] = useState<Row[]>([]);
  const [roles, setRoles] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await request('/api/owner/users');
      setUsers(data.users || []); setRoles(data.roles || []); setAudit(data.audit || []);
    } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      const payload: Row = {
        nickname: form.get('nickname'),
        roleIds: form.getAll('roleIds').map(Number),
        isAdmin: form.get('isAdmin') === 'on',
      };
      if (canManageOwners) payload.isOwner = editing.is_owner || form.get('isOwner') === 'on';
      await request(`/api/owner/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setEditing(null); await load();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    if (!(await askConfirm('Удалить пользователя безвозвратно?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try { await request(`/api/owner/users/${id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="toolbar"><div className="toolbar-left">{users.length} учётных записей</div></div>
      <ErrorText value={error} />
      {users.map((user) => <div className="roster-row" key={user.id}><Avatar row={user} /><div className="who"><div><div className="nickname">{user.nickname} {user.is_owner && <span className="badge badge-purple">Владелец</span>}</div><div className="role-tag">{(user.roles || []).map((r: Row) => r.name).join(' · ') || 'Без роли'}{user.discord_username ? ` · ${user.discord_username}` : ''}</div></div></div><div className="row-actions"><button className="icon-btn" onClick={() => setEditing(user)}><NavIcon name="edit" /></button>{!user.is_owner && <button className="icon-btn danger" onClick={() => void remove(user.id)}><NavIcon name="trash" /></button>}</div></div>)}
      <section className="card card-pad audit-card">
        <div className="card-header"><h3>Журнал действий</h3><span className="badge badge-muted">{audit.length}</span></div>
        <div className="audit-list">
          {audit.map((entry) => {
            const desc = describeLogEntry(entry);
            return (
              <div className="audit-row" key={entry.id}>
                <div className="audit-body">
                  <div className="audit-main"><span className="nickname">{desc.title}</span></div>
                  {desc.lines.length > 0 && (
                    <div className="audit-details">
                      {desc.lines.map((line) => <div key={line}>{line}</div>)}
                    </div>
                  )}
                </div>
                <div className="audit-meta">
                  {entry.actor_nickname || 'Удалённый пользователь'} · {new Date(entry.created_at).toLocaleString('ru-RU')}
                </div>
              </div>
            );
          })}
          {!audit.length && <div className="empty-state"><p>Административных действий пока нет.</p></div>}
        </div>
      </section>
      {editing && <Modal title="Редактирование пользователя" onClose={() => setEditing(null)} wide><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Никнейм</label><input className="input" name="nickname" maxLength={60} required defaultValue={editing.nickname} /></div><div className="field"><label>Роли</label><div className="role-checklist">{roles.map((role) => <label className="role-check-item" key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={(editing.roles || []).some((r: Row) => r.id === role.id)} />{role.name}</label>)}</div></div><label className="qform-check-label"><input type="checkbox" name="isAdmin" defaultChecked={editing.is_admin} /> Администратор</label>{canManageOwners && <label className="qform-check-label"><input type="checkbox" name="isOwner" defaultChecked={editing.is_owner} disabled={editing.is_owner} /> Владелец</label>}<div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
    </>
  );
}

export function ContentInteractive({
  section,
  title,
  initialBlocks,
  canEdit,
  splitByAudience = false,
  canViewAdministrator = false,
}: {
  section: string;
  title: string;
  initialBlocks: Record<string, Row>;
  canEdit: boolean;
  splitByAudience?: boolean;
  canViewAdministrator?: boolean;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [audience, setAudience] = useState(splitByAudience ? 'helper' : 'general');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const block = blocks[audience] || (audience === 'helper' ? blocks.general : undefined) || {};
  const hasAudienceTabs = splitByAudience && canViewAdministrator;

  async function reload() {
    const data = await request(`/api/content/${section}`);
    setBlocks(data.blocks || {});
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/content/${section}`, {
        method: 'PUT',
        body: JSON.stringify({ audience, body: form.get('body') }),
      });
      const file = form.get('image');
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append('image', file); upload.append('audience', audience);
        await request(`/api/content/${section}/image?audience=${audience}`, { method: 'POST', body: upload });
      }
      setEditing(false); await reload();
    } catch (err) { setError((err as Error).message); }
  }

  async function removeImage() {
    try {
      await request(`/api/content/${section}/image?audience=${audience}`, { method: 'DELETE' });
      await reload();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="card card-pad">
        <div className="card-header">
          {hasAudienceTabs ? <div className="segmented"><button className={audience === 'helper' ? 'active' : ''} onClick={() => setAudience('helper')}>Event Helper</button><button className={audience === 'administrator' ? 'active' : ''} onClick={() => setAudience('administrator')}>Event Administrator</button></div> : <h3>{splitByAudience ? 'Event Helper' : title}</h3>}
          {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><NavIcon name="edit" /> Редактировать</button>}
        </div>
        {block.body ? <div className="md-body" dangerouslySetInnerHTML={{ __html: block.body }} /> : <div className="empty-state"><p>Текст пока не добавлен.</p></div>}
        {block.imageId && <div className="section-image"><img src={`/media/${block.imageId}`} alt="" /></div>}
        {block.updatedAt && (
          <div className="meta-line">
            Последнее редактирование: {new Date(block.updatedAt).toLocaleString('ru-RU')}
            {block.updatedBy ? ` · автор ${block.updatedBy}` : ''}
          </div>
        )}
      </div>
      {editing && <Modal title={`Редактирование · ${splitByAudience ? audience === 'helper' ? 'Event Helper' : 'Event Administrator' : title}`} onClose={() => setEditing(false)} editor><form onSubmit={save}><ErrorText value={error} /><div className="field"><label>Текст (Markdown)</label><MarkdownFormField name="body" initialValue={block.bodyRaw || ''} /></div><div className="field"><label>Картинка</label><input className="input" name="image" type="file" accept="image/*" />{block.imageId && <button className="btn btn-ghost btn-sm" type="button" onClick={() => void removeImage()}><NavIcon name="trash" /> Удалить текущую</button>}</div><div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Отмена</button><button className="btn btn-primary">Сохранить</button></div></form></Modal>}
    </>
  );
}

/** Копирует подключённые на странице стили в отдельное окно (PiP или попап-фолбэк),
 *  чтобы карточка правила там выглядела так же, как на сайте. */
function copyStylesInto(win: Window) {
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const cssText = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
      const style = win.document.createElement('style');
      style.textContent = cssText;
      win.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = win.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        win.document.head.appendChild(link);
      }
    }
  });
  const extra = win.document.createElement('style');
  extra.textContent = `
    html,body{margin:0;height:100%;background:var(--bg-page);}
    .rule-overlay{display:flex;flex-direction:column;height:100%;box-sizing:border-box;}
    .rule-overlay-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border-soft);flex-shrink:0;}
    .rule-overlay-thumb{width:44px;height:44px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--bg-card-2);border:1px solid var(--border);}
    .rule-overlay-thumb img{width:100%;height:100%;object-fit:cover;}
    .rule-overlay-title{font-size:16px;font-weight:700;color:var(--text-heading);line-height:1.3;}
    .rule-overlay-body{padding:14px 16px;overflow:auto;flex:1;}
  `;
  win.document.head.appendChild(extra);
}

/** Заполняет уже открытое окно оверлея содержимым конкретного правила. */
function renderRuleInto(win: Window, rule: Row) {
  win.document.title = String(rule.title || 'Правило') + ' — оверлей';
  win.document.body.innerHTML =
    '<div class="rule-overlay"><div class="rule-overlay-head">' +
    (rule.image_id ? '<div class="rule-overlay-thumb"><img alt="" /></div>' : '') +
    '<div class="rule-overlay-title"></div></div>' +
    '<div class="rule-overlay-body md-body"></div></div>';
  if (rule.image_id) {
    const img = win.document.querySelector('.rule-overlay-thumb img') as HTMLImageElement | null;
    if (img) img.src = `/media/${rule.image_id}`;
  }
  const titleEl = win.document.querySelector('.rule-overlay-title');
  if (titleEl) titleEl.textContent = String(rule.title || '');
  const bodyEl = win.document.querySelector('.rule-overlay-body');
  if (bodyEl) bodyEl.innerHTML = rule.bodyHtml || rule.body || '';
}

export function RulesInteractive({ initialRules, canEdit }: { initialRules: Row[]; canEdit: boolean }) {
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const overlayRef = useRef<Window | null>(null);

  /** Показывает правило в окне «поверх всех окон»: Document Picture-in-Picture там,
   *  где он есть (Chrome/Edge/новый Firefox), и обычное отдельное окно — там, где нет
   *  (Safari и т.д.; такое окно уже не «поверх всех», это ограничение самого браузера). */
  async function openRuleOverlay(rule: Row) {
    const dpip = (window as any).documentPictureInPicture;
    if (dpip) {
      try {
        let win: Window | null = dpip.window;
        if (!win) {
          win = await dpip.requestWindow({ width: 380, height: 540 });
          copyStylesInto(win as Window);
        }
        renderRuleInto(win as Window, rule);
        return;
      } catch {
        // Пользователь запретил PiP или браузер отказал — уходим в фолбэк ниже.
      }
    }
    let win = overlayRef.current;
    if (!win || win.closed) {
      win = window.open('', 'mp-rule-overlay', 'popup,width=380,height=540,noopener');
      if (!win) {
        setError('Браузер заблокировал всплывающее окно — разрешите всплывающие окна для этого сайта.');
        return;
      }
      copyStylesInto(win);
      overlayRef.current = win;
    }
    renderRuleInto(win, rule);
    win.focus();
  }

  const tabRules = useMemo(
    () => rules.filter((rule) => (tab === 'archive' ? !!rule.archived : !rule.archived)),
    [rules, tab],
  );

  const filtered = useMemo(
    () => tabRules.filter((rule) => matchesSearch([rule.title], query)),
    [tabRules, query],
  );

  const activeCount = rules.filter((rule) => !rule.archived).length;
  const archiveCount = rules.filter((rule) => !!rule.archived).length;

  async function reload() {
    const data = await request('/api/rules');
    setRules(data.rules || []);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: form.get('title'),
      body: form.get('body'),
      archived: !!editing?.archived,
    };
    try {
      let id = editing?.id;
      if (id) await request(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else id = (await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) })).id;
      const file = form.get('image');
      if (file instanceof File && file.size) {
        const upload = new FormData(); upload.append('image', file);
        await request(`/api/rules/${id}/image`, { method: 'POST', body: upload });
      }
      setEditing(undefined); await reload();
    } catch (err) { setError((err as Error).message); }
  }

  async function remove(id: number) {
    if (!(await askConfirm('Удалить правило?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try { await request(`/api/rules/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }

  async function setArchived(rule: Row, archived: boolean) {
    try {
      await request(`/api/rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: rule.title,
          body: rule.bodyRaw || '',
          archived,
        }),
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function move(id: number, direction: -1 | 1) {
    const index = tabRules.findIndex((rule) => rule.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= tabRules.length) return;
    const nextTab = [...tabRules];
    [nextTab[index], nextTab[nextIndex]] = [nextTab[nextIndex], nextTab[index]];
    const other = rules.filter((rule) => (tab === 'archive' ? !rule.archived : !!rule.archived));
    const nextAll = tab === 'archive' ? [...other, ...nextTab] : [...nextTab, ...other];
    setRules(nextAll);
    try {
      await request('/api/rules/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order: nextAll.map((rule) => rule.id) }),
      });
    } catch (err) {
      setRules(rules);
      setError((err as Error).message);
    }
  }

  async function removeRuleImage(id: number) {
    try {
      await request(`/api/rules/${id}/image`, { method: 'DELETE' });
      setEditing(undefined);
      await reload();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="segmented">
            <button type="button" className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>
              Активные ({activeCount})
            </button>
            <button type="button" className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>
              Архив ({archiveCount})
            </button>
          </div>
          <span>{filtered.length} из {tabRules.length}</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Поиск по названию…" />
        </div>
        {canEdit && tab === 'active' && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}>
            <NavIcon name="plus" /> Добавить правило
          </button>
        )}
      </div>
      <ErrorText value={error} />
      {filtered.map((rule) => {
        const index = tabRules.findIndex((item) => item.id === rule.id);
        return (
          <details className="rules-card" key={rule.id}>
            <summary className="rules-card-header">
              <div className="rules-thumb">{rule.image_id ? <img src={`/media/${rule.image_id}`} alt="" /> : <NavIcon name="image" />}</div>
              <div className="rules-title">{rule.title}</div>
              <div className="rules-card-actions" onClick={(event) => event.preventDefault()}>
                <button
                  className="icon-btn"
                  title="Показать поверх других окон"
                  onClick={() => void openRuleOverlay(rule)}
                >
                  <NavIcon name="pip" />
                </button>
                {canEdit && (
                  <>
                    <button className="icon-btn" disabled={index === 0} title="Выше" onClick={() => void move(rule.id, -1)}>↑</button>
                    <button className="icon-btn" disabled={index === tabRules.length - 1} title="Ниже" onClick={() => void move(rule.id, 1)}>↓</button>
                    <button
                      className="icon-btn"
                      title={rule.archived ? 'Вернуть в активные' : 'В архив'}
                      onClick={() => void setArchived(rule, !rule.archived)}
                    >
                      {rule.archived ? '↩' : '⤓'}
                    </button>
                    <button className="icon-btn" onClick={() => setEditing(rule)}><NavIcon name="edit" /></button>
                    <button className="icon-btn danger" onClick={() => void remove(rule.id)}><NavIcon name="trash" /></button>
                  </>
                )}
              </div>
            </summary>
            <div className="rules-panel" style={{ display: 'block' }}>
              <div className="rules-panel-inner">
                <div className="rules-panel-text md-body" dangerouslySetInnerHTML={{ __html: rule.bodyHtml || rule.body || '' }} />
              </div>
            </div>
          </details>
        );
      })}
      {!filtered.length && (
        <div className="empty-state">
          <h3>
            {query.trim()
              ? 'Ничего не найдено'
              : tab === 'archive'
                ? 'Архив пуст'
                : 'Активных правил пока нет'}
          </h3>
        </div>
      )}
      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование правила' : 'Новое правило'} onClose={() => setEditing(undefined)} editor>
          <form onSubmit={save}>
            <ErrorText value={error} />
            <div className="field"><label>Заголовок</label><input className="input" name="title" required defaultValue={editing?.title || ''} /></div>
            <div className="field"><label>Текст (Markdown)</label><MarkdownFormField name="body" initialValue={editing?.bodyRaw || ''} /></div>
            <div className="field">
              <label>Картинка</label>
              <input className="input" type="file" name="image" accept="image/*" />
              {editing?.image_id && (
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => void removeRuleImage(editing.id)}>
                  <NavIcon name="trash" /> Удалить текущую
                </button>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setEditing(undefined)}>Отмена</button>
              <button className="btn btn-primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
