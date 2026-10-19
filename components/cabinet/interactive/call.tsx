'use client';

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { NavIcon } from '@/components/NavIcons';
import {
  CALL_FIXED_QUESTIONS,
  CALL_GREETING,
  CALL_MAIN_INTRO,
  CALL_OUTRO,
  CALL_QUESTIONS_COUNT,
  CALL_SCORES,
  callTotals,
} from '@/lib/callTemplate';
import { askConfirm, ErrorText, matchesSearch, Modal, request, SearchBox, Select, type Row } from './shared';

type SheetQuestion = { id: number; position: number; category: string; question: string; answer: string };
type SheetScore = { applicationId: number; sheetQuestionId: number; score: number };
export type CallSheetData = { questions: SheetQuestion[]; scores: SheetScore[]; bankTotal: number };

const SELECTED_KEY = 'call-selected-candidates';
/** Как часто лист подтягивает чужие изменения (оценки, перемешивание). */
const POLL_INTERVAL_MS = 3000;

const scoreKey = (applicationId: number, sheetQuestionId: number) => `${applicationId}:${sheetQuestionId}`;
const candidateName = (c: Row) => String(c.candidate_nickname || c.nickname_static || c.applicant_name || `#${c.id}`);
const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

function scoresToMap(list: SheetScore[]): Record<string, number> {
  return Object.fromEntries(list.map((s) => [scoreKey(s.applicationId, s.sheetQuestionId), s.score]));
}

