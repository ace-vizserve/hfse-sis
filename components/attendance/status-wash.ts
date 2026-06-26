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

export function statusCellWash(status: AttendanceStatus | null): string {
  return status ? STATUS_CELL_WASH[status] : 'text-foreground';
}
