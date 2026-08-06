// lib/sis/backfill/house/workbook.ts
//
// Parses Mr Hanafi's "Student House Color Assignment" workbook into one row per
// student. Pure apart from reading the file — no database, no network.
//
// ⚠ THE WORKBOOK CONTAINS TWO CONFLICTING ALLOCATIONS. The first tab, named
// after the file itself, is a superseded master: of its 389 rows, 292 give a
// DIFFERENT house from the per-class tabs, and the class tabs carry 27 students
// it never got. The live allocation is the per-class tabs — confirmed by Mr Ace
// on 2026-08-06 — so this parser names the tabs it skips rather than taking
// whatever it finds first. Loading the master would mis-assign roughly three
// students in four, silently.
//
// The per-class tabs also carry their own hand-typed totals at the foot
// ("Blue | 5"). Those are an annotation, not data: 19 of the 20 tabs agree with
// their own rows, and the twentieth disagrees because somebody moved a student
// and did not retype the count. They are skipped, never read as truth.
import XLSX from 'xlsx';

/** The four house colours, as written in the sheet. */
export const HOUSE_COLOURS = ['Blue', 'Yellow', 'Green', 'Orange'] as const;
export type HouseColour = (typeof HOUSE_COLOURS)[number];

/**
 * Colour → `public.houses.code`. The codes are migration 110's idempotency key
 * and never change, which is exactly why the SQL keys on them rather than on a
 * house name that did change (migration 111).
 */
export const HOUSE_CODE_BY_COLOUR: Record<HouseColour, string> = {
  Orange: 'H1',
  Blue: 'H2',
  Green: 'H3',
  Yellow: 'H4',
};

/**
 * Tabs that are not an in-scope class roster.
 *
 * `YS` (YoungStarters) and `VizSchool` are real cohorts holding real students,
 * but VizSchool is a separate school entity and YoungStarters a separate
 * programme; both are deferred until P1–Sec 4 is done (Mr Ace, 2026-08-06).
 * They are skipped BY NAME so that a tab added later fails loudly as an unknown
 * roster rather than being silently swept in.
 */
export const SKIP_TABS = new Set([
  'Student House Color Assignment', // the superseded master — see the header
  'HFSE Staff', // staff, not students
  'YS',
  'VizSchool',
]);

export interface HouseSheetRow {
  /** The tab it came from, e.g. "P4 TRUST". A matching hint, never a key —
   *  these are the sheet's spellings ("P2 HUMILTY", "SEC 1D1"), not ours. */
  tab: string;
  /** Verbatim col A, e.g. "DELA CRUZ, Ryemon Wilfred F.". */
  rawName: string;
  colour: HouseColour;
}

/** True when col A is a bare colour word — i.e. one of the tally rows. */
function isTallyRow(name: string): boolean {
  return HOUSE_COLOURS.some(
    (c) => c.toLowerCase() === name.trim().toLowerCase()
  );
}

/**
 * Reads the workbook and returns one row per student on the in-scope class
 * tabs. Rows are returned in sheet order, which is roughly alphabetical with
 * late joiners appended at the foot.
 */
export function parseHouseWorkbook(path: string): HouseSheetRow[] {
  const wb = XLSX.readFile(path);
  const out: HouseSheetRow[] = [];

  for (const tab of wb.SheetNames) {
    if (SKIP_TABS.has(tab)) continue;

    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[tab], {
      header: 1,
      blankrows: false,
      defval: '',
    });

    for (const row of grid) {
      const rawName = String(row[0] ?? '').trim();
      const rawColour = String(row[1] ?? '').trim();

      // The tab-title row (col B empty), the column header, and the tallies.
      if (!rawName || !rawColour) continue;
      if (rawName === 'Student Name') continue;
      if (isTallyRow(rawName)) continue;

      // Col B is emoji-prefixed on the live tabs ("🔵 Blue"). Match on the word
      // so the parser does not depend on the emoji surviving a round-trip
      // through xlsx, a CSV export, or a copy-paste.
      const colour = HOUSE_COLOURS.find((c) => rawColour.includes(c));
      if (!colour) continue;

      out.push({ tab, rawName, colour });
    }
  }

  return out;
}
