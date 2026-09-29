import type { DateRange, TermWindows } from '@/lib/dashboard/range';

// Pure lookups the Attendance Insights click wrappers use to turn a clicked
// segment into a drill. Kept apart from lib/attendance/drill.ts because these
// are imported by client components.

/** The four P/L/EX/A drill targets — each is an `AttendanceDrillTarget`. */
export type MixDrillTarget = 'present' | 'lates' | 'excused' | 'absent';

/** Attendance mix pie — the page's slice names → the target whose rows make up that slice. */
export const MIX_SLICE_TARGET: Readonly<Record<string, MixDrillTarget>> = {
  Present: 'present',
  Late: 'lates',
  Excused: 'excused',
  Absent: 'absent',
};

/** Composition-by-term bars — the page's series keys → the same targets. */
export const MIX_SERIES_TARGET: Readonly<Record<string, MixDrillTarget>> = {
  present: 'present',
  late: 'lates',
  excused: 'excused',
  absent: 'absent',
};

/**
 * ayCode → term label ('T1'..'T4') → that term's dates, for every year a
 * chart on the page plots. Plain data so a Server Component can hand it to a
 * client wrapper.
 */
export type TermWindowMap = Record<string, Partial<Record<string, DateRange>>>;

export function buildTermWindowMap(
  entries: ReadonlyArray<{
    ayCode: string;
    byNumber: TermWindows['byNumber'];
  }>
): TermWindowMap {
  const out: TermWindowMap = {};
  for (const { ayCode, byNumber } of entries) {
    const terms: Partial<Record<string, DateRange>> = {};
    for (const n of [1, 2, 3, 4] as const) {
      const w = byNumber[n];
      if (w) terms[`T${n}`] = { from: w.from, to: w.to };
    }
    out[ayCode] = terms;
  }
  return out;
}

/**
 * The dates of one term in one year, or null when that term has none. A null
 * means "do not open a drill" — opening it without dates would list the whole
 * year under a term's label.
 */
export function termWindowFor(
  map: TermWindowMap,
  ayCode: string,
  termLabel: string
): DateRange | null {
  return map[ayCode]?.[termLabel] ?? null;
}

/** The id of the term the page's term picker selected, or null if that term has no row. */
export function resolveSelectedTermId(
  terms: ReadonlyArray<{ id: string; term_number: number }>,
  termNumber: number
): string | null {
  return terms.find((t) => t.term_number === termNumber)?.id ?? null;
}
