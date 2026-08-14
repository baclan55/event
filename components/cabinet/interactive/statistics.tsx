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
type Tone = 'default' | 'ok' | 'warn' | 'danger' | 'accent';

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Свой' },
];

function shortLabel(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '—';
  // 2026-08-10 or 2026-08-10 12:00
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?/);
  if (day) {
    const base = `${day[3]}.${day[2]}`;
    return day[4] ? `${base} ${day[4]}:00` : base;
  }
  // 2026-W33
  const week = s.match(/^(\d{4})-W(\d{2})$/i);
  if (week) return `W${week[2]}`;
  // 2026-08
  const month = s.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[2]}.${month[1].slice(2)}`;
  return s.length > 18 ? `${s.slice(0, 16)}…` : s;
}

function asNumber(v: number | string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function StatCards({
  items,
}: {
  items: Array<{ value: number | string; label: string; tone?: Tone; hint?: string }>;
}) {
  return (
    <div className={`stats-kpi-grid stats-kpi-${Math.min(items.length, 5)}`}>
      {items.map((item) => (
        <div className={`stats-kpi stats-kpi-${item.tone || 'default'}`} key={item.label}>
          <div className="stats-kpi-value">{item.value}</div>
          <div className="stats-kpi-label">{item.label}</div>
          {item.hint ? <div className="stats-kpi-hint">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

function RankList({ title, rows, empty }: { title: string; rows: Point[]; empty: string }) {
  const numeric = rows.every((r) => Number.isFinite(Number(r.value)));
  const max = Math.max(1, ...rows.map((r) => asNumber(r.value)));
  return (
    <div className="card card-pad stats-panel">
      <div className="card-header"><h3>{title}</h3><span className="badge badge-muted">{rows.length}</span></div>
      {rows.length ? (
        <div className="stats-rank-list">
          {rows.map((row, index) => {
            const label = String(row.label || '').trim() || 'Без названия';
            const raw = row.value;
            const value = asNumber(raw);
            const width = numeric ? Math.max(6, Math.round((value / max) * 100)) : 0;
            return (
              <div className="stats-rank-row" key={`${label}-${index}`}>
                <div className="stats-rank-index">{index + 1}</div>
                <div className="stats-rank-main">
                  <div className="stats-rank-top">
                    {row.href ? <a className="stats-rank-title" href={row.href}>{label}</a> : <div className="stats-rank-title">{label}</div>}
                    <span className={`badge ${numeric ? 'badge-purple' : 'badge-muted'}`}>{raw}</span>
                  </div>
                  {numeric ? <div className="stats-rank-track"><div className="stats-rank-fill" style={{ width: `${width}%` }} /></div> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-state"><p>{empty}</p></div>}
    </div>
  );
}

function LineChart({ title, points }: { title: string; points: Point[] }) {
  const values = points.map((p) => asNumber(p.value));
  const max = Math.max(1, ...values);
  const w = 640;
  const h = 200;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const coords = values.map((v, i) => {
    const x = padL + (values.length <= 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
    const y = padT + innerH - (v / max) * innerH;
    return { x, y, v, label: shortLabel(String(points[i]?.label || '')) };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const area = coords.length
    ? `${padL},${padT + innerH} ${polyline} ${coords[coords.length - 1].x},${padT + innerH}`
    : '';

  const ticks = [0, 0.5, 1].map((t) => ({
    y: padT + innerH - t * innerH,
    label: String(Math.round(max * t)),
  }));

  const xLabels = coords.length <= 8
    ? coords
    : [coords[0], coords[Math.floor(coords.length / 2)], coords[coords.length - 1]];

  return (
    <div className="card card-pad stats-panel">
      <div className="card-header"><h3>{title}</h3></div>
      {points.length ? (
        <div className="stats-line-wrap">
          <svg viewBox={`0 0 ${w} ${h}`} className="stats-line-svg" role="img" aria-label={title}>
            {ticks.map((tick) => (
              <g key={tick.label + tick.y}>
                <line
                  x1={padL}
                  x2={w - padR}
                  y1={tick.y}
                  y2={tick.y}
                  className="stats-grid-line"
                  stroke="rgba(255,255,255,.08)"
                  strokeWidth="1"
                />
                <text
                  x={padL - 8}
                  y={tick.y + 4}
                  textAnchor="end"
                  className="stats-axis-text"
                  fill="rgba(180,180,200,.85)"
                  fontSize="11"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {area ? (
              <polygon points={area} className="stats-area-fill" fill="rgba(124,92,252,.16)" />
            ) : null}
            <polyline
              fill="none"
              className="stats-line-stroke"
              points={polyline}
              stroke="#a78bfa"
              strokeWidth="2.5"
            />
            {coords.map((c) => (
              <circle
                key={`${c.label}-${c.x}`}
                cx={c.x}
                cy={c.y}
                r="3.5"
                className="stats-line-dot"
                fill="#7c5cfc"
                stroke="#1a1528"
                strokeWidth="1.5"
              >
                <title>{`${c.label}: ${c.v}`}</title>
              </circle>
            ))}
            {xLabels.map((c) => (
              <text
                key={`x-${c.x}-${c.label}`}
                x={c.x}
                y={h - 8}
                textAnchor="middle"
                className="stats-axis-text"
                fill="rgba(180,180,200,.85)"
                fontSize="11"
              >
                {c.label}
              </text>
            ))}
          </svg>
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
  const series = (Array.isArray(data?.series) ? data?.series : ((data?.series as { mp?: Point[] } | undefined)?.mp || [])) as Point[];

  return (
    <div className={`stats-page${loading ? ' is-loading' : ''}`}>
      <div className="stats-nav">
        {allowed.map((cap) => (
          <a
            key={cap}
            className={`stats-nav-link${cap === section ? ' active' : ''}`}
            href={STATS_CAP_PATHS[cap]}
          >
            {STATS_CAP_LABELS[cap]}
          </a>
        ))}
      </div>

      <div className="card card-pad stats-period-card">
        <div className="stats-period-row">
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
          <div className="stats-period-meta">{loading ? 'Загрузка…' : rangeLabel}</div>
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
      </div>

      <ErrorText value={error} />

      {!data && !error ? <div className="empty-state"><p>Загрузка статистики…</p></div> : null}

      {data && section === 'overview' ? (
        <>
          <StatCards items={[
            { value: totals.mpCompleted ?? 0, label: 'Проведено МП', tone: 'ok' },
            { value: totals.mpOpen ?? 0, label: 'Открытые сборы', tone: 'accent' },
            { value: totals.applications ?? 0, label: 'Заявки', tone: 'accent' },
            { value: totals.appsPending ?? 0, label: 'Заявки в ожидании', tone: 'warn' },
            { value: totals.reprimands ?? 0, label: 'Выговоры', tone: 'danger' },
            { value: totals.gmp ?? 0, label: 'ГМП', tone: 'default' },
            { value: totals.achievementGrants ?? 0, label: 'Выдачи достижений', tone: 'ok' },
            { value: totals.users ?? 0, label: 'Пользователей', tone: 'default' },
            { value: totals.candidates ?? 0, label: 'Кандидаты', tone: 'warn' },
            { value: totals.blocked ?? 0, label: 'В блоке', tone: 'danger' },
          ]} />
          <div className="stats-panels">
            <LineChart title="Динамика МП" points={series} />
            <RankList title="МП по периодам" rows={series.slice(-12)} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'events' ? (
        <>
          <StatCards items={[
            { value: totals.completed ?? 0, label: 'Проведено', tone: 'ok' },
            { value: totals.open ?? 0, label: 'Открытые', tone: 'accent' },
            { value: totals.abandoned ?? 0, label: 'Сорвано', tone: 'danger' },
            { value: totals.participants ?? 0, label: 'Участий', tone: 'default' },
            { value: totals.avgParticipants ?? 0, label: 'Среднее на МП', tone: 'accent' },
          ]} />
          <div className="stats-panels">
            <LineChart title="Проведения во времени" points={series} />
            <RankList title="Топ названий" rows={((data.byTitle as Point[]) || []).slice(0, 12)} empty="Нет данных" />
          </div>
          <div className="stats-panels stats-panels-1" style={{ marginTop: 14 }}>
            <RankList title="Топ участников" rows={(data.topHelpers as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'users' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'Всего', tone: 'default' },
            { value: totals.withRole ?? 0, label: 'С ролями', tone: 'ok' },
            { value: totals.helpers ?? 0, label: 'Хелперы', tone: 'accent' },
            { value: totals.admins ?? 0, label: 'Админы', tone: 'accent' },
            { value: totals.candidates ?? 0, label: 'Кандидаты', tone: 'warn' },
            { value: totals.blocked ?? 0, label: 'Блок', tone: 'danger' },
          ]} />
          <div className="stats-panels">
            <RankList title="По ролям" rows={(data.byRole as Point[]) || []} empty="Нет данных" />
            <LineChart title="Назначения ролей" points={series} />
          </div>
          <div className="stats-panels" style={{ marginTop: 14 }}>
            <RankList title="По статусу" rows={(data.byStatus as Point[]) || []} empty="Нет данных" />
            <RankList title="Топ по МП в периоде" rows={(data.topActive as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'achievements' ? (
        <>
          <StatCards items={[
            { value: totals.defs ?? 0, label: 'Определений', tone: 'default' },
            { value: totals.grants ?? 0, label: 'Выдано за период', tone: 'ok' },
          ]} />
          <div className="stats-panels">
            <LineChart title="Выдачи во времени" points={series} />
            <RankList title="По достижениям" rows={((data.byAchievement as Point[]) || []).slice(0, 12)} empty="Нет данных" />
          </div>
          <div className="stats-panels stats-panels-1" style={{ marginTop: 14 }}>
            <RankList title="Топ получателей" rows={(data.topUsers as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'gmp' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'ГМП', tone: 'accent' },
            { value: totals.checkpoints ?? 0, label: 'Чекпоинты', tone: 'default' },
            { value: totals.staff ?? 0, label: 'Staff', tone: 'ok' },
            { value: totals.players ?? 0, label: 'Игроки', tone: 'default' },
          ]} />
          <div className="stats-panels">
            <LineChart title="Создания ГМП" points={series} />
            <RankList title="По статусу" rows={(data.byStatus as Point[]) || []} empty="Нет данных" />
          </div>
          <div className="stats-panels stats-panels-1" style={{ marginTop: 14 }}>
            <RankList title="Последние" rows={(data.recent as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'applications' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'Заявки', tone: 'default' },
            { value: totals.pending ?? 0, label: 'Ожидают', tone: 'warn' },
            { value: totals.approved ?? 0, label: 'Одобрены', tone: 'ok' },
            { value: totals.rejected ?? 0, label: 'Отклонены', tone: 'danger' },
            { value: totals.candidates ?? 0, label: 'Кандидаты сейчас', tone: 'accent' },
          ]} />
          <div className="stats-panels">
            <LineChart title="Заявки во времени" points={series} />
            <RankList title="По статусам" rows={(data.byStatus as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}

      {data && section === 'reprimands' ? (
        <>
          <StatCards items={[
            { value: totals.all ?? 0, label: 'Всего', tone: 'default' },
            { value: totals.active ?? 0, label: 'Активные', tone: 'danger' },
            { value: totals.converted ?? 0, label: 'Конвертированные', tone: 'warn' },
          ]} />
          <div className="stats-panels">
            <LineChart title="Выговоры во времени" points={series} />
            <RankList title="По типу" rows={(data.byType as Point[]) || []} empty="Нет данных" />
          </div>
          <div className="stats-panels" style={{ marginTop: 14 }}>
            <RankList title="Топ сотрудников" rows={(data.topUsers as Point[]) || []} empty="Нет данных" />
            <RankList title="Частые причины" rows={(data.topReasons as Point[]) || []} empty="Нет данных" />
          </div>
        </>
      ) : null}
    </div>
  );
}
