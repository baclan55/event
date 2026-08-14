'use client';

import { FormEvent, useMemo, useState } from 'react';
import { NavIcon } from '@/components/NavIcons';
import { askConfirm, Avatar, ErrorText, Modal, request, type Row } from './shared';

type MainTab = 'calendar' | 'applications';
type AppsFilter = 'all' | 'pending' | 'approved' | 'rejected';

export function VacationsInteractive({
  initialRows,
  currentUserId,
  canReview,
  canEditReview = false,
}: {
  initialRows: Row[];
  currentUserId: number;
  canReview: boolean;
  canEditReview?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [mainTab, setMainTab] = useState<MainTab>('calendar');
  const [appsFilter, setAppsFilter] = useState<AppsFilter>('all');
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [pickerMonth, setPickerMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [reason, setReason] = useState('');
  const [selectedVacation, setSelectedVacation] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const today = new Date();
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const monthTitle = (date: Date) => date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const calendarDays = (date: Date) => {
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  };
  const statusLabel = (value: string) => (
    value === 'approved' ? 'Одобрено'
      : value === 'rejected' ? 'Отклонено'
        : value === 'cancelled' ? 'Отменено'
          : 'На рассмотрении'
  );
  const statusBadge = (value: string) => (
    value === 'approved' ? 'green'
      : value === 'rejected' ? 'red'
        : value === 'cancelled' ? 'muted'
          : 'amber'
  );
  const dateKey = (value: unknown) => {
    const raw = String(value || '');
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : iso(new Date(raw));
  };
  const dayRows = (date: Date) => rows.filter((row) => {
    const value = iso(date);
    return row.status !== 'cancelled' && value >= dateKey(row.start_date) && value <= dateKey(row.end_date);
  });
  const pending = rows.filter((row) => row.status === 'pending');
  const mine = rows.filter((row) => row.user_id === currentUserId);
  const todayRows = dayRows(today);
  const monthDays = calendarDays(month);
  const weeks = Array.from({ length: 6 }, (_, index) => monthDays.slice(index * 7, index * 7 + 7));

  const filteredApps = useMemo(() => {
    if (appsFilter === 'pending') return rows.filter((row) => row.status === 'pending');
    if (appsFilter === 'approved') return rows.filter((row) => row.status === 'approved');
    if (appsFilter === 'rejected') return rows.filter((row) => row.status === 'rejected');
    // Все заявки — без отменённых (их видно в «Мои», если нужно)
    return rows.filter((row) => row.status !== 'cancelled');
  }, [rows, appsFilter]);

  const filterCounts = useMemo(() => ({
    all: rows.filter((row) => row.status !== 'cancelled').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    approved: rows.filter((row) => row.status === 'approved').length,
    rejected: rows.filter((row) => row.status === 'rejected').length,
  }), [rows]);

  function segmentsForWeek(week: Date[]) {
    const weekStart = iso(week[0]);
    const weekEnd = iso(week[6]);
    const laneEnds: number[] = [];
    const segments = rows
      .filter((row) => row.status !== 'cancelled' && dateKey(row.start_date) <= weekEnd && dateKey(row.end_date) >= weekStart)
      .sort((a, b) => dateKey(a.start_date).localeCompare(dateKey(b.start_date)))
      .map((row) => {
        const start = Math.max(0, week.findIndex((day) => iso(day) >= dateKey(row.start_date)));
        let end = week.findIndex((day) => iso(day) > dateKey(row.end_date));
        if (end < 0) end = 7;
        let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = end;
        return { row, start, end, lane };
      });
    return { segments, lanes: Math.max(1, laneEnds.length) };
  }

  async function reload() {
    const data = await request('/api/vacations');
    setRows(data.vacations || []);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rangeStart) return setError('Выберите период отпуска.');
    if (!reason.trim()) return setError('Укажите причину отпуска.');
    try {
      await request('/api/vacations', { method: 'POST', body: JSON.stringify({ startDate: rangeStart, endDate: rangeEnd || rangeStart, reason: reason.trim() }) });
      setAdding(false); setRangeStart(''); setRangeEnd(''); setReason(''); await reload();
    }
    catch (err) { setError((err as Error).message); }
  }
  async function status(id: number, value: string) {
    try { await request(`/api/vacations/${id}`, { method: 'PUT', body: JSON.stringify({ status: value }) }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }
  async function remove(id: number) {
    if (!(await askConfirm('Удалить заявку на отпуск?', { title: 'Удаление', confirmLabel: 'Удалить' }))) return;
    try { await request(`/api/vacations/${id}`, { method: 'DELETE' }); await reload(); }
    catch (err) { setError((err as Error).message); }
  }

  function chooseDate(value: string) {
    if (!rangeStart || rangeEnd) {
      setRangeStart(value); setRangeEnd('');
    } else if (value < rangeStart) {
      setRangeEnd(rangeStart); setRangeStart(value);
    } else {
      setRangeEnd(value);
    }
  }

  function renderAppRow(row: Row) {
    return (
      <div className="roster-row" key={row.id}>
        <Avatar row={row} />
        <div className="who">
          <div>
            <div className="nickname">{row.nickname}</div>
            <div className="role-tag">
              {new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}
              {row.reason ? ` · ${row.reason}` : ''}
            </div>
          </div>
        </div>
        <span className={`badge badge-${statusBadge(String(row.status))}`}>{statusLabel(String(row.status))}</span>
        {canEditReview && row.status === 'pending' ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => void status(row.id, 'approved')}>Одобрить</button>
            <button className="btn btn-danger btn-sm" onClick={() => void status(row.id, 'rejected')}>Отклонить</button>
          </>
        ) : null}
        {canEditReview ? (
          <button className="icon-btn danger" onClick={() => void remove(row.id)}><NavIcon name="trash" /></button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <ErrorText value={error} />

      <div className="segmented roster-tabs" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={mainTab === 'calendar' ? 'active' : ''}
          onClick={() => setMainTab('calendar')}
        >
          Календарь
        </button>
        {canReview ? (
          <button
            type="button"
            className={mainTab === 'applications' ? 'active' : ''}
            onClick={() => {
              setMainTab('applications');
              setAppsFilter('pending');
            }}
          >
            Заявки{pending.length ? ` · ${pending.length}` : ''}
          </button>
        ) : null}
      </div>

      {mainTab === 'calendar' ? (
        <div className="vac-layout">
          <div className="card card-pad">
            <div className="vac-cal-header">
              <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
              <div className="vac-cal-title">{monthTitle(month)}</div>
              <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
              <div className="vac-cal-spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Сегодня</button>
            </div>
            <div className="vac-cal-scroll"><div className="vac-cal-inner">
              <div className="vac-cal-weekdays">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div key={day}>{day}</div>)}</div>
              <div className="vac-cal-grid">{weeks.map((week) => {
                const { segments, lanes } = segmentsForWeek(week);
                return <div className="vac-week" key={iso(week[0])}>
                  <div className="vac-week-cells">{week.map((day) => {
                    const entries = dayRows(day);
                    return <div className={`vac-day-cell${day.getMonth() !== month.getMonth() ? ' is-muted' : ''}`} key={iso(day)}>
                      <div className={`vac-day-num${iso(day) === iso(today) ? ' is-today' : ''}`}>{day.getDate()}</div>
                      <div className="vac-day-bars-space" style={{ height: lanes * 21 }} />
                      <div className={`vac-day-occupancy${entries.length >= 3 ? ' is-near' : ''}`}>{entries.length}/3</div>
                    </div>;
                  })}</div>
                  <div className="vac-week-bars">{segments.map(({ row, start, end, lane }) => <button type="button" className={`vac-bar status-${row.status}${dateKey(row.start_date) >= iso(week[0]) ? ' round-l' : ''}${dateKey(row.end_date) <= iso(week[6]) ? ' round-r' : ''}`} style={{ gridColumn: `${start + 1} / ${end + 1}`, gridRow: lane + 1 }} key={`${row.id}-${iso(week[0])}`} title={`${row.nickname} · ${statusLabel(row.status)}`} onClick={() => setSelectedVacation(row)}><span className="vac-bar-dot" /><span className="vac-bar-label">{row.nickname}</span></button>)}</div>
                </div>;
              })}</div>
            </div></div>
            <div className="vac-legend"><span className="vac-legend-item"><i className="vac-legend-dot status-approved" />Одобрено</span><span className="vac-legend-item"><i className="vac-legend-dot status-pending" />На рассмотрении</span><span className="vac-legend-item"><i className="vac-legend-dot status-rejected" />Отклонено</span></div>
          </div>

          <aside className="vac-sidebar">
            <div className="card card-pad">
              <div className="vac-today-label">Сегодня</div><div className="vac-today-date">{today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              <div className="vac-today-list">{todayRows.map((row) => <div className="vac-today-row" key={row.id}><div className="vac-today-row-head"><span className="nickname">{row.nickname}</span><span className={`badge badge-${row.status === 'approved' ? 'green' : 'amber'}`}>{statusLabel(row.status)}</span></div><div className="vac-today-row-dates">{new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}</div></div>)}{!todayRows.length && <div className="role-tag">Сегодня никто не в отпуске.</div>}</div>
              <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><NavIcon name="plus" /> Новый отпуск</button>
            </div>
            <div className="card card-pad"><div className="card-header"><h3>Мои заявки</h3></div>{mine.map((row) => <div className="vac-today-row" key={row.id}><div className="vac-today-row-head"><span className="vac-today-row-dates">{new Date(row.start_date).toLocaleDateString('ru-RU')} — {new Date(row.end_date).toLocaleDateString('ru-RU')}</span><span className={`badge badge-${row.status === 'approved' ? 'green' : row.status === 'rejected' ? 'red' : 'amber'}`}>{statusLabel(row.status)}</span></div>{row.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => void status(row.id, 'cancelled')}>Отменить</button>}</div>)}</div>
          </aside>
        </div>
      ) : null}

      {mainTab === 'applications' && canReview ? (
        <>
          <div className="segmented roster-tabs" style={{ marginBottom: 16 }}>
            <button type="button" className={appsFilter === 'all' ? 'active' : ''} onClick={() => setAppsFilter('all')}>
              Все заявки · {filterCounts.all}
            </button>
            <button type="button" className={appsFilter === 'pending' ? 'active' : ''} onClick={() => setAppsFilter('pending')}>
              Рассмотренные · {filterCounts.pending}
            </button>
            <button type="button" className={appsFilter === 'approved' ? 'active' : ''} onClick={() => setAppsFilter('approved')}>
              Одобренные · {filterCounts.approved}
            </button>
            <button type="button" className={appsFilter === 'rejected' ? 'active' : ''} onClick={() => setAppsFilter('rejected')}>
              Отклонённые · {filterCounts.rejected}
            </button>
          </div>
          <div className="card card-pad">
            {filteredApps.map((row) => renderAppRow(row))}
            {!filteredApps.length && (
              <div className="empty-state"><h3>Заявок нет</h3></div>
            )}
          </div>
        </>
      ) : null}

      {selectedVacation && (
        <Modal title={selectedVacation.nickname} onClose={() => setSelectedVacation(null)}>
          <div className="modal-sub">{new Date(selectedVacation.start_date).toLocaleDateString('ru-RU')} — {new Date(selectedVacation.end_date).toLocaleDateString('ru-RU')} · {statusLabel(selectedVacation.status)}</div>
          {selectedVacation.reason && <p className="rule-text" style={{ textAlign: 'center' }}>{selectedVacation.reason}</p>}
          <div className="modal-actions">
            {canEditReview && selectedVacation.status === 'pending' && (
              <>
                <button className="btn btn-danger" onClick={() => { void status(selectedVacation.id, 'rejected'); setSelectedVacation(null); }}>Отклонить</button>
                <button className="btn btn-primary" onClick={() => { void status(selectedVacation.id, 'approved'); setSelectedVacation(null); }}>Одобрить</button>
              </>
            )}
            {selectedVacation.user_id === currentUserId && selectedVacation.status === 'pending' && (
              <button className="btn btn-ghost" onClick={() => { void status(selectedVacation.id, 'cancelled'); setSelectedVacation(null); }}>Отменить заявку</button>
            )}
          </div>
        </Modal>
      )}

      {adding && <Modal title="Новый отпуск" onClose={() => setAdding(false)}><form onSubmit={create}><ErrorText value={error} /><div className="field"><label>Период отпуска</label><div className="vac-period-trigger"><span>{rangeStart ? `${new Date(`${rangeStart}T00:00:00`).toLocaleDateString('ru-RU')} — ${new Date(`${rangeEnd || rangeStart}T00:00:00`).toLocaleDateString('ru-RU')}` : 'Выберите даты'}</span></div><div className="vac-mini-cal"><div className="vac-mini-head"><button type="button" className="icon-btn" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() - 1, 1))}>‹</button><b>{monthTitle(pickerMonth)}</b><button type="button" className="icon-btn" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 1))}>›</button></div><div className="vac-mini-grid">{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <div className="vac-mini-wd" key={day}>{day}</div>)}{calendarDays(pickerMonth).map((day) => { const value = iso(day); const inRange = rangeStart && value >= rangeStart && value <= (rangeEnd || rangeStart); return <button type="button" className={`vac-mini-day${day.getMonth() !== pickerMonth.getMonth() ? ' is-muted' : ''}${value === rangeStart ? ' range-start' : ''}${value === rangeEnd ? ' range-end' : ''}${inRange ? ' in-range' : ''}${value === iso(today) ? ' is-today' : ''}`} key={value} onClick={() => chooseDate(value)}>{day.getDate()}</button>; })}</div><div className="vac-mini-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRangeStart(''); setRangeEnd(''); }}>Сбросить</button></div></div></div><div className="field"><label>Причина</label><textarea className="input" value={reason} required onChange={(event) => setReason(event.target.value)} /></div><div className="modal-actions"><button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>Отмена</button><button className="btn btn-primary">Создать</button></div></form></Modal>}
    </>
  );
}
