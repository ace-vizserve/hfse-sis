// lib/sis/backfill/calendar/register-legend.ts
// Pulls the calendar block out of an HFSE attendance register.
//
// Every register carries one — the school writes the term's holidays, events
// and exams into the sheet masthead so teachers know why a column is blank.
// The problem was never that the source was thin; it is that each term's
// import read the block differently, or not at all. This module reads all
// three layouts the same way and reports what it could NOT categorise rather
// than guessing.
//
// THE THREE LAYOUTS
//   T3 (AY2026)  A structured masthead: four labelled columns (SCHOOL EVENTS /
//                SCHOOL HOLIDAY / PUBLIC HOLIDAY / EXAMINATION), each listing
//                "date-text → label". The category is stated, so it is trusted.
//   T1, T2       A free-text "Legend / Important dates" strip above the grid,
//                e.g. "Feb 17-18  CNY", "Apri 8 - 9 General PTC". No category
//                is stated anywhere, so `kind` comes back null and the
//                reconciler resolves it against the published calendar.
//   T2 (also)    Labels printed in the date column they fall on, one row above
//                the date header. Exact, unambiguous, and reused as-is from
//                the shipped T2 importer.
//
// LEVEL SCOPE FOR FREE. Each sheet is one section, so an entry that appears
// only on the secondary sheets is a secondary entry. Collecting the level
// codes of the sheets that carry an entry recovers its real scope — which is
// how the T3 secondary exam papers, currently lost in production, come back.
import * as XLSX from 'xlsx';

import { LEVEL_CODES, type LevelCode } from '../../levels';
import type { LegendGroupT3 } from '../attendance/attendance-workbook-t3';
import { parseLegendDateTextT3 } from '../attendance/legend-dates-t3';
import { resolveDate, resolveHeaderDate } from '../attendance/legend-parser';
import type { CalendarKind } from './types';

/** One entry recovered from a register, with the sheets that carried it. */
export interface RegisterEntry {
  startDate: string;
  endDate: string;
  label: string;
  /** null when the layout states no category (T1/T2 free text). */
  kind: CalendarKind | null;
  /** Level codes of the sheets carrying this entry; null when every level did. */
  levels: LevelCode[] | null;
  /** Human-readable provenance, e.g. "masthead (schoolHoliday)". */
  source: string;
  /** How many level sheets carried this entry — confidence signal for the audit. */
  sheetLevelCount: number;
}

const T3_GROUP_TO_KIND: Record<LegendGroupT3, CalendarKind> = {
  schoolEvents: 'school_event',
  schoolHoliday: 'school_holiday',
  publicHoliday: 'public_holiday',
  examination: 'term_exam',
};

const DATE_COL_RE = /^\d{1,2}-[A-Za-z]{3}$/;

// Tolerant month-first legend matcher for the T1/T2 mastheads. Deliberately
// NOT a change to legend-parser.ts::parseLegendDateRange, whose exact
// behaviour the already-applied T1 import depends on. The extra tolerance
// earns its keep on real cells that the stricter form mis-reads:
//   "Apri 8 - 9 General PTC"   → typo'd month, spaces around the range dash
//   "Feb 2-6  - Mathematics Week" → range dash AND a separator dash
//   "Mar 6 - Marking Day"      → separator dash, no range
// `(?!\d)` after the day is load-bearing: without it "January 2026" — the
// month banner every T1/T2 sheet prints above the grid — reads as "Jan 20" with
// the label "26", inventing a holiday on the 20th.
const LOOSE_LEGEND_RE =
  /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?!\d)\s*(?:[-–]\s*(\d{1,2})(?!\d))?\s*[-–]?\s*(.*)$/;

