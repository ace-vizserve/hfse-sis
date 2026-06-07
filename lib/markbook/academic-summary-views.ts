// Pure view-derivation library for the Academic Summary quick views.
//
// Three exported "build*" functions transform an already-loaded
// `MasterfilePayload` into flat row arrays for the Awards, Attendance, and
// Comments child pages.  No DB calls; entirely testable without Next.js or
// Supabase.
//
// count == drill (KD #124): the hub dashboard and these view functions share
// the same predicates (via `awardTierForRow` from masterfile-dashboard) so
// the donut / card counts always match the list rows.
//
// Domain notes:
//   - Awards: the official tier comes from overallAward / award (computed at
//     load time by the masterfile loader); per-term views are provisional
//     scores only — no tier assigned (a single term isn't an award period).
//   - Attendance: absent = schoolDays − present − late (late is a sub-set of
//     present in this schema). Rate = present / schoolDays × 100.
//   - Comments: T1–T3 only (KD #49; T4 has no FCA comment). Status is
//     Submitted (non-empty text + submitted flag), Draft (non-empty + not
//     submitted), or Missing (no/empty entry).

import {
  awardTierForRow,
  type AwardTier,
} from '@/lib/markbook/masterfile-dashboard';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
} from '@/lib/markbook/masterfile';
import type { SubjectAwardLabel } from '@/lib/compute/awards';

// ---------- Shared helpers ----------

export type EnrollmentStatusLabel = 'Active' | 'Late enrollee' | 'Withdrawn';

function statusLabel(r: MasterfileStudentRow): EnrollmentStatusLabel {
  if (r.enrollmentStatus === 'withdrawn') return 'Withdrawn';
  if (r.enrollmentStatus === 'late_enrollee') return 'Late enrollee';
  return 'Active';
}

/** Map a SubjectAwardLabel to the AwardTier used by the dashboard donut. */
export function subjectLabelToTier(label: SubjectAwardLabel): AwardTier | null {
  switch (label) {
    case 'Gold':
      return 'gold';
    case 'Silver':
      return 'silver';
    case 'Bronze':
      return 'bronze';
    case 'Not eligible for Subject Award':
      return 'notEligible';
    default:
      // null = withdrawn / no data — no tier to display
      return null;
  }
}

// ---------- Awards ----------

export type AwardsRow = {
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: EnrollmentStatusLabel;
  /** Resolved joining term for late enrollees; null otherwise. */
  lateTermNumber: number | null;
  /** Numeric score: generalAverage (overall) or subject overall / term quarterly. */
  score: number | null;
  /**
   * Official tier (full-year mode only). null in per-term / provisional mode —
   * a single term is not an award period.
   */
  tier: AwardTier | null;
};

export type AwardsOptions = {
  /**
   * 'overall' → use generalAverage / overallAward.
   * A subject id → use that subject's overall / award (or quarterly when
   * termNumber is set).
   */
  subjectId: 'overall' | string;
  /**
   * null = full-year official awards (tier is computed from the award label).
   * A term number = per-term provisional performance (tier is always null).
   */
  termNumber: number | null;
  /** Narrow to a specific tier. Ignored in per-term mode. */
  tier?: AwardTier | 'all';
};

export function buildAwardsRows(
  payload: MasterfilePayload,
  opts: AwardsOptions
): AwardsRow[] {
  const subjectIndex =
    opts.subjectId === 'overall'
      ? -1
      : payload.subjects.findIndex((s) => s.id === opts.subjectId);

  const termIndex =
    opts.termNumber == null
      ? -1
      : payload.terms.findIndex((t) => t.termNumber === opts.termNumber);

  const rows: AwardsRow[] = payload.rows.map((r) => {
    let score: number | null = null;
    let tier: AwardTier | null = null;

    if (opts.termNumber == null) {
      // ── Full-year mode: official award tier ──────────────────────────────
      if (opts.subjectId === 'overall') {
        score = r.generalAverage;
        tier = awardTierForRow(r);
      } else if (subjectIndex >= 0) {
        const sr = r.subjectRows[subjectIndex];
        score = sr?.overall ?? null;
        tier = sr ? subjectLabelToTier(sr.award) : null;
      }
    } else if (termIndex >= 0) {
      // ── Per-term mode: provisional score, no official tier ───────────────
      if (opts.subjectId === 'overall') {
        // Compute a simple mean of examinable quarterly grades for that term.
        const vals = r.subjectRows
          .map((sr, i) =>
            payload.subjects[i]?.isExaminable
              ? (sr.cells[termIndex]?.quarterly ?? null)
              : null
          )
          .filter((v): v is number => v != null);
        score =
          vals.length > 0
            ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) /
              10
            : null;
      } else if (subjectIndex >= 0) {
        score =
          r.subjectRows[subjectIndex]?.cells[termIndex]?.quarterly ?? null;
      }
      // tier stays null — per-term is provisional, not an award period
    }

    return {
      studentNumber: r.studentNumber,
      studentName: r.fullName,
      sectionName: r.sectionName,
      status: statusLabel(r),
      lateTermNumber: r.lateEnrolleeTermNumber,
      score,
      tier,
    };
  });

  // Apply tier filter (full-year only; noop in per-term mode because tier = null)
  const filtered =
    opts.termNumber == null && opts.tier && opts.tier !== 'all'
      ? rows.filter((r) => r.tier === opts.tier)
      : rows;

  // Best-first; nulls last.
  return filtered.sort(
    (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)
  );
}