function sameScores(a: Record<string, number>, b: Record<string, number>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function scoreClass(value: number) {
  return value === 1 ? 'full' : value === 0.5 ? 'half' : 'zero';
}

function ScoreButtons({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className="call-score" role="group" aria-label="Оценка ответа">
      {CALL_SCORES.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          aria-pressed={value === option}
          className={`call-score-btn call-score-${scoreClass(option)}${value === option ? ' active' : ''}`}
          onClick={() => onChange(value === option ? null : option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function CallInteractive({
  initialCandidates,
  initialSheet,
  canEdit,
}: {
  initialCandidates: Row[];
  initialSheet: CallSheetData;
  canEdit: boolean;
}) {
  const candidates = initialCandidates;
  const [questions, setQuestions] = useState<SheetQuestion[]>(initialSheet.questions);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialSheet.scores.map((s) => [scoreKey(s.applicationId, s.sheetQuestionId), s.score])),
  );
  const [bankTotal, setBankTotal] = useState(initialSheet.bankTotal);
  const [selected, setSelected] = useState<number[]>(() => (candidates[0] ? [candidates[0].id] : []));
  const [bankOpen, setBankOpen] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [error, setError] = useState('');
  // Свои запросы в полёте и счётчик локальных изменений: ответ опроса, начатый до
  // собственной правки или во время неё, устарел и не должен её затирать.
  const pendingRef = useRef(0);
  const mutationRef = useRef(0);

  // Общий лист: подтягиваем оценки и новый набор вопросов, которые поставили другие.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (document.hidden || pendingRef.current > 0) return;
      const stamp = mutationRef.current;
      try {
        const data = await request('/api/call');
        if (stopped || pendingRef.current > 0 || stamp !== mutationRef.current) return;
        const nextQuestions: SheetQuestion[] = data.questions || [];
        const nextScores = scoresToMap(data.scores || []);
        setQuestions((prev) => (JSON.stringify(prev) === JSON.stringify(nextQuestions) ? prev : nextQuestions));
        setScores((prev) => (sameScores(prev, nextScores) ? prev : nextScores));
        if (typeof data.bankTotal === 'number') setBankTotal(data.bankTotal);
      } catch {
        /* временная ошибка сети или прав — просто попробуем на следующем тике */
      }
    }
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Выбранные колонки кандидатов переживают перезагрузку страницы.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SELECTED_KEY);
      if (!raw) return;
      const ids = (JSON.parse(raw) as unknown[])
        .map(Number)
        .filter((id) => candidates.some((c) => c.id === id));
      if (ids.length) setSelected(ids);
    } catch {
      /* private mode / битые данные — остаёмся на значении по умолчанию */
    }
  }, [candidates]);

  function toggleCandidate(id: number) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { sessionStorage.setItem(SELECTED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const columns = useMemo(
    () => selected
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is Row => !!c),
    [selected, candidates],
  );

  const totals = useMemo(() => {
    const map = new Map<number, ReturnType<typeof callTotals>>();
    for (const c of columns) {
      map.set(c.id, callTotals(questions.length, questions.map((q) => scores[scoreKey(c.id, q.id)])));
    }
    return map;
  }, [columns, questions, scores]);

  async function shuffle() {
    setError('');
    if (questions.length && Object.keys(scores).length) {
      const confirmed = await askConfirm(
        'Будет собран новый набор вопросов, а все поставленные оценки сбросятся. Продолжить?',
        { title: 'Перемешать вопросы', confirmLabel: 'Перемешать' },
      );
      if (!confirmed) return;
    }
    setShuffling(true);
    pendingRef.current += 1;
    mutationRef.current += 1;
    try {
      const data = await request('/api/call/shuffle', { method: 'POST' });
      setQuestions(data.questions || []);
      setScores(scoresToMap(data.scores || []));
      if (typeof data.bankTotal === 'number') setBankTotal(data.bankTotal);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      pendingRef.current -= 1;
      mutationRef.current += 1;
      setShuffling(false);
    }
  }

  async function setScore(applicationId: number, sheetQuestionId: number, next: number | null) {
    const key = scoreKey(applicationId, sheetQuestionId);
    const previous = scores[key];
    setError('');
    pendingRef.current += 1;
    mutationRef.current += 1;
    setScores((prev) => {
      const copy = { ...prev };
      if (next === null) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    try {
      await request('/api/call/scores', {
        method: 'PUT',
        body: JSON.stringify({ applicationId, sheetQuestionId, score: next }),
      });
    } catch (err) {
      setError((err as Error).message);
      setScores((prev) => {
        const copy = { ...prev };
        if (previous === undefined) delete copy[key];
        else copy[key] = previous;
        return copy;
      });
    } finally {
      pendingRef.current -= 1;
      mutationRef.current += 1;
    }
  }

  const candidateCols = Math.max(columns.length, 1);
  const emptyHint = bankTotal === 0
    ? 'База вопросов пуста — добавьте вопросы через кнопку «База вопросов».'
    : 'Нажмите «Перемешать вопросы», чтобы собрать лист из базы.';

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          {questions.length
            ? `${questions.length} вопросов в листе · в базе ${bankTotal}`
            : `В базе вопросов: ${bankTotal}`}
          <span className="call-live" title="Оценки и вопросы обновляются у всех автоматически">● обновляется автоматически</span>
        </div>
        <div className="toolbar-right">
          {canEdit && (
            <button className="btn btn-ghost btn-sm" disabled={shuffling} onClick={() => void shuffle()}>
              <NavIcon name="shuffle" /> {shuffling ? 'Перемешиваем…' : 'Перемешать вопросы'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setBankOpen(true)}>
            <NavIcon name="book" /> База вопросов
          </button>
        </div>
      </div>
      <ErrorText value={error} />

      <div className="call-picker">
        <span className="call-picker-label">Кандидаты в обзвоне:</span>
        {candidates.length ? candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={selected.includes(c.id)}
            className={`call-chip${selected.includes(c.id) ? ' active' : ''}`}
            onClick={() => toggleCandidate(c.id)}
          >
            {candidateName(c)}
          </button>
        )) : (
          <span className="call-picker-empty">Кандидатов нет — сначала одобрите заявки во вкладке «Заявки».</span>
        )}
      </div>

      <div className="call-sheet-wrap">
        <table className="call-sheet" style={{ '--call-cols': candidateCols } as CSSProperties}>
          <colgroup>
            <col className="call-col-question" />
            <col className="call-col-answer" />
            {Array.from({ length: candidateCols }, (_, i) => <col key={i} className="call-col-score" />)}
          </colgroup>
          <tbody>
            <tr>
              <td colSpan={2} className="call-greeting">{CALL_GREETING}</td>
              {columns.length ? columns.map((c) => {
                const t = totals.get(c.id)!;
                return (
                  <th key={c.id} className="call-candidate" scope="col">
                    <div className="call-candidate-name">{candidateName(c)}</div>
                    <div className="call-stats">
                      <span>Вопросов: <b>{t.total}</b></span>
                      <span>Баллов: <b>{fmt(t.points)}</b></span>
                      <span>Правильных: <b>{fmt(t.percent)}%</b></span>
                    </div>
                  </th>
                );
              }) : (
                <th className="call-candidate call-candidate-empty" scope="col">Кандидат не выбран</th>
              )}
            </tr>

            {CALL_FIXED_QUESTIONS.map((text, index) => (
              <tr key={text}>
                <td colSpan={2} className="call-fixed">{text}</td>
                {index === 0 && (
                  <td
                    colSpan={candidateCols}
                    rowSpan={CALL_FIXED_QUESTIONS.length}
                    className="call-fixed-side"
                  >
                    Вопросы без оценки
                  </td>
                )}
              </tr>
            ))}

            <tr>
              <td colSpan={2} className="call-note">{CALL_MAIN_INTRO}</td>
              <td colSpan={candidateCols} className="call-fixed-side" />
            </tr>

            <tr className="call-head">
              <th scope="col">Вопросы ({CALL_QUESTIONS_COUNT})</th>
              <th scope="col">Ответы</th>
              {columns.length ? columns.map((c) => (
                <th key={c.id} scope="col">1 / 0.5 / 0</th>
              )) : <th scope="col">Оценка</th>}
            </tr>

            {questions.length ? questions.map((q) => (
              <tr key={q.id} className="call-row">
                <td className="call-question">
                  {q.category && <span className="badge badge-purple call-category">{q.category}</span>}
                  {q.question}
                </td>
                <td className="call-answer">{q.answer}</td>
                {columns.length ? columns.map((c) => (
                  <td key={c.id} className="call-score-cell">
                    <ScoreButtons
                      value={scores[scoreKey(c.id, q.id)] ?? null}
                      disabled={!canEdit}
                      onChange={(next) => void setScore(c.id, q.id, next)}
                    />
                  </td>
                )) : <td className="call-score-cell call-score-none">—</td>}
              </tr>
            )) : (
              <tr>
                <td colSpan={2 + candidateCols} className="call-empty">{emptyHint}</td>
              </tr>
            )}

            <tr>
              <td colSpan={2} className="call-note">{CALL_OUTRO}</td>
              <td colSpan={candidateCols} className="call-fixed-side" />
            </tr>
          </tbody>
        </table>
      </div>

      {bankOpen && (
        <CallBankModal
          canEdit={canEdit}
          onClose={() => setBankOpen(false)}
          onTotalChange={setBankTotal}
        />
      )}
    </>
  );
}

type Category = { id: number; name: string; question_count: number };
type BankQuestion = { id: number; category_id: number | null; category_name: string | null; question: string; answer: string };
type BankMode = { kind: 'list' } | { kind: 'categories' } | { kind: 'question'; item: BankQuestion | null };

const NO_CATEGORY = 'none';

function CallBankModal({
  canEdit,
  onClose,
  onTotalChange,
}: {
  canEdit: boolean;
  onClose: () => void;
  onTotalChange: (total: number) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<BankMode>({ kind: 'list' });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  async function reload() {
    try {
      const data = await request('/api/call/bank');
      setCategories(data.categories || []);
      setItems(data.questions || []);
      onTotalChange((data.questions || []).length);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, []);

  const filtered = useMemo(() => items.filter((item) => {
    if (filter === NO_CATEGORY && item.category_id !== null) return false;
    if (filter !== 'all' && filter !== NO_CATEGORY && String(item.category_id) !== filter) return false;
    return matchesSearch([item.question, item.answer, item.category_name], search);
  }), [items, filter, search]);

  const filterOptions = [
    { value: 'all', label: 'Все категории' },
    { value: NO_CATEGORY, label: 'Без категории' },
    ...categories.map((c) => ({ value: String(c.id), label: `${c.name} (${c.question_count})` })),
  ];

  async function saveQuestion(event: FormEvent<HTMLFormElement>, id: number | null, categoryValue: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      categoryId: categoryValue === NO_CATEGORY ? null : Number(categoryValue),
      question: form.get('question'),
      answer: form.get('answer'),
    };
    setError('');
    try {
      if (id) await request(`/api/call/questions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await request('/api/call/questions', { method: 'POST', body: JSON.stringify(payload) });
      setMode({ kind: 'list' });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeQuestion(id: number) {
    if (!(await askConfirm('Удалить вопрос из базы? В уже собранных листах он останется.', {
      title: 'Удаление вопроса',
      confirmLabel: 'Удалить',
    }))) return;
    setError('');
    try {
      await request(`/api/call/questions/${id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const title = mode.kind === 'categories'
    ? 'Категории вопросов'
    : mode.kind === 'question'
      ? (mode.item ? 'Редактирование вопроса' : 'Новый вопрос')
      : 'База вопросов';

  return (
    <Modal title={title} onClose={onClose} xl>
      <ErrorText value={error} />
      {mode.kind === 'list' && (
        <>
          <div className="toolbar call-bank-toolbar">
            <div className="toolbar-left" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{filtered.length}{filtered.length !== items.length ? ` из ${items.length}` : ''} вопросов</span>
              <SearchBox value={search} onChange={setSearch} placeholder="Вопрос, ответ, категория…" />
              <div className="call-bank-filter">
                <Select value={filter} options={filterOptions} onChange={setFilter} />
              </div>
            </div>
            {canEdit && (
              <div className="toolbar-right">
                <button className="btn btn-ghost btn-sm" onClick={() => setMode({ kind: 'categories' })}>Категории</button>
                <button className="btn btn-primary btn-sm" onClick={() => setMode({ kind: 'question', item: null })}>
                  <NavIcon name="plus" /> Вопрос
                </button>
              </div>
            )}
          </div>
          {loading ? <div className="empty-state"><h3>Загрузка…</h3></div> : (
            <>
              {filtered.map((item) => (
                <div className="call-bank-item" key={item.id}>
                  <div className="call-bank-body">
                    <div className="call-bank-meta">
                      <span className={`badge ${item.category_name ? 'badge-purple' : 'badge-muted'}`}>
                        {item.category_name || 'Без категории'}
                      </span>
                    </div>
                    <div className="call-bank-question">{item.question}</div>
                    <div className="call-bank-answer"><b>Ответ:</b> {item.answer}</div>
                  </div>
                  {canEdit && (
                    <div className="row-actions">
                      <button className="icon-btn" title="Изменить" onClick={() => setMode({ kind: 'question', item })}><NavIcon name="edit" /></button>
                      <button className="icon-btn danger" title="Удалить" onClick={() => void removeQuestion(item.id)}><NavIcon name="trash" /></button>
                    </div>
                  )}
                </div>
              ))}
              {!filtered.length && (
                <div className="empty-state">
                  <h3>{items.length ? 'Ничего не найдено' : 'В базе пока нет вопросов'}</h3>
                </div>
              )}
            </>
          )}
        </>
      )}

      {mode.kind === 'question' && (
        <QuestionForm
          key={mode.item?.id ?? 'new'}
          item={mode.item}
          categories={categories}
          onCancel={() => { setError(''); setMode({ kind: 'list' }); }}
          onSubmit={saveQuestion}
        />
      )}

      {mode.kind === 'categories' && (
        <CategoriesEditor
          categories={categories}
          setError={setError}
          reload={reload}
          onBack={() => { setError(''); setMode({ kind: 'list' }); }}
        />
      )}
    </Modal>
  );
}

function QuestionForm({
  item,
  categories,
  onCancel,
  onSubmit,
}: {
  item: BankQuestion | null;
  categories: Category[];
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>, id: number | null, categoryValue: string) => void;
}) {
  const [category, setCategory] = useState(item?.category_id ? String(item.category_id) : NO_CATEGORY);
  return (
    <form onSubmit={(event) => onSubmit(event, item?.id ?? null, category)}>
      <div className="field">
        <label>Категория</label>
        <Select
          value={category}
          onChange={setCategory}
          options={[{ value: NO_CATEGORY, label: 'Без категории' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
        />
        {!categories.length && <div className="field-hint">Категорий пока нет — создайте их через кнопку «Категории».</div>}
      </div>
      <div className="field">
        <label>Вопрос</label>
        <textarea className="input input-compact" name="question" required maxLength={1000} defaultValue={item?.question || ''} />
      </div>
      <div className="field">
        <label>Ответ</label>
        <textarea className="input input-compact" name="answer" required maxLength={2000} defaultValue={item?.answer || ''} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Отмена</button>
        <button className="btn btn-primary">Сохранить</button>
      </div>
    </form>
  );
}

function CategoriesEditor({
  categories,
  setError,
  reload,
  onBack,
}: {
  categories: Category[];
  setError: (value: string) => void;
  reload: () => Promise<void>;
  onBack: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await request('/api/call/categories', { method: 'POST', body: JSON.stringify({ name }) });
      setNewName('');
    });
  }

  async function rename(id: number) {
    const name = editName.trim();
    if (!name) return;
    await run(async () => {
      await request(`/api/call/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      setEditingId(null);
    });
  }

  async function remove(category: Category) {
    const note = category.question_count
      ? `Вопросы категории (${category.question_count}) останутся в базе без категории.`
      : 'Категория пустая.';
    if (!(await askConfirm(`Удалить категорию «${category.name}»? ${note}`, {
      title: 'Удаление категории',
      confirmLabel: 'Удалить',
    }))) return;
    await run(() => request(`/api/call/categories/${category.id}`, { method: 'DELETE' }));
  }

  return (
    <>
      <form className="call-category-add" onSubmit={add}>
        <input
          className="input"
          value={newName}
          maxLength={80}
          placeholder="Название новой категории"
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" disabled={!newName.trim()}><NavIcon name="plus" /> Добавить</button>
      </form>
      {categories.map((category) => (
        <div className="call-bank-item" key={category.id}>
          <div className="call-bank-body">
            {editingId === category.id ? (
              <div className="call-category-add">
                <input
                  className="input"
                  value={editName}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void rename(category.id); }}
                />
                <button className="btn btn-primary btn-sm" onClick={() => void rename(category.id)}>Сохранить</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Отмена</button>
              </div>
            ) : (
              <Fragment>
                <div className="call-bank-question">{category.name}</div>
                <div className="call-bank-answer">Вопросов: {category.question_count}</div>
              </Fragment>
            )}
          </div>
          {editingId !== category.id && (
            <div className="row-actions">
              <button className="icon-btn" title="Переименовать" onClick={() => { setEditingId(category.id); setEditName(category.name); }}><NavIcon name="edit" /></button>
              <button className="icon-btn danger" title="Удалить" onClick={() => void remove(category)}><NavIcon name="trash" /></button>
            </div>
          )}
        </div>
      ))}
      {!categories.length && <div className="empty-state"><h3>Категорий пока нет</h3></div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>← К вопросам</button>
      </div>
    </>
  );
}