/** Parses a T1/T2 masthead cell. Returns null when it isn't a legend cell. */
export function parseLooseLegendCell(
  rawText: string,
  year: number
): { startDate: string; endDate: string; label: string } | null {
  const text = rawText.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const match = text.match(LOOSE_LEGEND_RE);
  if (!match) return null;
  const [, month, startStr, endStr, rawLabel] = match;
  const label = rawLabel.trim();
  // A legend cell always names something. Bare dates and stray numbers are
  // grid furniture, not events.
  if (!label || /^\d+$/.test(label)) return null;
  const startDate = resolveDate(month, Number.parseInt(startStr, 10), year);
  if (!startDate || !isRealDate(startDate)) return null;
  const endDate = endStr
    ? resolveDate(month, Number.parseInt(endStr, 10), year)
    : startDate;
  // `resolveDate` pads digits without checking the month has that many days,
  // so "Feb 30" yields 2026-02-30 and silently becomes 2 March downstream.
  if (!endDate || !isRealDate(endDate) || endDate < startDate) return null;
  return { startDate, endDate, label };
}

/** True when the ISO string names a date that actually exists. */
export function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/** 'P6 Grit' → 'P6'; 'S1 Discipline - 1' → 'S1'; 'YS' / admin tabs → null. */
export function levelOfSheet(sheetName: string): LevelCode | null {
  const head = sheetName.trim().slice(0, 2).toUpperCase();
  return (LEVEL_CODES as readonly string[]).includes(head)
    ? (head as LevelCode)
    : null;
}

/** The row index holding the roster's date headers — the one with the most. */
function dateHeaderRowIndex(rows: string[][]): number {
  let best = -1;
  let bestCount = 0;
  rows.forEach((row, idx) => {
    const count = row.filter((c) =>
      DATE_COL_RE.test(String(c ?? '').trim())
    ).length;
    if (count > bestCount) {
      bestCount = count;
      best = idx;
    }
  });
  // A real roster header has a column per teaching day; a stray legend row has
  // a handful. Below this the sheet isn't a roster at all.
  return bestCount >= 10 ? best : -1;
}

// Collapses per-sheet sightings into one entry each, recording which levels
// carried it. `null` levels means every level that has a sheet in this
// workbook — i.e. genuinely whole-school, not "we could not tell".
function collapse(
  sightings: {
    key: string;
    startDate: string;
    endDate: string;
    label: string;
    kind: CalendarKind | null;
    level: LevelCode | null;
    source: string;
  }[],
  levelsPresentInWorkbook: Set<LevelCode>
): RegisterEntry[] {
  const byKey = new Map<
    string,
    {
      entry: Omit<RegisterEntry, 'levels' | 'sheetLevelCount'>;
      levels: Set<LevelCode>;
    }
  >();
  for (const s of sightings) {
    const found = byKey.get(s.key);
    const bucket = found ?? {
      entry: {
        startDate: s.startDate,
        endDate: s.endDate,
        label: s.label,
        kind: s.kind,
        source: s.source,
      },
      levels: new Set<LevelCode>(),
    };
    if (s.level) bucket.levels.add(s.level);
    byKey.set(s.key, bucket);
  }
  return [...byKey.values()].map(({ entry, levels }) => {
    const carriedEverywhere =
      levels.size === 0 ||
      [...levelsPresentInWorkbook].every((l) => levels.has(l));
    // Scope is only derived from T3's STRUCTURED masthead, and only for events
    // and exams. Two reasons, both learned from the real files:
    //   • A closure is never level-scoped. A partial sighting means a form
    //     adviser left it out of their masthead, not that the holiday applied
    //     to some classes.
    //   • T1/T2's free-text strip (kind === null) is the same text copied onto
    //     every sheet, so a gap there is a typing omission too — Vesak Day came
    //     back scoped to eight of ten levels purely because two advisers never
    //     typed it.
    // T3's four-column masthead is the one place where a per-sheet difference
    // is DESIGNED: each section lists the exam papers that section sits.
    const scopeIsMeaningful =
      entry.kind === 'school_event' || entry.kind === 'term_exam';
    return {
      ...entry,
      levels:
        carriedEverywhere || !scopeIsMeaningful
          ? null
          : [...levels].sort(
              (a, b) => LEVEL_CODES.indexOf(a) - LEVEL_CODES.indexOf(b)
            ),
      /** How many level sheets carried this entry — confidence for the audit. */
      sheetLevelCount: levels.size,
    };
  });
}

