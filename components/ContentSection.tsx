'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { useAuth } from '@/components/AuthProvider';
import { MarkdownEditor } from '@/components/MarkdownEditor';

type Block = { body?: string; bodyRaw?: string; imageId?: number | null; updatedBy?: string | null; updatedAt?: string | null };
export function ContentSection({ section, title }: { section: 'faq' | 'regulations' | 'first_steps'; title: string }) {
  const { user } = useAuth();
  const [blocks, setBlocks] = useState<Record<string, Block>>({});
  const [audience, setAudience] = useState('general');
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const canEdit = !!user && (user.isOwner || ['Chief Event', 'Dep.Chief Event', 'Technical Administrator'].some((role) => user.roles.includes(role)));
  const load = useCallback(
    () => api.get(`/api/content/${section}`).then((data) => setBlocks(data.blocks ?? {})).catch((e) => setError(e.message)),
    [section],
  );
  useEffect(() => { void load(); }, [load]);
  const block = blocks[audience] ?? blocks.general ?? {};
  const beginEdit = () => { setBody(block.bodyRaw ?? ''); setEditing(true); };
  const save = async () => {
    try { await api.put(`/api/content/${section}`, { audience, body }); setEditing(false); load(); } catch (e) { setError((e as Error).message); }
  };
  return <div className="card card-pad">
    <div className="card-header"><h3>{title}</h3>{canEdit && <button className="btn btn-ghost btn-sm" onClick={beginEdit}>Редактировать</button>}</div>
    {canEdit && <div className="segmented" style={{ marginBottom: 16 }}>
      {['general', 'helper', 'administrator'].map((item) => <button key={item} className={audience === item ? 'active' : ''} onClick={() => setAudience(item)}>{item === 'general' ? 'Общее' : item === 'helper' ? 'Хелперы' : 'Администраторы'}</button>)}
    </div>}
    {editing ? <><MarkdownEditor value={body} onChange={setBody} /><div className="modal-actions"><button className="btn btn-ghost" onClick={() => setEditing(false)}>Отмена</button><button className="btn btn-primary" onClick={() => void save()}>Сохранить</button></div></> :
      <>{block.body ? <div className="md-body" dangerouslySetInnerHTML={{ __html: block.body }} /> : <div className="empty-state"><p>Материал пока не добавлен.</p></div>}
        {block.imageId && <img className="section-image" src={`/media/${block.imageId}`} alt="" />}</>}
    {error && <p className="error-text">{error}</p>}
  </div>;
}
