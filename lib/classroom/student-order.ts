// Student-order preference — the other half of Classroom Settings (Phase 6),
// alongside the private note in lib/classroom/notes-api.ts's caller. Per the
// design spec (docs/superpowers/specs/2026-07-28-classroom-workspace-design.md
// §Phase 6), this is deliberately "client-persisted, no schema": it never
// leaves the browser, never touches a mutation route, and has no bearing on
// grading/attendance/policy (Hard Rules #1–#3 don't apply — it only changes
// which row of the SAME data a teacher sees first).
//
// Two options only, matching Phase 6's "reduced" scope: the roster's
// existing default (class index number, KD #85/#136 — the registrar's
// permanent per-section numbering) and a plain alphabetical fallback. This
// is pure/framework-free so it is unit-testable without mounting React or
// touching localStorage; the actual persistence lives in the 'use client'
// hook in use-student-order.ts, which imports these constants.

export const STUDENT_ORDER_VALUES = ['index', 'alphabetical'] as const;
export type StudentOrder = (typeof STUDENT_ORDER_VALUES)[number];

export const STUDENT_ORDER_LABELS: Record<StudentOrder, string> = {
  index: 'Class index number',
  alphabetical: 'Alphabetical (last name)',
};

export const STUDENT_ORDER_DESCRIPTIONS: Record<StudentOrder, string> = {
  index: "The registrar's permanent roll number for this class.",
  alphabetical: 'Sorted by last name, then first name.',
};

export const DEFAULT_STUDENT_ORDER: StudentOrder = 'index';

/** Validates a raw stored/URL value, falling back to the default on anything unrecognized. */
export function parseStudentOrder(
  raw: string | null | undefined
): StudentOrder {
  return (STUDENT_ORDER_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as StudentOrder)
    : DEFAULT_STUDENT_ORDER;
}

/** The localStorage key for one section's preference — namespaced so two classes never collide. */
export function studentOrderStorageKey(sectionId: string): string {
  return `classroom:${sectionId}:student-order`;
}

export type OrderableStudentRow = {
  index_number: number;
  student_name: string;
};

/**
 * Pure sort — returns a new array, never mutates the input. `student_name`
 * is already "Last, First[, Middle]" (see the Students-tab loader), so a
 * plain locale compare on it IS the "alphabetical by last name" the label
 * promises without needing separate name-part fields here.
 */
export function sortRosterByOrder<T extends OrderableStudentRow>(
  rows: readonly T[],
  order: StudentOrder
): T[] {
  const copy = [...rows];
  if (order === 'alphabetical') {
    copy.sort((a, b) => a.student_name.localeCompare(b.student_name, 'en-SG'));
  } else {
    copy.sort((a, b) => a.index_number - b.index_number);
  }
  return copy;
}