/**
 * Reads every section sheet in a register workbook and returns the calendar
 * entries its masthead carries.
 *
 * `year` is the calendar year the sheet's dates fall in — registers print
 * "6-Jul" with no year, so the caller supplies it from the term window.
 */
export function extractRegisterCalendar(
  filePath: string,
  year: number
): RegisterEntry[] {
  const wb = XLSX.readFile(filePath);
  const sightings: Parameters<typeof collapse>[0] = [];
  const levelsPresent = new Set<LevelCode>();

  for (const sheetName of wb.SheetNames) {
    const level = levelOfSheet(sheetName);
    if (!level) continue; // skip YS, bus summary, dropdown reference tabs
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
    });
    const headerIdx = dateHeaderRowIndex(rows);
    // Counted only AFTER the sheet is known to be parseable. A tab we bail on
    // would otherwise enter the denominator in `collapse` while contributing
    // no sightings, turning a whole-school event into one scoped to whichever
    // levels happened to parse — the very false scoping this module guards
    // against elsewhere.
    if (headerIdx < 0) continue;
    levelsPresent.add(level);

    // ── Layout A: the T3 structured masthead ───────────────────────────────
    // Yields nothing on T1/T2, which have no heading cells; layout B below
    // does the work there.
    const groups = extractLegendGroupsWide(rows);
    for (const [group, entries] of Object.entries(groups) as [
      LegendGroupT3,
      { dateText: string; label: string }[],
    ][]) {
      for (const { dateText, label } of entries) {
        if (!label.trim()) continue;
        const dates = parseLegendDateTextT3(dateText, year);
        if (dates.length === 0) continue;
        // A comma list ("13, 20, 27 July") is three separate one-day entries,
        // not a nine-day span — emit each date on its own.
        // Sort before taking endpoints: a masthead list written out of order
        // ("27, 26 Aug") is still contiguous, and reading dates[0]..dates[-1]
        // raw would produce startDate > endDate, after which datesCovered
        // returns nothing and the entry disappears without a word.
        const sorted = [...dates].sort();
        const spans = isContiguous(sorted)
          ? [[sorted[0], sorted[sorted.length - 1]] as const]
          : sorted.map((d) => [d, d] as const);
        for (const [startDate, endDate] of spans) {
          sightings.push({
            key: `${startDate}|${endDate}|${label.trim()}|${group}`,
            startDate,
            endDate,
            label: label.trim(),
            kind: T3_GROUP_TO_KIND[group],
            level,
            source: `masthead (${group})`,
          });
        }
      }
    }

    // ── Layout B: the T1/T2 free-text strip above the grid ─────────────────
    for (let r = 0; r < headerIdx; r++) {
      for (const cell of rows[r] ?? []) {
        const parsed = parseLooseLegendCell(String(cell ?? ''), year);
        if (!parsed) continue;
        sightings.push({
          key: `${parsed.startDate}|${parsed.endDate}|${parsed.label}|loose`,
          ...parsed,
          kind: null,
          level,
          source: 'masthead (free text)',
        });
      }
    }

    // ── Layout C: T2's labels printed in their own date column ─────────────
    for (const [dateCol, label] of Object.entries(
      alignedLabelsAt(rows, headerIdx)
    )) {
      const iso = resolveHeaderDate(dateCol, year);
      if (!iso) continue;
      sightings.push({
        key: `${iso}|${iso}|${label}|aligned`,
        startDate: iso,
        endDate: iso,
        label,
        kind: null,
        level,
        source: 'date-aligned label',
      });
    }
  }

  return collapse(sightings, levelsPresent).sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.label.localeCompare(b.label)
  );
}

