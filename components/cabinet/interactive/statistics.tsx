'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  STATS_CAP_LABELS,
  STATS_CAP_PATHS,
  type StatsCap,
} from '@/lib/roleAccess';
import type { StatsPeriod } from '@/lib/statisticsRange';
import { ErrorText, request } from './shared';

type Point = { label: string; value: number | string; href?: string };

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Свой' },
];

function StatCards({ items }: { items: Array<{ value: number | string; label: string }> }) {
  const cols = Math.min(Math.max(items.length, 1), 4);
  return (
    <div className="stat-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {items.map((item) => (
        <div className="card card-pad stat-card" key={item.label}>
          <div className="stat-value">{item.value}</div>
          <div className="stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function ListCard({ title, rows, empty }: { title: string; rows: Point[]; empty: string }) {
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>{title}</h3></div>
      {rows.length ? rows.map((row) => (
        <div className="dash-mp-row" key={`${row.label}-${row.value}`}>
          {row.href ? <a className="dash-mp-title" href={row.href}>{row.label}</a> : <div className="dash-mp-title">{row.label}</div>}
          <span className="badge badge-muted">{row.value}</span>
        </div>
      )) : <div className="empty-state"><p>{empty}</p></div>}
    </div>
  );
}

function BarChart({ title, points }: { title: string; points: Point[] }) {
  const max = Math.max(1, ...points.map((p) => Number(p.value) || 0));
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>{title}</h3></div>
      {points.length ? (
        <div className="stats-bars">
          {points.map((p) => {
            const v = Number(p.value) || 0;
            const h = Math.max(4, Math.round((v / max) * 120));
            return (
              <div className="stats-bar-col" key={String(p.label)} title={`${p.label}: ${v}`}>
                <div className="stats-bar-value">{v}</div>
                <div className="stats-bar-track"><div className="stats-bar-fill" style={{ height: h }} /></div>
                <div className="stats-bar-label">{p.label}</div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-state"><p>Нет данных за период</p></div>}
    </div>
  );
}

function LineChart({ title, points }: { title: string; points: Point[] }) {
  const values = points.map((p) => Number(p.value) || 0);
  const max = Math.max(1, ...values);
  const w = 560;
  const h = 140;
  const pad = 12;
  const coords = values.map((v, i) => {
    const x = pad + (values.length <= 1 ? 0 : (i / (values.length - 1)) * (w - pad * 2));
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const polyline = coords.join(' ');
  return (
    <div className="card card-pad">
      <div className="card-header"><h3>{title}</h3></div>
      {points.length ? (
        <div className="stats-line-wrap">
          <svg viewBox={`0 0 ${w} ${h}`} className="stats-line-svg" role="img" aria-label={title}>
            <polyline fill="none" stroke="var(--accent-light)" strokeWidth="2.5" points={polyline} />
            {coords.map((c, i) => {
              const [x, y] = c.split(',').map(Number);
              return <circle key={points[i].label} cx={x} cy={y} r="3.2" fill="var(--accent)" />;
            })}
          </svg>
          <div className="stats-line-legend">
            <span>{points[0]?.label}</span>
            <span>{points[points.length - 1]?.label}</span>
          </div>
        </div>
      ) : <div className="empty-state"><p>Нет данных за период</p></div>}
    </div>
  );
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StatisticsInteractive({
  section,
  allowed,
}: {
  section: StatsCap;
  allowed: StatsCap[];
}) {
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    return toLocalInputValue(d);
  });
  const [to, setTo] = useState(() => toLocalInputValue(new Date()));
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (nextPeriod = period, nextFrom = from, nextTo = to) => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ period: nextPeriod });
      if (nextPeriod === 'custom') {
        if (nextFrom) qs.set('from', new Date(nextFrom).toISOString());
        if (nextTo) qs.set('to', new Date(nextTo).toISOString());
      }
      const json = await request(`/api/statistics/${section}?${qs.toString()}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, from, to, section]);

  useEffect(() => { void load(); }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  function onPeriod(next: StatsPeriod) {
    setPeriod(next);
    if (next !== 'custom') void load(next, from, to);
  }

  function onCustom(e: FormEvent) {
    e.preventDefault();
    setPeriod('custom');
    void load('custom', from, to);
  }

  const rangeLabel = (data?.range as { label?: string } | undefined)?.label || '';
  const totals = (data?.totals || {}) as Record<string, number>;
  const series = (data?.series || []) as Point[];
  const seriesMp = ((data?.series as { mp?: Point[] } | undefined)?.mp || series) as Point[];

  return (
    <>
      <div className="toolbar stats-toolbar">
        <div className="toolbar-left" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {allowed.map((cap) => (
            <a
              key={cap}
              className={`btn btn-sm ${cap === section ? 'btn-primary' : 'btn-ghost'}`}
              href={STATS_CAP_PATHS[cap]}
            >
              {STATS_CAP_LABELS[cap]}
            </a>
          ))}
        </div>
      </div>

      <div className="card card-pad stats-period-card">
        <div className="segmented stats-period-seg">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={period === item.id ? 'active' : ''}
              onClick={() => onPeriod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <form className="stats-custom-range" onSubmit={onCustom}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>С</label>
              <input className="input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>По</label>
              <input className="input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" type="submit">Применить</button>
          </form>
        ) : null}
        <div className="field-hint" style={{ marginTop: 10 }}>
          {loading ? 'Загрузка…' : rangeLabel}
        </div>
      </div>

      <ErrorText value={error} />

      {!data && !error ? <div className="empty-state"><p>Загрузка статистики…</p></div> : null}

      {data && section === 'overview' ? (
        <>
          <StatCards items={[
            { value: totals.mpCompleted ?? 0, label: 'МП completed' },
            { value: totals.mpOpen ?? 0, label: 'МП open' },
            { value: totals.applications ?? 0, label: 'Заявки' },
            { value: totals.appsPending ?? 0, label: 'Заявки pending' },
            { value: totals.reprimands ?? 0, label: 'Выговоры' },
            { value: totals.gmp ?? 0, label: 'ГМП' },
            { value: totals.achievementGrants ?? 0, label: 'Выдачи достижений' },
            { value: totals.users ?? 0, label: 'Пользователей' },
            { value: totals.candidates ?? 0, label: 'Кандидаты' },
            { value: totals.blocked ?? 0, label: 'В блоке' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <LineChart title="Динамика МП" points={seriesMp} />
            <BarChart title="МП по периодам" points={seriesMp.slice(-14)} />
          </div>
        </>
      ) : null}

      {data && section === 'events' ? (
        <>
          <StatCards items={[
            { value: totals.completed ?? 0, label: 'Completed' },
            { value: totals.open ?? 0, label: 'Open' },
            { value: totals.abandoned ?? 0, label: 'Abandoned' },
            { value: totals.participants ?? 0, label: 'Участий' },
            { value: totals.avgParticipants ?? 0, label: 'Среднее участников' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <LineChart title="Проведения во времени" points={Array.isArray(data.series) ? data.series as Point[] : []} />
            <BarChart title="Топ названий" points={((data.byTitle as Point[]) || []).slice(0, 12)} />
          </div>
          <div style={{ marginTop: 14 }}>
            <ListCard title="Топ участников" rows={(data.topHelpers as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'users' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'Всего' },
            { value: totals.withRole ?? 0, label: 'С ролями' },
            { value: totals.helpers ?? 0, label: 'Хелперы' },
            { value: totals.admins ?? 0, label: 'Админы' },
            { value: totals.candidates ?? 0, label: 'Кандидаты' },
            { value: totals.blocked ?? 0, label: 'Блок' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <BarChart title="По ролям" points={(data.byRole as Point[]) || []} />
            <LineChart title="Назначения ролей" points={Array.isArray(data.series) ? data.series as Point[] : []} />
          </div>
          <div className="top-grid" style={{ marginTop: 14 }}>
            <ListCard title="По статусу" rows={(data.byStatus as Point[]) || []} empty="Нет данных" />
            <ListCard title="Топ по МП в периоде" rows={(data.topActive as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'achievements' ? (
        <>
          <StatCards items={[
            { value: totals.defs ?? 0, label: 'Определений' },
            { value: totals.grants ?? 0, label: 'Выдано за период' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <LineChart title="Выдачи во времени" points={Array.isArray(data.series) ? data.series as Point[] : []} />
            <BarChart title="По достижениям" points={((data.byAchievement as Point[]) || []).slice(0, 12)} />
          </div>
          <div style={{ marginTop: 14 }}>
            <ListCard title="Топ получателей" rows={(data.topUsers as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'gmp' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'ГМП' },
            { value: totals.checkpoints ?? 0, label: 'Чекпоинты' },
            { value: totals.staff ?? 0, label: 'Staff' },
            { value: totals.players ?? 0, label: 'Игроки' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <LineChart title="Создания ГМП" points={Array.isArray(data.series) ? data.series as Point[] : []} />
            <BarChart title="По статусу" points={(data.byStatus as Point[]) || []} />
          </div>
          <div style={{ marginTop: 14 }}>
            <ListCard title="Последние" rows={(data.recent as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'applications' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'Заявки' },
            { value: totals.pending ?? 0, label: 'Pending' },
            { value: totals.approved ?? 0, label: 'Approved' },
            { value: totals.rejected ?? 0, label: 'Rejected' },
            { value: totals.candidates ?? 0, label: 'Кандидаты сейчас' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <LineChart title="Заявки во времени" points={Array.isArray(data.series) ? data.series as Point[] : []} />
            <BarChart title="По статусам" points={(data.byStatus as Point[]) || []} />
          </div>
        </>
      ) : null}

      {data && section === 'reprimands' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'Всего' },
            { value: totals.active ?? 0, label: 'Активные' },
            { value: totals.converted ?? 0, label: 'Конвертированные' },
          ]} />
          <div className="top-grid" style={{ marginTop: 14 }}>
            <LineChart title="Выговоры во времени" points={Array.isArray(data.series) ? data.series as Point[] : []} />
            <BarChart title="По типу" points={(data.byType as Point[]) || []} />
          </div>
          <div className="top-grid" style={{ marginTop: 14 }}>
            <ListCard title="Топ сотрудников" rows={(data.topUsers as Point[]) || []} empty="Нет данных" />
            <ListCard title="Частые причины" rows={(data.topReasons as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}
    </>
  );
}
