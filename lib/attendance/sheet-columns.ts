import type { CalendarEventRow } from '@/lib/attendance/calendar';
import type { DayType } from '@/lib/schemas/attendance';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** 'YYYY-MM' bucket key for an ISO date. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** 'June 2026' display label for a 'YYYY-MM' key. */
export function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

export type ColumnTagCode = 'PH' | 'SH' | 'HBL' | 'NC' | 'SE' | 'EX';

/**
 * The single most-informative tag for a date column, matching HFSE's sheet:
 * holidays show PH/SH/NC from day_type; an exam event shows EX; any other
 * event shows SE; HBL keeps its tag; a plain (or unconfigured) school day is
 * untagged. Holiday day-types win over events; exam wins over other events.
 */
export function resolveColumnTag(args: {
  dayType: DayType | null;
  events: CalendarEventRow[];
}): ColumnTagCode | null {
  const { dayType, events } = args;
  if (dayType === 'public_holiday') return 'PH';
  if (dayType === 'school_holiday') return 'SH';
  if (dayType === 'no_class') return 'NC';
  if (events.some((e) => e.category === 'term_exam')) return 'EX';
  if (events.length > 0) return 'SE';
  if (dayType === 'hbl') return 'HBL';
  return null;
}

/** Every calendar date in [startIso, endIso] inclusive (incl weekends), yyyy-MM-dd. */
export function eachDateInclusive(startIso: string, endIso: string): string[] {
  const parse = (iso: string) =>
    new Date(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    );
  const pad = (n: number) => String(n).padStart(2, '0');
  const out: string[] = [];
  const d = parse(startIso);
  const end = parse(endIso);
  while (d.getTime() <= end.getTime()) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Every 'YYYY-MM' the window [startIso, endIso] touches, chronological. */
export function monthsInRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7));
  const endY = Number(endIso.slice(0, 4));
  const endM = Number(endIso.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
