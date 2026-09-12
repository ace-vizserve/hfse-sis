// Pure, side-effect-free selection helpers for the Records dashboard's
// Class-assignment-readiness surface.
//
// Split out of lib/sis/dashboard.ts because that module transitively imports
// `server-only` (via lib/dashboard/ay-id.ts's bare `import 'server-only'`),
// and this module is imported at RUNTIME by a `'use client'` component
// (components/sis/class-assignment-readiness-card.tsx) as well as by the CSV
// export builder (lib/sis/records-dashboard-export.ts). A bare side-effect
// import is not tree-shakeable, so if this file pulled in `server-only`
// transitively, the browser bundle would pull it in too and throw.
//
// This module must NEVER gain a runtime import that reaches `server-only` —
// keep it to plain types + pure functions only.

export type ClassAssignmentReadinessRow = {
  enroleeNumber: string;
  fullName: string;
  level: string | null;
  enrollmentDate: string | null; // ISO
  daysSinceEnrollment: number | null;
};

// Rows already arrive sorted desc by daysSinceEnrollment (oldest gap first)
// from loadClassAssignmentReadinessUncached (lib/sis/dashboard.ts) — this only
// applies the card's own "top 8" cutoff. Shared so the Records dashboard CSV
// export (lib/sis/records-dashboard-export.ts) can mirror
// <ClassAssignmentReadinessCard>'s visible rows exactly, without
// re-implementing the cutoff a second time.
export const CLASS_ASSIGNMENT_READINESS_VISIBLE_LIMIT = 8;

export function selectVisibleClassAssignmentReadiness(
  rows: ClassAssignmentReadinessRow[]
): ClassAssignmentReadinessRow[] {
  return rows.slice(0, CLASS_ASSIGNMENT_READINESS_VISIBLE_LIMIT);
}
