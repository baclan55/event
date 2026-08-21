'use client';

import { FormEvent, useMemo, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, ErrorText, matchesSearch, Modal, request, SearchBox, type Row } from './shared';

export function PropsInteractive({
  initialProps,
  canEdit,
}: {
  initialProps: Row[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Row[]>(initialProps);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const filtered = useMemo(
    () => items.filter((item) => matchesSearch([item.name, item.spawn_id], query)),
    [items, query],
  );

  async function reload() {
    const data = await request('/api/props');
    setItems(data.props || []);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get('name'),
      spawnId: form.get('spawnId'),
    };
    try {
      let id = editing?.id;
      if (id) await request(`/api/props/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else id = (await request('/api/props', { method: 'POST', body: JSON.stringify(payload) })).id;
      const file = form.get('image');
      if (file instanceof File && file.size) {
        const upload = new FormData();
        upload.append('image', file);
        await request(`/api/props/${id}/image`, { method: 'POST', body: upload });
      }
      setEditing(undefined);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    if (!(await askConfirm('Удалить проп?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try {
      await request(`/api/props/${id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removePropImage(id: number) {
    try {
      await request(`/api/props/${id}/image`, { method: 'DELETE' });
      setEditing(undefined);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copySpawnId(item: Row) {
    const value = String(item.spawn_id || '');
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    } catch {
      setError('Не удалось скопировать — скопируйте ID вручную.');
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{filtered.length}{query.trim() ? ` из ${items.length}` : ''} пропов</span>
          <SearchBox value={query} onChange={setQuery} placeholder="Название или ID…" />
        </div>
        {canEdit && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(null)}>
            <NavIcon name="plus" /> Добавить проп
          </button>
        )}
      </div>
      <ErrorText value={error} />
      {filtered.map((item) => (
        <div className="roster-row" key={item.id}>
          <div className="ach-icon-wrap">
            {item.image_id ? (
              <img src={`/media/${item.image_id}`} alt="" className="ach-icon" />
            ) : (
              <span className="ach-icon ach-icon-empty"><NavIcon name="image" /></span>
            )}
          </div>
          <div className="who">
            <div>
              <div className="nickname">{item.name}</div>
              <div className="role-tag">ID: {item.spawn_id}</div>
            </div>
          </div>
          <div className="row-actions">
            <button
              className="icon-btn"
              title="Скопировать ID для спавна"
              onClick={() => void copySpawnId(item)}
            >
              {copiedId === item.id ? '✓' : <NavIcon name="copy" />}
            </button>
            {canEdit && (
              <>
                <button className="icon-btn" onClick={() => setEditing(item)}><NavIcon name="edit" /></button>
                <button className="icon-btn danger" onClick={() => void remove(item.id)}><NavIcon name="trash" /></button>
              </>
            )}
          </div>
        </div>
      ))}
      {!filtered.length && (
        <div className="empty-state">
          <h3>{query.trim() ? 'Ничего не найдено' : 'Пропов пока нет'}</h3>
        </div>
      )}

      {editing !== undefined && (
        <Modal title={editing ? 'Редактирование пропа' : 'Новый проп'} onClose={() => setEditing(undefined)}>
          <form onSubmit={save}>
            <ErrorText value={error} />
            <div className="field">
              <label>Название</label>
              <input className="input" name="name" required maxLength={120} defaultValue={editing?.name || ''} />
            </div>
            <div className="field">
              <label>ID для спавна</label>
              <input
                className="input"
                name="spawnId"
                required
                maxLength={120}
                defaultValue={editing?.spawn_id || ''}
                placeholder="prop_chair_01a"
              />
              <div className="field-hint">Модель/хэш пропа — то, что вводится в команду спавна в игре.</div>
            </div>
            <div className="field">
              <label>Картинка</label>
              {editing?.image_id && (
                <div className="section-image" style={{ marginBottom: 8 }}>
                  <img src={`/media/${editing.image_id}`} alt="" style={{ maxWidth: 160, borderRadius: 10 }} />
                </div>
              )}
              <input className="input" name="image" type="file" accept="image/*" />
              {editing?.image_id && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => void removePropImage(editing.id)}
                >
                  <NavIcon name="trash" /> Удалить текущую
                </button>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(undefined)}>Отмена</button>
              <button className="btn btn-primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
