'use client';

import { FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, ErrorText, Modal, request, Select, type Row } from './shared';

type FormState = {
  discordId: string;
  staticId: string;
  reason: string;
  createdBy: string;
};

const emptyForm = (): FormState => ({
  discordId: '',
  staticId: '',
  reason: '',
  createdBy: '',
});

function formatWhen(value: unknown) {
  if (!value) return '—';
  return new Date(String(value)).toLocaleString('ru-RU');
}

function historyActionLabel(action: string) {
  if (action === 'create') return 'Добавление';
  if (action === 'update') return 'Изменение';
  if (action === 'delete') return 'Удаление';
  return action;
}

function describeHistoryDetails(details: Row | null | undefined) {
  if (!details || typeof details !== 'object') return null;
  const before = (details.before || null) as Row | null;
  const after = (details.after || null) as Row | null;
  if (!before && !after) return null;
  const fields: Array<{ key: string; label: string }> = [
    { key: 'discord_id', label: 'Discord' },
    { key: 'static_id', label: 'Static' },
    { key: 'reason', label: 'Причина' },
    { key: 'created_by', label: 'От имени (id)' },
  ];
  const lines: string[] = [];
  for (const { key, label } of fields) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    if (String(a ?? '') === String(b ?? '')) continue;
    if (!before) {
      lines.push(`${label}: ${b == null || b === '' ? '—' : String(b)}`);
    } else {
      lines.push(`${label}: ${a == null || a === '' ? '—' : String(a)} → ${b == null || b === '' ? '—' : String(b)}`);
    }
  }
  return lines.length ? lines : null;
}