/** True when the dates are consecutive calendar days. */
function isContiguous(dates: string[]): boolean {
  if (dates.length <= 1) return true;
  const sorted = [...dates].sort();
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${sorted[i]}T00:00:00Z`).getTime();
    if (cur - prev !== 86_400_000) return false;
  }
  return true;
}

// Cells that sit in the row above the date header but are NOT event labels:
// T3's one/two-letter day tags, and the masthead group headings that
// `extractDateAlignedLabels` mistakes for labels when it locks onto the wrong
// row (see alignedLabelsAt).
const NOT_A_LABEL = new Set([
  'SH',
  'SE',
  'PH',
  'EX',
  'HBL',
  'NC',
  'SCHOOL EVENTS',
  'SCHOOL HOLIDAY',
  'PUBLIC HOLIDAY',
  'EXAMINATION',
  'LEGEND',
  'CLASS INFORMATION',
  'DO NOT DELETE OR EDIT',
]);

/**
 * T2's per-date labels: the row directly above the date-header row, read
 * column by column.
 *
 * Takes an already-located `headerIdx` rather than calling
 * `attendance-workbook-t2.ts::extractDateAlignedLabels`, which finds the
 * header by the FIRST row containing any date-shaped cell. On a T3 sheet that
 * is the masthead legend (row 4 holds "6-Jul", "9-Aug", "26-Aug"), so it
 * returns the four group HEADINGS as if they were event labels. Passing the
 * robust "row with the most dates" index makes the same idea safe on all three
 * layouts.
 */
export function alignedLabelsAt(
  rows: string[][],
  headerIdx: number
): Record<string, string> {
  if (headerIdx <= 0) return {};
  const header = rows[headerIdx] ?? [];
  const labelRow = rows[headerIdx - 1] ?? [];
  const out: Record<string, string> = {};
  header.forEach((cell, colIdx) => {
    const dateCol = String(cell ?? '').trim();
    if (!DATE_COL_RE.test(dateCol)) return;
    const label = String(labelRow[colIdx] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || NOT_A_LABEL.has(label.toUpperCase())) return;
    out[dateCol] = label;
  });
  return out;
}

const LEGEND_GROUP_HEADINGS: Record<string, LegendGroupT3> = {
  'SCHOOL EVENTS': 'schoolEvents',
  'SCHOOL HOLIDAY': 'schoolHoliday',
  'PUBLIC HOLIDAY': 'publicHoliday',
  EXAMINATION: 'examination',
};

/**
 * The T3 masthead's four groups, read to the END of each column.
 *
 * Deliberately not `attendance-workbook-t3.ts::extractLegendGroups`, which
 * stops at row 7. That window fits most sheets but truncates the longest
 * columns on the real workbook: P6 Grit lists "3-Sep Teachers and ANTS Day" on
 * row 9, and S4 Excellence lists a sixth exam paper on row 10. Reading to the
 * end of the block is what recovers them. The shipped function is left alone
 * so the already-applied T3 attendance import stays byte-reproducible.
 */
export function extractLegendGroupsWide(
  rows: string[][]
): Record<LegendGroupT3, { dateText: string; label: string }[]> {
  const out: Record<LegendGroupT3, { dateText: string; label: string }[]> = {
    schoolEvents: [],
    schoolHoliday: [],
    publicHoliday: [],
    examination: [],
  };
  const headerRow = rows[3] ?? [];
  headerRow.forEach((cell, colIdx) => {
    const group = LEGEND_GROUP_HEADINGS[String(cell ?? '').trim()];
    if (!group) return;
    // Walk down until the column runs dry. A single blank row inside a group
    // is not an end-of-block signal on these sheets, so allow one gap before
    // stopping — but never run into the roster header itself.
    let gaps = 0;
    for (let r = 4; r < rows.length && gaps <= 1; r++) {
      const dateText = String(rows[r]?.[colIdx] ?? '').trim();
      const label = String(rows[r]?.[colIdx + 2] ?? '').trim();
      if (!dateText || !label) {
        gaps++;
        continue;
      }
      gaps = 0;
      out[group].push({ dateText, label });
    }
  });
  return out;
}
