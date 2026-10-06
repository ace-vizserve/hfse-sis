import { resolveCategory } from '@/lib/p-files/document-config';
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  findOpenPrereqSteps,
} from '@/lib/schemas/sis';

// ──────────────────────────────────────────────────────────────────────────
// Enrolled, steps still open — the Admissions chase queue.
//
// Since 2026-09-28 the Enrolled flip WARNS rather than blocks: admissions staff
// enrol a child before every step is done to secure a class seat (class
// assignment requires Enrolled, KD #226), ticking "Enrol anyway" in the stage
// dialog. Mr Ace: those children need chasing — "like Students needing setup,
// but for applicants". This file is the pure half: which rows belong on the
// queue and in what order. The read is `enrolled-open-steps-loader.ts`.
//
// A row belongs when:
//   - its application status is plain `Enrolled`, and
//   - at least one of THIS child's prerequisite steps
//     (`enrolledPrereqStagesFor(category)` — Current / VizSchool Current skip
//     Assessment) is not at its terminal status.
//
// ⚠ `Enrolled (Conditional)` IS DELIBERATELY LEFT OUT. Conditional enrolment
// is a separate, deliberate outcome (an assessment result, KD #180) that
// skips the prerequisite gate by design — its open steps were never an
// oversight to chase, so listing them here would bury the real work.
//
// "Finished" is decided by `findOpenPrereqSteps`, the same function the
// Enrolled flip's gate uses, so the dialog's warning and this queue cannot
// disagree about which steps are open.
// ──────────────────────────────────────────────────────────────────────────

/**
 * The status-row columns the queue reads. A string literal rather than a join
 * over `STAGE_COLUMN_MAP` because supabase-js types a non-literal select as
 * an error row; the unit test binds the prereq half to `STAGE_COLUMN_MAP` so
 * the two cannot drift.
 */
export const ENROLLED_OPEN_STEPS_STATUS_SELECT =
  'enroleeNumber, applicationStatus, enroleeType, enrolledAt, applicationUpdatedDate, applicationUpdatedBy, classLevel, classSection, registrationStatus, documentStatus, assessmentStatus, contractStatus, feeStatus';

export type EnrolledOpenStepsInput = {
  applicationStatus: string | null | undefined;
  /** Applications row's `category`, falling back to the status row's
   *  `enroleeType` (`resolveCategory`) — the same resolution the route uses. */
  category: string | null | undefined;
  enroleeType: string | null | undefined;
  /** Raw status-row values, keyed by column name (`feeStatus`, …). */
  statusRow: Record<string, unknown>;
};

/**
 * The open steps (plain stage labels, pipeline order) when this row belongs on
 * the queue, else `null`. Pure, never throws.
 */
export function classifyEnrolledOpenSteps(
  input: EnrolledOpenStepsInput
): string[] | null {
  // Plain Enrolled only — Conditional is left out on purpose (see above).
  // EXACT, not trimmed, to agree with the loader's `.eq('applicationStatus',
  // 'Enrolled')`: a padded spelling the classifier accepted would never reach
  // it. Measured 2026-09-28: AY2026 and AY2027 hold no padded spelling.
  if (input.applicationStatus !== 'Enrolled') return null;

  const category = resolveCategory({
    category: input.category,
    enroleeType: input.enroleeType,
  });
  const prereqStatuses = Object.fromEntries(
    ENROLLED_PREREQ_STAGES.map((k) => {
      const v = input.statusRow[STAGE_COLUMN_MAP[k].statusCol];
      return [k, typeof v === 'string' ? v : null];
    })
  );
  const open = findOpenPrereqSteps(category, prereqStatuses);
  return open.length > 0 ? open.map((b) => b.stage) : null;
}

export type EnrolledOpenStepsRow = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  studentName: string;
  /** The level name as the application stored it ("Year 10"). */
  levelApplied: string | null;
  /** The child's level: classLevel when set, else `levelApplied` resolved to
   *  the SIS level it counts as. What the queue shows and filters by. */
  level: string | null;
  /** `classLevel classSection` when a class is set on the row, else null. */
  classLabel: string | null;
  /** Plain stage labels, in pipeline order — "Documents", "Fees". */
  openSteps: string[];
  /** When the child reached Enrolled: `enrolledAt` (write-once, migration
   *  075). When that was never stamped — most rows enrolled before 075 — the
   *  application stage's last update instead, which moves on every later save
   *  of that stage; `enrolledOnExact` says which. ISO string.
   *
   *  Not `enrolmentDate`: despite the name, the parent portal fills it with
   *  the SUBMISSION date (`enrolmentDate: today` on insert, alongside
   *  `applicationStatus: "Submitted"`), so it says nothing about enrolment. */
  enrolledOn: string | null;
  /** True when `enrolledOn` is the `enrolledAt` stamp; false when it is the
   *  application stage's last update standing in for it. */
  enrolledOnExact: boolean;
  /** Whoever last saved the application stage — usually the person who
   *  enrolled them, but a later edit of that stage replaces it. */
  enrolledBy: string | null;
};

/** Most steps open first, then the longest-enrolled; unknown dates last. */
export function compareEnrolledOpenSteps(
  a: EnrolledOpenStepsRow,
  b: EnrolledOpenStepsRow
): number {
  if (a.openSteps.length !== b.openSteps.length) {
    return b.openSteps.length - a.openSteps.length;
  }
  if (a.enrolledOn !== b.enrolledOn) {
    if (!a.enrolledOn) return 1;
    if (!b.enrolledOn) return -1;
    // ISO strings compare lexicographically — no Date per comparison.
    return a.enrolledOn < b.enrolledOn ? -1 : 1;
  }
  return a.enroleeNumber.localeCompare(b.enroleeNumber);
}
