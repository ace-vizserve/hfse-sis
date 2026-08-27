import type { AttendanceStatus } from '@/lib/schemas/attendance';

// Status → marking wash. HFSE paper-sheet palette (KD #132): solid light fills
// matching the old paper register — P light blue, A yellow, EX cyan, L pink —
// each with dark mark-ink so the letter stays legible (≥4.5:1). NC is no-class
// chrome (neutral ink wash), not a paper-sheet mark.
//
// SINGLE SOURCE OF TRUTH (§10.2): the grid cells, the legend swatch, AND the
// cell-mark popover chips all read this one map, so they can never drift.
export const STATUS_CELL_WASH: Record<AttendanceStatus, string> = {
  P: 'bg-attendance-present text-attendance-mark-ink',
  L: 'bg-attendance-late text-attendance-mark-ink',
  EX: 'bg-attendance-excused text-attendance-mark-ink',
  A: 'bg-attendance-absent text-attendance-mark-ink',
  NC: 'bg-ink-4 text-white',
};

// The same washes, restated for a Radix toggle.
//
// `toggleVariants` ships its own hover and selected colours — `hover:bg-muted`
// and `data-[state=on]:bg-accent` — for a neutral chrome toggle. A plain `bg-*`
// class does not beat a `hover:`- or `data-[state=on]:`-prefixed one whatever
// the order, so each wash has to be spelled out under both states or the mark
// tiles turn grey on hover and on selection.
//
// Written as literal strings on purpose. Tailwind only emits class names it can
// read in the source, so `hover:${STATUS_CELL_WASH[s]}` compiles to nothing at
// all — and silently, since the class simply never exists. The drift risk
// against the map above is covered by
// `__tests__/attendance/status-wash.test.ts`.
export const STATUS_TOGGLE_WASH: Record<AttendanceStatus, string> = {
  P: 'bg-attendance-present hover:bg-attendance-present data-[state=on]:bg-attendance-present',
  L: 'bg-attendance-late hover:bg-attendance-late data-[state=on]:bg-attendance-late',
  EX: 'bg-attendance-excused hover:bg-attendance-excused data-[state=on]:bg-attendance-excused',
  A: 'bg-attendance-absent hover:bg-attendance-absent data-[state=on]:bg-attendance-absent',
  NC: 'bg-ink-4 hover:bg-ink-4 data-[state=on]:bg-ink-4',
};

// The same washes again, this time for the marking palette's SEGMENTED TRACK.
//
// A third map rather than a variant of the second, because it says something
// different. `STATUS_TOGGLE_WASH` paints the full fill under every state — the
// tile IS the colour. In the track, the fill means "this is the mark you
// picked": an unchosen segment carries a quiet third of its paper colour, so
// the legend still reads at a glance, and the chosen one takes all of it and
// lifts off the track. Four fully saturated blocks competing at equal weight
// is exactly what the redesign was asked to fix.
//
// ⚠ Same literal-strings rule as above, and for the same reason: Tailwind
// emits no class it cannot read in the source, so `hover:${...}` compiles to
// nothing and the element silently carries a class matching no rule. And the
// `hover:` / `data-[state=on]:` variants must be spelled out or
// `toggleVariants`' own grey wins. `__tests__/attendance/status-wash.test.ts`
// pins all three maps against each other.
export const STATUS_SEGMENT_WASH: Record<AttendanceStatus, string> = {
  P: 'bg-attendance-present/35 hover:bg-attendance-present/55 data-[state=on]:bg-attendance-present',
  L: 'bg-attendance-late/35 hover:bg-attendance-late/55 data-[state=on]:bg-attendance-late',
  EX: 'bg-attendance-excused/35 hover:bg-attendance-excused/55 data-[state=on]:bg-attendance-excused',
  A: 'bg-attendance-absent/35 hover:bg-attendance-absent/55 data-[state=on]:bg-attendance-absent',
  NC: 'bg-ink-4/25 hover:bg-ink-4/40 data-[state=on]:bg-ink-4',
};

export function statusCellWash(status: AttendanceStatus | null): string {
  return status ? STATUS_CELL_WASH[status] : 'text-foreground';
}