export function BlacklistInteractive() {
  const [items, setItems] = useState<Row[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [modal, setModal] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [historyFor, setHistoryFor] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await request('/api/blacklist');
    setItems(data.items || []);
    setCanEdit(!!data.canEdit);
    setIsOwner(!!data.isOwner);
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void request('/api/roster')
      .then((data) => setMembers(data.members || []))
      .catch(() => setMembers([]));
  }, [isOwner]);

  function openAdd() {
    setError('');
    setEditing(null);
    setForm(emptyForm());
    setModal('add');
  }

  function openEdit(item: Row) {
    setError('');
    setEditing(item);
    setForm({
      discordId: String(item.discord_id || ''),
      staticId: String(item.static_id || ''),
      reason: String(item.reason || ''),
      createdBy: item.created_by != null ? String(item.created_by) : '',
    });
    setModal('edit');
  }

  async function openHistory(item: Row) {
    setError('');
    try {
      const data = await request(`/api/blacklist/${item.id}`);
      setHistoryFor(data.item || item);
      setHistory(data.history || []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Row = {
        discordId: form.discordId.trim() || null,
        staticId: form.staticId.trim() || null,
        reason: form.reason.trim(),
      };
      if (isOwner && form.createdBy) {
        payload.createdBy = Number(form.createdBy);
      }
      if (modal === 'edit' && editing) {
        await request(`/api/blacklist/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await request('/api/blacklist', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setModal(null);
      setEditing(null);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!(await askConfirm('Убрать из чёрного списка?', { title: 'Чёрный список', confirmLabel: 'Убрать' }))) return;
    try {
      await request(`/api/blacklist/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const memberOptions = members.map((m) => ({
    value: String(m.id),
    label: `${m.nickname}${m.role_name ? ` · ${m.role_name}` : ''}`,
  }));

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="toolbar-left">
          <span className="badge badge-muted">{items.length}</span>
        </div>
        {canEdit ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
            <NavIcon name="plus" /> Добавить в ЧС
          </button>
        ) : null}
      </div>

      <ErrorText value={error} />

      {items.map((item) => {
        const title = item.reason
          ? String(item.reason)
          : (item.user_nickname ? String(item.user_nickname) : 'Запись в ЧС');
        return (
          <article className="card bl-card" key={item.id}>
            <div className="bl-card-main">
              <div className="bl-card-title-row">
                <h3 className="bl-card-title">{title}</h3>
                {item.user_nickname && item.reason ? (
                  <span className="bl-card-nick">{String(item.user_nickname)}</span>
                ) : null}
              </div>
              <div className="bl-card-ids">
                {item.discord_id ? (
                  <span className="bl-chip" title="Discord ID">
                    <span className="bl-chip-k">DC</span>
                    <span className="bl-chip-v">{String(item.discord_id)}</span>
                  </span>
                ) : null}
                {item.static_id ? (
                  <span className="bl-chip" title="StaticID">
                    <span className="bl-chip-k">SID</span>
                    <span className="bl-chip-v">{String(item.static_id)}</span>
                  </span>
                ) : null}
                {!item.discord_id && !item.static_id ? (
                  <span className="bl-chip bl-chip-muted">нет ID</span>
                ) : null}
              </div>
              <div className="bl-card-meta">
                <span>{item.created_by_nickname || '—'}</span>
                <span className="bl-dot" aria-hidden>·</span>
                <span>{formatWhen(item.created_at)}</span>
              </div>
            </div>
            <div className="bl-card-actions">
              <button
                type="button"
                className="icon-btn"
                title="История"
                onClick={() => void openHistory(item)}
              >
                <NavIcon name="history" />
              </button>
              {canEdit ? (
                <button
                  type="button"
                  className="icon-btn"
                  title="Редактировать"
                  onClick={() => openEdit(item)}
                >
                  <NavIcon name="edit" />
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Удалить"
                  onClick={() => void remove(item.id)}
                >
                  <NavIcon name="trash" />
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
      {!items.length && <div className="empty-state"><h3>Список пуст</h3></div>}

      {modal ? (
        <Modal
          title={modal === 'edit' ? 'Редактирование ЧС' : 'Добавить в ЧС'}
          onClose={() => { setModal(null); setEditing(null); }}
        >
          <form onSubmit={save}>
            <ErrorText value={error} />
            <div className="form-row-2">
              <div className="field">
                <label>Discord ID</label>
                <input
                  className="input"
                  value={form.discordId}
                  onChange={(e) => setForm({ ...form, discordId: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                  placeholder="17–20 цифр"
                />
              </div>
              <div className="field">
                <label>StaticID</label>
                <input
                  className="input"
                  value={form.staticId}
                  maxLength={6}
                  onChange={(e) => setForm({ ...form, staticId: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  placeholder="2–6 цифр"
                />
              </div>
            </div>
            <div className="field">
              <label>Причина</label>
              <textarea
                className="input input-compact"
                rows={2}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Кратко"
              />
            </div>
            {isOwner ? (
              <div className="field">
                <label>От имени</label>
                <Select
                  placeholder="Я сам"
                  value={form.createdBy}
                  onChange={(value) => setForm({ ...form, createdBy: value })}
                  options={[{ value: '', label: 'Я сам' }, ...memberOptions]}
                />
                <div className="field-hint">Владелец может указать другого сотрудника как автора записи.</div>
              </div>
            ) : null}
            <div className="field-hint">Нужен Discord ID и/или StaticID. Роли таким людям не выдаются; заявки отклоняются автоматически.</div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setModal(null); setEditing(null); }}>
                Отмена
              </button>
              <button className="btn btn-primary" disabled={saving}>
                {modal === 'edit' ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {historyFor ? (
        <Modal title="История изменений" onClose={() => { setHistoryFor(null); setHistory([]); }} wide>
          <p className="modal-sub" style={{ textAlign: 'left' }}>
            {[
              historyFor.discord_id && `Discord ${historyFor.discord_id}`,
              historyFor.static_id && `Static ${historyFor.static_id}`,
            ].filter(Boolean).join(' · ') || `Запись #${historyFor.id}`}
          </p>
          {history.length ? history.map((entry) => {
            const lines = describeHistoryDetails(entry.details as Row);
            return (
              <div className="roster-row" key={entry.id}>
                <div className="who">
                  <div>
                    <div className="nickname">
                      {historyActionLabel(String(entry.action))} · {entry.actor_nickname || '—'}
                    </div>
                    <div className="role-tag">{formatWhen(entry.created_at)}</div>
                    {lines ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        {lines.map((line) => <div key={line}>{line}</div>)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          }) : (
            <div className="empty-state">
              <h3>Истории пока нет</h3>
              <p>Изменения появятся после правок записи.</p>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setHistoryFor(null); setHistory([]); }}>
              Закрыть
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
