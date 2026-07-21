// lib/sis/backfill/attendance/legend-dates-t3.ts
// Parses a T3 legend cell's date-text into one or more ISO dates. T3's
// masthead (design doc §1 point 3) uses three distinct day-first shapes,
// none of which match T1's month-first "Month Day[-Day] Label" shape
// (legend-parser.ts::parseLegendDateRange) or T2's date-aligned lookup:
//   - single, abbreviated month:  "6-Jul", "26-Aug"
//   - comma list, full month:     "13, 20, 27 July"
//   - day range, full month:      "14-16 July"
// Reuses resolveHeaderDate (identical "D-Mon" shape) for the single-date
// case, and resolveDate (month-name resolution only) for the list/range
// shapes, which get their own small parsers here.
import { resolveDate, resolveHeaderDate } from './legend-parser';

const SINGLE_RE = /^(\d{1,2})-([A-Za-z]{3,})$/;
const RANGE_RE = /^(\d{1,2})-(\d{1,2})\s+([A-Za-z]+)$/;
const LIST_RE = /^([\d,\s]+)\s+([A-Za-z]+)$/;

// Returns every ISO date the cell's text covers, or [] if the shape isn't
// recognized (defensive — every real T3 legend cell observed matches one
// of the three shapes).
export function parseLegendDateTextT3(rawText: string, year: number): string[] {
  const text = rawText.trim();
  if (!text) return [];

  const single = text.match(SINGLE_RE);
  if (single) {
    const date = resolveHeaderDate(text, year);
    return date ? [date] : [];
  }

  const range = text.match(RANGE_RE);
  if (range) {
    const [, startStr, endStr, month] = range;
    const start = Number.parseInt(startStr, 10);
    const end = Number.parseInt(endStr, 10);
    const dates: string[] = [];
    for (let d = start; d <= end; d++) {
      const iso = resolveDate(month, d, year);
      if (iso) dates.push(iso);
    }
    return dates;
  }

  const list = text.match(LIST_RE);
  if (list) {
    const [, daysStr, month] = list;
    const dates: string[] = [];
    for (const part of daysStr.split(',')) {
      const day = Number.parseInt(part.trim(), 10);
      if (Number.isNaN(day)) continue;
      const iso = resolveDate(month, day, year);
      if (iso) dates.push(iso);
    }
    return dates;
  }

  return [];
}