// ---------- Attendance ----------

export type AttendanceRow = {
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: EnrollmentStatusLabel;
  lateTermNumber: number | null;
  present: number;
  late: number;
  /** absent = schoolDays − present − late (floor at 0) */
  absent: number;
  schoolDays: number;
  /** present / schoolDays × 100, rounded to 1dp.  null when schoolDays = 0. */
  rate: number | null;
};

export function buildAttendanceRows(
  payload: MasterfilePayload,
  opts: { termNumber: number | null }
): AttendanceRow[] {
  const termId =
    opts.termNumber == null
      ? null
      : (payload.terms.find((t) => t.termNumber === opts.termNumber)?.id ??
        null);

  return payload.rows
    .map((r) => {
      let present = 0;
      let late = 0;
      let schoolDays = 0;

      if (termId == null) {
        // Total across the AY
        present = r.attendanceTotal.present;
        late = r.attendanceTotal.late;
        schoolDays = r.attendanceTotal.schoolDays;
      } else {
        const cell = r.attendanceByTerm.find((c) => c.termId === termId);
        present = cell?.present ?? 0;
        late = cell?.late ?? 0;
        schoolDays = cell?.schoolDays ?? 0;
      }

      const absent = Math.max(0, schoolDays - present - late);
      const rate =
        schoolDays > 0 ? Math.round((present / schoolDays) * 1000) / 10 : null;

      return {
        studentNumber: r.studentNumber,
        studentName: r.fullName,
        sectionName: r.sectionName,
        status: statusLabel(r),
        lateTermNumber: r.lateEnrolleeTermNumber,
        present,
        late,
        absent,
        schoolDays,
        rate,
      };
    })
    .sort((a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity));
}

// ---------- Comments ----------

export type CommentStatus = 'Submitted' | 'Draft' | 'Missing';

export type CommentRow = {
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: EnrollmentStatusLabel;
  lateTermNumber: number | null;
  termNumber: number;
  adviser: string | null;
  commentStatus: CommentStatus;
  /** The raw text, or null when Missing. */
  text: string | null;
};

/**
 * Build comment rows.
 *
 * @param opts.termNumber  A specific term (1–3), or null = all T1–T3 terms.
 *                         T4 is always excluded (KD #49 — no FCA comment).
 * @param opts.status      Optional filter. 'all' or omitted = no filter.
 */
export function buildCommentRows(
  payload: MasterfilePayload,
  opts: { termNumber: number | null; status?: CommentStatus | 'all' }
): CommentRow[] {
  // T1–T3 only (KD #49); further narrowed when a specific term is requested.
  const commentTermNumbers = payload.terms
    .filter((t) => t.termNumber >= 1 && t.termNumber <= 3)
    .filter((t) => opts.termNumber == null || t.termNumber === opts.termNumber)
    .map((t) => t.termNumber);

  const out: CommentRow[] = [];

  for (const r of payload.rows) {
    for (const tn of commentTermNumbers) {
      const cell = r.commentsByTerm.find((c) => c.termNumber === tn);
      const text = cell?.text ? cell.text.trim() || null : null;

      let commentStatus: CommentStatus;
      if (!text) {
        commentStatus = 'Missing';
      } else if (cell?.submitted) {
        commentStatus = 'Submitted';
      } else {
        commentStatus = 'Draft';
      }

      out.push({
        studentNumber: r.studentNumber,
        studentName: r.fullName,
        sectionName: r.sectionName,
        status: statusLabel(r),
        lateTermNumber: r.lateEnrolleeTermNumber,
        termNumber: tn,
        adviser: r.formClassAdviser,
        commentStatus,
        text,
      });
    }
  }

  const filtered =
    opts.status && opts.status !== 'all'
      ? out.filter((r) => r.commentStatus === opts.status)
      : out;

  return filtered.sort(
    (a, b) =>
      a.sectionName.localeCompare(b.sectionName) ||
      a.studentName.localeCompare(b.studentName) ||
      a.termNumber - b.termNumber
  );
}
