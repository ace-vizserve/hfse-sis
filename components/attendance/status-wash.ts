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

export function statusCellWash(status: AttendanceStatus | null): string {
  return status ? STATUS_CELL_WASH[status] : 'text-foreground';
}
