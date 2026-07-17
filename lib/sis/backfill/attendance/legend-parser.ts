// Date/legend-text parsing for the AY2026 T1 attendance import. Pure —
// no xlsx dependency. Two distinct date orderings appear in the source
// file: the roster grid's column headers are "Day-Month" (e.g. "8-Jan"),
// while the masthead legend cells are "Month Day[-Day] [-] Label"
// (e.g. "Feb 17-18 CNY").

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

// Resolves a month name/abbreviation + day + year into an ISO 'YYYY-MM-DD'
// date. Returns null for an unrecognized month name.
export function resolveDate(
  month: string,
  day: number,
  year: number
): string | null {
  const m = MONTH_MAP[month.trim().toLowerCase().slice(0, 3)];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const HEADER_DATE_RE = /^(\d{1,2})-([A-Za-z]{3,})$/;

// Resolves a roster grid header cell like "8-Jan" into an ISO date.
export function resolveHeaderDate(dMon: string, year: number): string | null {
  const match = dMon.trim().match(HEADER_DATE_RE);
  if (!match) return null;
  const [, dayStr, month] = match;
  return resolveDate(month, Number.parseInt(dayStr, 10), year);
}

export interface ParsedLegendRange {
  startDate: string;
  endDate: string;
  label: string;
}

const LEGEND_RANGE_RE =
  /^([A-Za-z]{3,})\s+(\d{1,2})(?:-(\d{1,2}))?\s*-?\s*(.*)$/;

// Parses a masthead legend cell like "Feb 17-18 CNY" or "Mar 6 - Marking
// Day" into a resolved date range + label. Returns null when the leading
// "Month Day[-Day]" pattern isn't recognized (defensive — every real
// legend cell observed in the source file matches).
export function parseLegendDateRange(
  rawText: string,
  year: number
): ParsedLegendRange | null {
  const match = rawText.trim().match(LEGEND_RANGE_RE);
  if (!match) return null;
  const [, month, startDayStr, endDayStr, label] = match;
  const startDate = resolveDate(month, Number.parseInt(startDayStr, 10), year);
  if (!startDate) return null;
  const endDate = endDayStr
    ? resolveDate(month, Number.parseInt(endDayStr, 10), year)
    : startDate;
  if (!endDate) return null;
  return { startDate, endDate, label: label.trim() };
}
