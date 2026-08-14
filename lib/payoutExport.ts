/** Сборка игровых команд выдачи (без DB). */

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(n: number): number {
  return Math.round(n);
}

export type PayoutExportRow = {
  include_in_payout: boolean;
  static_id: string;
  nickname?: string;
  events_mc: number;
  events_dollars: number;
  fixed_mc?: number;
  fixed_dollars?: number;
  bonus_mc: number;
  bonus_dollars: number;
  comp_static_id: string;
  comp_dollars: number;
};

export type PayoutExportResult = {
  mc: string;
  dollars: string;
  compensation: string;
  all: string;
  skipped: string[];
  counts: {
    mc: number;
    dollars: number;
    compensation: number;
    skipped: number;
  };
};

export function buildExportCommands(rows: PayoutExportRow[]): PayoutExportResult {
  const mc: string[] = [];
  const dollars: string[] = [];
  const comp: string[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (!row.include_in_payout) continue;
    const sid = String(row.static_id || '').trim();
    const nick = String(row.nickname || '').trim() || 'без ника';
    const mcSum = roundMoney(num(row.events_mc) + num(row.fixed_mc) + num(row.bonus_mc));
    const dSum = roundMoney(num(row.events_dollars) + num(row.fixed_dollars) + num(row.bonus_dollars));
    const cSum = roundMoney(num(row.comp_dollars));
    const cSid = String(row.comp_static_id || sid).trim();
    const needsPay = mcSum > 0 || dSum > 0 || cSum > 0;
    if (needsPay && !sid && !(cSum > 0 && cSid)) {
      skipped.push(
        `${nick}: ${mcSum} MC / ${dSum}$`
        + (cSum > 0 ? ` · компенсация ${cSum}$` : '')
        + ' — нет Static ID',
      );
      continue;
    }
    if (sid && mcSum > 0) mc.push(`/givedonate ${sid} ${Math.round(mcSum)} eventhelper`);
    if (sid && dSum > 0) dollars.push(`/givemoney ${sid} ${Math.round(dSum)} eventhelper`);
    if (cSid && cSum > 0) comp.push(`/givemoney ${cSid} ${Math.round(cSum)} compenseh`);
  }
  return {
    mc: mc.join('\n'),
    dollars: dollars.join('\n'),
    compensation: comp.join('\n'),
    all: [...mc, ...dollars, ...comp].join('\n'),
    skipped,
    counts: {
      mc: mc.length,
      dollars: dollars.length,
      compensation: comp.length,
      skipped: skipped.length,
    },
  };
}
