import { weekTimeZone } from '@/lib/weekBounds';

export type StatsPeriod = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

export type StatsRangeInput = {
  period: StatsPeriod;
  /** ISO / datetime-local для custom */
  from?: string | null;
  to?: string | null;
};

export type StatsRange = StatsRangeInput & {
  tz: string;
  label: string;
  /** Для custom: inclusive start ISO */
  fromIso: string | null;
  /** Для custom: exclusive end ISO */
  toIso: string | null;
};

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  day: 'За день',
  week: 'За неделю',
  month: 'За месяц',
  year: 'За год',
  all: 'За всё время',
  custom: 'Свой период',
};

export function parseStatsPeriod(raw: unknown): StatsPeriod {
  const v = String(raw || 'week');
  if (v === 'day' || v === 'week' || v === 'month' || v === 'year' || v === 'all' || v === 'custom') {
    return v;
  }
  return 'week';
}

export function buildStatsRange(input: StatsRangeInput): StatsRange {
  const tz = weekTimeZone();
  const period = input.period;
  let fromIso: string | null = null;
  let toIso: string | null = null;
  let label = PERIOD_LABELS[period];

  if (period === 'custom') {
    const fromRaw = input.from ? new Date(input.from) : null;
    const toRaw = input.to ? new Date(input.to) : null;
    if (fromRaw && !Number.isNaN(fromRaw.getTime())) fromIso = fromRaw.toISOString();
    if (toRaw && !Number.isNaN(toRaw.getTime())) {
      // «по» включительно до конца выбранной минуты
      toIso = new Date(toRaw.getTime() + 60_000).toISOString();
    }
    const fromLabel = fromRaw && !Number.isNaN(fromRaw.getTime())
      ? fromRaw.toLocaleString('ru-RU')
      : '…';
    const toLabel = toRaw && !Number.isNaN(toRaw.getTime())
      ? toRaw.toLocaleString('ru-RU')
      : '…';
    label = `Свой период · ${fromLabel} — ${toLabel}`;
  }

  return { period, from: input.from || null, to: input.to || null, tz, label, fromIso, toIso };
}

/**
 * Условие SQL по периоду.
 * params: [tz, fromIso, toIso] — всегда 3 параметра ($1,$2,$3), лишние null.
 */
export function sqlStatsRange(expr: string): string {
  // period передаётся отдельно через CASE нельзя — строим снаружи.
  // Используем: $1=tz, $2=from, $3=to, а режим выбирает вызывающий код.
  return `(
    ($4::text = 'all')
    OR ($4::text = 'custom' AND ($2::timestamptz IS NULL OR ${expr} >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR ${expr} < $3::timestamptz))
    OR ($4::text = 'day' AND (${expr} AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date)
    OR ($4::text = 'week' AND (${expr} AT TIME ZONE $1) >= date_trunc('week', now() AT TIME ZONE $1)
        AND (${expr} AT TIME ZONE $1) < date_trunc('week', now() AT TIME ZONE $1) + interval '7 days')
    OR ($4::text = 'month' AND (${expr} AT TIME ZONE $1) >= date_trunc('month', now() AT TIME ZONE $1)
        AND (${expr} AT TIME ZONE $1) < date_trunc('month', now() AT TIME ZONE $1) + interval '1 month')
    OR ($4::text = 'year' AND (${expr} AT TIME ZONE $1) >= date_trunc('year', now() AT TIME ZONE $1)
        AND (${expr} AT TIME ZONE $1) < date_trunc('year', now() AT TIME ZONE $1) + interval '1 year')
  )`;
}

export function statsRangeParams(range: StatsRange): [string, string | null, string | null, string] {
  return [range.tz, range.fromIso, range.toIso, range.period];
}

/** Шаг группировки для графиков — всегда календарные периоды, без часов. */
export function chartBucket(
  period: StatsPeriod,
  range?: Pick<StatsRange, 'fromIso' | 'toIso'>,
): 'day' | 'week' | 'month' {
  if (period === 'day' || period === 'week' || period === 'month') return 'day';
  if (period === 'year') return 'week';
  if (period === 'custom' && range?.fromIso && range?.toIso) {
    const days =
      (new Date(range.toIso).getTime() - new Date(range.fromIso).getTime()) / 86_400_000;
    if (days <= 45) return 'day';
    if (days <= 400) return 'week';
  }
  return 'month';
}
