import {
  APPLICATION_TERMINAL_STATUSES,
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  evaluateEnrolledFlip,
} from '@/lib/schemas/sis';
import { isEnrolledApplicationStatus } from '@/lib/sync/students';

// ──────────────────────────────────────────────────────────────────────────
// "Class chosen, not enrolled" — the pure half of the Admissions cohort at
// /admissions/cohorts/class-chosen. The loader lives in
// ./class-chosen-not-enrolled.ts; everything that decides WHO is on the list
// and WHAT they still need lives here, so it is tested without a database.
//
// A class can be chosen at any application status (the assign-section route's
// choose mode, 2026-09-28 — docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md),
// but the child only joins the class list once the application is Enrolled or
// Enrolled (Conditional). Between the two they are on nobody's roster, and
// this view is where admissions finds them to finish the enrolment.
// ──────────────────────────────────────────────────────────────────────────

/** The status columns the Enrolled-flip gate reads, in stage order. */
export const PREREQ_STATUS_COLUMNS: readonly string[] =
  ENROLLED_PREREQ_STAGES.map((stage) => STAGE_COLUMN_MAP[stage].statusCol);

export type EnrolmentReadiness = {
  /** True when nothing stands between this child and the Enrolled flip. */
  ready: boolean;
  /** Plain-English stage names not yet at their done status, in stage order
   *  ("Documents", "Fees"). Empty when `ready`. */
  outstanding: string[];
};

/**
 * What still stands between a child and Enrolled.
 *
 * Deliberately delegates to `evaluateEnrolledFlip` — the exact gate the stage
 * route applies when someone sets the application to Enrolled — so "Ready to
 * enrol" here can never disagree with what the save will accept. No section
 * and no student number are passed: this answers only the prerequisite half.
 *
 * `statusRow` is the admissions status row, keyed by its real column names
 * (`documentStatus`, `feeStatus`, …).
 */
export function describeEnrolmentReadiness(
  statusRow: Readonly<Record<string, unknown>>
): EnrolmentReadiness {
  const prereqStatuses: Record<string, string | null> = {};
  for (const stage of ENROLLED_PREREQ_STAGES) {
    const value = statusRow[STAGE_COLUMN_MAP[stage].statusCol];
    prereqStatuses[stage] = typeof value === 'string' ? value : null;
  }
  const gate = evaluateEnrolledFlip({
    canAssignSection: false,
    sectionId: null,
    prereqStatuses,
    studentNumber: null,
  });
  if (gate.ok) return { ready: true, outstanding: [] };
  return {
    ready: false,
    outstanding: (gate.blockers ?? []).map((b) => b.stage),
  };
}

/** "Documents, Fees" — or "Ready to enrol" when nothing is outstanding. */
export function formatOutstanding(readiness: EnrolmentReadiness): string {
  return readiness.ready ? 'Ready to enrol' : readiness.outstanding.join(', ');
}

/**
 * Whether an admissions status row belongs on the list, before the roster
 * check: a class is chosen (non-blank `classSection`) and the application is
 * still open — neither Enrolled / Enrolled (Conditional), whose children join
 * the class list, nor Cancelled / Withdrawn, who are not coming.
 */
export function isClassChosenAwaitingEnrolment(row: {
  classSection: string | null | undefined;
  applicationStatus: string | null | undefined;
}): boolean {
  if (!row.classSection || row.classSection.trim().length === 0) return false;
  if (isEnrolledApplicationStatus(row.applicationStatus)) return false;
  const status = (row.applicationStatus ?? '').trim();
  if ((APPLICATION_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return false;
  }
  return true;
}

export type ClassChosenRow = {
  /** Which academic year the application is for. The view spans the current
   *  AY and the upcoming one taking applications. */
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  levelApplied: string | null;
  classLevel: string | null;
  classSection: string;
  applicationStatus: string | null;
  ready: boolean;
  outstanding: string[];
  /** `classUpdatedDate` — when the class was last chosen or changed. */
  classChosenAt: string | null;
  /** `classUpdatedby` — who chose it (an email for SIS writes). */
  classChosenBy: string | null;
};

/**
 * Ready to enrol first (the rows admissions can finish today), then the
 * longest-waiting class choice first. A row with no choice date sorts after
 * the dated ones — how long it has waited is unknown, not "forever". Ties
 * break on the name so the list is stable between reloads.
 */
export function compareClassChosenRows(
  a: ClassChosenRow,
  b: ClassChosenRow
): number {
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  const da = a.classChosenAt;
  const db = b.classChosenAt;
  if (da && db && da !== db) return da < db ? -1 : 1;
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.fullName.localeCompare(b.fullName);
}
