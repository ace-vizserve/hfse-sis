// QuickBooks' "Report period" choices, resolved to dates (yyyy-mm-dd) from
// today in Singapore. Pure; the picker and the page share it so the address
// (`?period=this-month`) and the dates always agree.

export const REPORT_PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
  { value: 'custom', label: 'Custom' },
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number]['value'];

export function isReportPeriod(v: unknown): v is ReportPeriod {
  return REPORT_PERIODS.some((p) => p.value === v);
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Last day of month m (1–12) of year y. */
const lastDay = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The first and last day of a period. `custom` has no dates of its own. */
export function periodRange(
  period: Exclude<ReportPeriod, 'custom'>,
  today: string
): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'this-month':
      return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: ymd(ly, lm, 1), to: ymd(ly, lm, lastDay(ly, lm)) };
    }
    case 'this-quarter': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, q0, 1), to: ymd(y, q0 + 2, lastDay(y, q0 + 2)) };
    }
    case 'this-year':
      return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
    case 'last-year':
      return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) };
  }
}

const isDate = (s: string | undefined): s is string =>
  !!s &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * The dates a report runs for, from the address. An "as of" report runs as of
 * the period's LAST day (QuickBooks: "This month" → as of the month's end);
 * a From–To report runs over the whole period. Custom reads the dates given,
 * falling back to Today; a From after To is swapped.
 */
export function resolveReportPeriod(
  params: { period?: string; asOf?: string; from?: string; to?: string },
  today: string,
  /** What opens with no period chosen: QuickBooks opens an "as of" report
   *  on Today and a From–To report on This month. */
  fallback: Exclude<ReportPeriod, 'custom'> = 'today'
): { period: ReportPeriod; from: string; to: string; asOf: string } {
  const period: ReportPeriod = isReportPeriod(params.period)
    ? params.period
    : params.asOf || params.from || params.to
      ? 'custom'
      : fallback;
  if (period !== 'custom') {
    const r = periodRange(period, today);
    return { period, ...r, asOf: r.to };
  }
  const asOf = isDate(params.asOf) ? params.asOf : today;
  let from = isDate(params.from) ? params.from : `${today.slice(0, 8)}01`;
  let to = isDate(params.to) ? params.to : today;
  if (from > to) [from, to] = [to, from];
  return { period, from, to, asOf };
}
