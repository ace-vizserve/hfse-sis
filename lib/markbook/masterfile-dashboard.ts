// Masterfile dashboard cohort aggregates (KD #95 — narrative dashboard).
//
// Pure aggregation over an already-loaded `MasterfilePayload`. No DB calls, no
// new query patterns — every number here is derived from the rows + sheets the
// masterfile loader already pulls. This module is fully unit-testable; see
// `__tests__/markbook/masterfile-dashboard.test.ts`.
//
// The aggregate respects the active scope: the payload is already narrowed to
// the selected level/class, and `computeMasterfileDashboard` additionally
// honours an optional Term filter (scopes readiness counts + subject averages
// to that one term) and a Status filter (active / late-enrollee / withdrawn).
//
// "Honest pending" rule (spec §Act 2): a value the data can't yet support
// (an award, a GA, a subject average) is reported as null / "pending" rather
// than a fabricated number. The UI renders those as "pending", never a 0.

import {
  DEFAULT_AWARD_THRESHOLDS,
  type AwardThresholds,
} from '@/lib/compute/awards';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubject,
} from '@/lib/markbook/masterfile';

// ---------- Filter inputs ----------

export type MasterfileStatusFilter =
  | 'all'
  | 'active'
  | 'late_enrollee'
  | 'withdrawn';

export type MasterfileDashboardFilters = {
  // Scope readiness + subject averages to one term. null = all terms in scope.
  termNumber: number | null;
  // Limit which students are counted. 'active' means active OR late-enrollee?
  // No — to match the grid's chips, 'active' = strictly active (not late, not
  // withdrawn); 'late_enrollee' and 'withdrawn' are their own buckets.
  status: MasterfileStatusFilter;
  // Restrict subject-average + needs-data computation to one subject. null = all.
  subjectId: string | null;
};

export const DEFAULT_MASTERFILE_FILTERS: MasterfileDashboardFilters = {
  termNumber: null,
  status: 'all',
  subjectId: null,
};

// ---------- Output shapes ----------

export type ReadinessMetric = {
  done: number;
  expected: number;
  // 0..100, or null when there's nothing expected (no denominator).
  pct: number | null;
};

export type MasterfileReadiness = {
  gradesEntered: ReadinessMetric;
  sheetsLocked: ReadinessMetric;
  commentsWritten: ReadinessMetric;
  attendanceRecorded: ReadinessMetric;
  // Students whose examinable data is complete enough to receive an award/GA.
  gradableCount: number;
  // False when no examinable subjects are in scope (e.g. Subject = Music) —
  // the gradable metric is then "not applicable" rather than "0 / N".
  gradableApplicable: boolean;
  // Roster size in scope (denominator context for gradableCount). 0 when
  // gradableApplicable is false, so the card reads as pending, not a deficit.
  rosterCount: number;
};

export type AwardTierCounts = {
  gold: number;
  silver: number;
  bronze: number;
  notEligible: number;
};

export type GaBucket = {
  // Human label, e.g. "Gold band (≥ 95.5)".
  label: string;
  tier: 'gold' | 'silver' | 'bronze' | 'below';
  count: number;
};

export type SubjectAverage = {
  subjectId: string;
  subjectName: string;
  isExaminable: boolean;
  // Class average of examinable quarterly grades in scope. null = no data yet.
  avg: number | null;
  // How many graded cells contributed (sample size).
  sampleSize: number;
};

export type AttendanceHealth = {
  schoolDays: number;
  present: number;
  late: number;
  absent: number;
  // 0..100 or null when no school days recorded.
  presentRate: number | null;
  lateRate: number | null;
  absentRate: number | null;
};

export type NeedsDataItem = {
  // Grouping key — subject name (with FCA when relevant), or a workflow group.
  group: string;
  detail: string;
  count: number;
  severity: 'warn' | 'bad' | 'info';
};

export type NeedsAttentionItem = {
  studentNumber: string;
  studentName: string;
  reason: string;
  severity: 'warn' | 'bad';
};

export type MasterfileDashboard = {
  scopeLabel: string;
  readiness: MasterfileReadiness;
  outcomes: {
    awardTierCounts: AwardTierCounts;
    gaBuckets: GaBucket[];
    subjectAverages: SubjectAverage[];
    attendance: AttendanceHealth;
  };
  watchlists: {
    needsData: NeedsDataItem[];
    needsAttention: NeedsAttentionItem[];
  };
};

// ---------- Thresholds for the "needs attention" watchlist ----------

const LOW_GA_THRESHOLD = 80; // below this General Average → flag for follow-up
const LOW_ATTENDANCE_RATE = 90; // present-rate below this % → flag
const IP_FAILING_QUARTERLY = 80; // an examinable term grade below this → flag

// ---------- Helpers ----------

function metric(done: number, expected: number): ReadinessMetric {
  return {
    done,
    expected,
    pct: expected > 0 ? Math.round((done / expected) * 1000) / 10 : null,
  };
}

function isActive(r: MasterfileStudentRow): boolean {
  return r.enrollmentStatus === 'active';
}
function isLate(r: MasterfileStudentRow): boolean {
  return r.enrollmentStatus === 'late_enrollee';
}
function isWithdrawn(r: MasterfileStudentRow): boolean {
  return r.enrollmentStatus === 'withdrawn';
}

// Rows in scope after the Status filter.
function rowsForStatus(
  rows: MasterfileStudentRow[],
  status: MasterfileStatusFilter
): MasterfileStudentRow[] {
  switch (status) {
    case 'active':
      return rows.filter(isActive);
    case 'late_enrollee':
      return rows.filter(isLate);
    case 'withdrawn':
      return rows.filter(isWithdrawn);
    case 'all':
    default:
      return rows;
  }
}

// Indices (0-based) of the terms in scope given the Term filter.
function termIndicesInScope(
  payload: MasterfilePayload,
  termNumber: number | null
): number[] {
  if (termNumber == null) {
    return payload.terms.map((_, i) => i);
  }
  const idx = payload.terms.findIndex((t) => t.termNumber === termNumber);
  return idx >= 0 ? [idx] : [];
}

// Which comment terms (T1–T3) are in scope.
function commentTermsInScope(
  payload: MasterfilePayload,
  termNumber: number | null
): number[] {
  const all = payload.terms
    .map((t) => t.termNumber)
    .filter((n) => n >= 1 && n <= 3);
  if (termNumber == null) return all;
  return all.filter((n) => n === termNumber);
}

// ---------- Main entry ----------

export function computeMasterfileDashboard(
  rawPayload: MasterfilePayload,
  filters: MasterfileDashboardFilters = DEFAULT_MASTERFILE_FILTERS
): MasterfileDashboard {
  // Defensive normalization: a partial payload (e.g. an early-return that
  // omitted an array, or a stale cached shape from a prior code version) must
  // never crash the dashboard. Default every consumed array to [].
  const payload: MasterfilePayload = {
    ...rawPayload,
    rows: rawPayload.rows ?? [],
    subjects: rawPayload.subjects ?? [],
    terms: rawPayload.terms ?? [],
    sheets: rawPayload.sheets ?? [],
    thresholds: rawPayload.thresholds ?? DEFAULT_AWARD_THRESHOLDS,
  };

  const rows = rowsForStatus(payload.rows, filters.status);
  const termIdx = termIndicesInScope(payload, filters.termNumber);
  const subjects = filters.subjectId
    ? payload.subjects.filter((s) => s.id === filters.subjectId)
    : payload.subjects;
  const subjectIdSet = new Set(subjects.map((s) => s.id));

  const readiness = computeReadiness(payload, rows, termIdx, subjects, filters);
  const outcomes = {
    awardTierCounts: computeAwardTierCounts(rows),
    gaBuckets: computeGaBuckets(rows, payload.thresholds),
    subjectAverages: computeSubjectAverages(rows, subjects, termIdx),
    attendance: computeAttendanceHealth(rows, termIdx, payload),
  };
  const watchlists = {
    needsData: computeNeedsData(payload, rows, termIdx, subjects, filters),
    needsAttention: computeNeedsAttention(rows, subjectIdSet, termIdx, payload),
  };

  const termLabel =
    filters.termNumber != null ? ` · T${filters.termNumber}` : '';
  const statusLabel =
    filters.status === 'all' ? '' : ` · ${filters.status.replace('_', ' ')}`;

  return {
    scopeLabel: `${payload.level?.label ?? ''}${termLabel}${statusLabel}`,
    readiness,
    outcomes,
    watchlists,
  };
}

// ---------- Act 1: Readiness ----------

function computeReadiness(
  payload: MasterfilePayload,
  rows: MasterfileStudentRow[],
  termIdx: number[],
  subjects: MasterfileSubject[],
  filters: MasterfileDashboardFilters
): MasterfileReadiness {
  // Only count enrolled students toward readiness (withdrawn aren't expected
  // to have ongoing grades). When the Status filter is explicitly 'withdrawn',
  // honour it — the operator is inspecting that cohort.
  const enrolledRows =
    filters.status === 'withdrawn' ? rows : rows.filter((r) => !isWithdrawn(r));

  const subjectIdSet = new Set(subjects.map((s) => s.id));

  // Grades entered — filled cells vs (roster × subjects × terms in scope).
  // A cell counts as "filled" if it has a quarterly grade, a letter grade, or
  // is explicitly N/A (a deliberate non-grade for a late enrollee).
  let gradesDone = 0;
  let gradesExpected = 0;
  for (const r of enrolledRows) {
    for (const sr of r.subjectRows ?? []) {
      if (!subjectIdSet.has(sr.subjectId)) continue;
      for (const ci of termIdx) {
        const cell = (sr.cells ?? [])[ci];
        if (!cell) continue;
        gradesExpected += 1;
        if (cell.quarterly != null || cell.letter != null || cell.isNa) {
          gradesDone += 1;
        }
      }
    }
  }

  // Sheets locked — grading sheets in scope, scoped by Term + Subject filters.
  const termIdsInScope = new Set(
    termIdx.map((i) => payload.terms[i]?.id).filter(Boolean) as string[]
  );
  const sheetsInScope = payload.sheets.filter(
    (s) =>
      (filters.subjectId == null || subjectIdSet.has(s.subjectId)) &&
      termIdsInScope.has(s.termId)
  );
  const sheetsLocked = sheetsInScope.filter((s) => s.isLocked).length;

  // Comments written — FCA write-ups with content vs roster (T1–T3, KD #49).
  const commentTerms = commentTermsInScope(payload, filters.termNumber);
  let commentsDone = 0;
  let commentsExpected = 0;
  if (commentTerms.length > 0) {
    for (const r of enrolledRows) {
      for (const tn of commentTerms) {
        commentsExpected += 1;
        if (
          (r.commentsByTerm ?? []).some(
            (c) => c.termNumber === tn && c.text.trim()
          )
        ) {
          commentsDone += 1;
        }
      }
    }
  }

  // Attendance recorded — student×term rollups present vs expected.
  let attDone = 0;
  let attExpected = 0;
  for (const r of enrolledRows) {
    for (const ci of termIdx) {
      const cell = (r.attendanceByTerm ?? [])[ci];
      attExpected += 1;
      if (cell && cell.schoolDays != null && cell.present != null) {
        attDone += 1;
      }
    }
  }

  // Gradable — students with complete-enough examinable data to get a GA/award.
  // A student is gradable when every examinable subject in scope has a non-null
  // Subject Overall (the loader already nulls it when any term is missing).
  const examinableInScope = subjects.filter((s) => s.isExaminable);
  const examinableIds = new Set(examinableInScope.map((s) => s.id));
  // When no examinable subjects are in scope (e.g. Subject filter = a
  // non-examinable subject like Music), no student can be "gradable" — but
  // that's "nothing expected", not a "0 / N" deficit. Signal it with
  // gradableApplicable=false so the card reads "Pending — no examinable
  // subjects in scope" instead of a fake shortfall (honest-pending rule).
  const gradableApplicable = examinableInScope.length > 0;
  let gradableCount = 0;
  if (gradableApplicable) {
    for (const r of enrolledRows) {
      const examRows = (r.subjectRows ?? []).filter((sr) =>
        examinableIds.has(sr.subjectId)
      );
      if (examRows.length === 0) continue;
      if (examRows.every((sr) => sr.overall != null)) gradableCount += 1;
    }
  }

  return {
    gradesEntered: metric(gradesDone, gradesExpected),
    sheetsLocked: metric(sheetsLocked, sheetsInScope.length),
    commentsWritten: metric(commentsDone, commentsExpected),
    attendanceRecorded: metric(attDone, attExpected),
    gradableCount,
    gradableApplicable,
    rosterCount: gradableApplicable ? enrolledRows.length : 0,
  };
}

// ---------- Act 2: Outcomes ----------

function computeAwardTierCounts(rows: MasterfileStudentRow[]): AwardTierCounts {
  const counts: AwardTierCounts = {
    gold: 0,
    silver: 0,
    bronze: 0,
    notEligible: 0,
  };
  for (const r of rows) {
    // Withdrawn carry a null overallAward — count them as not-eligible so the
    // donut total matches the roster.
    switch (r.overallAward) {
      case 'Gold':
        counts.gold += 1;
        break;
      case 'Silver':
        counts.silver += 1;
        break;
      case 'Bronze':
        counts.bronze += 1;
        break;
      default:
        counts.notEligible += 1;
        break;
    }
  }
  return counts;
}

function computeGaBuckets(
  rows: MasterfileStudentRow[],
  thresholds: AwardThresholds
): GaBucket[] {
  const buckets: GaBucket[] = [
    {
      label: `Gold band (≥ ${thresholds.goldMin})`,
      tier: 'gold',
      count: 0,
    },
    {
      label: `Silver band (${thresholds.silverMin}–${thresholds.goldMin - 0.1})`,
      tier: 'silver',
      count: 0,
    },
    {
      label: `Bronze band (${thresholds.bronzeMin}–${thresholds.silverMin - 0.1})`,
      tier: 'bronze',
      count: 0,
    },
    {
      label: `Below award (< ${thresholds.bronzeMin})`,
      tier: 'below',
      count: 0,
    },
  ];
  for (const r of rows) {
    const ga = r.generalAverage;
    if (ga == null) continue; // pending — not bucketed
    if (ga >= thresholds.goldMin) buckets[0].count += 1;
    else if (ga >= thresholds.silverMin) buckets[1].count += 1;
    else if (ga >= thresholds.bronzeMin) buckets[2].count += 1;
    else buckets[3].count += 1;
  }
  return buckets;
}

function computeSubjectAverages(
  rows: MasterfileStudentRow[],
  subjects: MasterfileSubject[],
  termIdx: number[]
): SubjectAverage[] {
  const out: SubjectAverage[] = [];
  for (const sub of subjects) {
    if (!sub.isExaminable) {
      out.push({
        subjectId: sub.id,
        subjectName: sub.name,
        isExaminable: false,
        avg: null,
        sampleSize: 0,
      });
      continue;
    }
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const sr = (r.subjectRows ?? []).find((x) => x.subjectId === sub.id);
      if (!sr) continue;
      for (const ci of termIdx) {
        const cell = (sr.cells ?? [])[ci];
        if (cell && cell.quarterly != null && !cell.isNa) {
          sum += cell.quarterly;
          n += 1;
        }
      }
    }
    out.push({
      subjectId: sub.id,
      subjectName: sub.name,
      isExaminable: true,
      avg: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
      sampleSize: n,
    });
  }
  return out;
}

function computeAttendanceHealth(
  rows: MasterfileStudentRow[],
  termIdx: number[],
  _payload: MasterfilePayload
): AttendanceHealth {
  let schoolDays = 0;
  let present = 0;
  let late = 0;
  for (const r of rows) {
    for (const ci of termIdx) {
      const cell = (r.attendanceByTerm ?? [])[ci];
      if (!cell) continue;
      if (cell.schoolDays != null) schoolDays += cell.schoolDays;
      if (cell.present != null) present += cell.present;
      if (cell.late != null) late += cell.late;
    }
  }
  // Absent = school days a student didn't attend at all. "Late" is a subset of
  // present in this schema (days_present counts the day; days_late flags it),
  // so absent = schoolDays - present (per-student summed).
  const absent = Math.max(0, schoolDays - present);
  return {
    schoolDays,
    present,
    late,
    absent,
    presentRate:
      schoolDays > 0 ? Math.round((present / schoolDays) * 1000) / 10 : null,
    lateRate:
      schoolDays > 0 ? Math.round((late / schoolDays) * 1000) / 10 : null,
    absentRate:
      schoolDays > 0 ? Math.round((absent / schoolDays) * 1000) / 10 : null,
  };
}

// ---------- Act 3: Watchlists ----------

function computeNeedsData(
  payload: MasterfilePayload,
  rows: MasterfileStudentRow[],
  termIdx: number[],
  subjects: MasterfileSubject[],
  filters: MasterfileDashboardFilters
): NeedsDataItem[] {
  // Mirror computeReadiness: when the Status filter is 'withdrawn', the
  // operator is inspecting that cohort, so include those rows in the chase
  // list too. Otherwise withdrawn students aren't expected to have grades.
  const enrolledRows =
    filters.status === 'withdrawn' ? rows : rows.filter((r) => !isWithdrawn(r));
  const subjectById = new Map(payload.subjects.map((s) => [s.id, s]));
  const subjectIdSet = new Set(subjects.map((s) => s.id));
  const items: NeedsDataItem[] = [];

  // 1) Missing grades grouped by subject (× FCA, since chasing is per-class).
  const missingGradesBySubject = new Map<string, number>();
  for (const r of enrolledRows) {
    for (const sr of r.subjectRows ?? []) {
      if (!subjectIdSet.has(sr.subjectId)) continue;
      const sub = subjectById.get(sr.subjectId);
      if (!sub) continue;
      for (const ci of termIdx) {
        const cell = (sr.cells ?? [])[ci];
        if (!cell) continue;
        const filled =
          cell.quarterly != null || cell.letter != null || cell.isNa;
        if (!filled) {
          missingGradesBySubject.set(
            sub.name,
            (missingGradesBySubject.get(sub.name) ?? 0) + 1
          );
        }
      }
    }
  }
  for (const [subjectName, count] of missingGradesBySubject) {
    items.push({
      group: subjectName,
      detail: `${count} grade cell${count === 1 ? '' : 's'} not yet entered`,
      count,
      severity: 'warn',
    });
  }

  // 2) Unlocked sheets grouped by subject.
  const termIdsInScope = new Set(
    termIdx.map((i) => payload.terms[i]?.id).filter(Boolean) as string[]
  );
  const unlockedBySubject = new Map<string, number>();
  for (const s of payload.sheets) {
    if (filters.subjectId != null && !subjectIdSet.has(s.subjectId)) continue;
    if (!termIdsInScope.has(s.termId)) continue;
    if (s.isLocked) continue;
    const sub = subjectById.get(s.subjectId);
    const name = sub?.name ?? 'Unknown subject';
    unlockedBySubject.set(name, (unlockedBySubject.get(name) ?? 0) + 1);
  }
  for (const [subjectName, count] of unlockedBySubject) {
    items.push({
      group: subjectName,
      detail: `${count} grading sheet${count === 1 ? '' : 's'} not yet locked`,
      count,
      severity: 'info',
    });
  }

  // 3) Missing FCA comments (T1–T3) — one workflow group.
  const commentTerms = commentTermsInScope(payload, filters.termNumber);
  if (commentTerms.length > 0) {
    let missingComments = 0;
    for (const r of enrolledRows) {
      for (const tn of commentTerms) {
        if (
          !(r.commentsByTerm ?? []).some(
            (c) => c.termNumber === tn && c.text.trim()
          )
        ) {
          missingComments += 1;
        }
      }
    }
    if (missingComments > 0) {
      items.push({
        group: 'Form class adviser comments',
        detail: `${missingComments} write-up${missingComments === 1 ? '' : 's'} still blank (T1–T3)`,
        count: missingComments,
        severity: 'warn',
      });
    }
  }

  // Sort heaviest first; cap at 12 for a readable chase list.
  return items.sort((a, b) => b.count - a.count).slice(0, 12);
}

function computeNeedsAttention(
  rows: MasterfileStudentRow[],
  subjectIdSet: Set<string>,
  termIdx: number[],
  payload: MasterfilePayload
): NeedsAttentionItem[] {
  const subjectNameById = new Map(
    (payload.subjects ?? []).map((s) => [s.id, s.name])
  );
  const out: NeedsAttentionItem[] = [];
  for (const r of rows) {
    if (isWithdrawn(r)) continue;
    const reasons: string[] = [];
    let worst: 'warn' | 'bad' = 'warn';

    // Low General Average.
    if (r.generalAverage != null && r.generalAverage < LOW_GA_THRESHOLD) {
      reasons.push(`General average ${r.generalAverage.toFixed(1)}`);
      worst = 'bad';
    }

    // A failing/at-risk examinable term grade in scope.
    let lowSubject: { name: string; grade: number } | null = null;
    for (const sr of r.subjectRows ?? []) {
      if (!subjectIdSet.has(sr.subjectId)) continue;
      for (const ci of termIdx) {
        const cell = (sr.cells ?? [])[ci];
        if (cell && cell.quarterly != null && !cell.isNa) {
          if (cell.quarterly < IP_FAILING_QUARTERLY) {
            if (!lowSubject || cell.quarterly < lowSubject.grade) {
              lowSubject = {
                name: subjectNameById.get(sr.subjectId) ?? sr.subjectId,
                grade: cell.quarterly,
              };
            }
          }
        }
      }
    }
    if (lowSubject) {
      reasons.push(`${lowSubject.name} grade below ${IP_FAILING_QUARTERLY}`);
      if (worst !== 'bad') worst = 'warn';
    }

    // Low attendance.
    const ad = r.attendanceTotal ?? { present: 0, late: 0, schoolDays: 0 };
    if (ad.schoolDays > 0) {
      const rate = (ad.present / ad.schoolDays) * 100;
      if (rate < LOW_ATTENDANCE_RATE) {
        reasons.push(`Attendance ${rate.toFixed(0)}%`);
        if (worst !== 'bad') worst = 'warn';
      }
    }

    if (reasons.length > 0) {
      out.push({
        studentNumber: r.studentNumber,
        studentName: r.fullName || r.studentNumber,
        reason: reasons.join(' · '),
        severity: worst,
      });
    }
  }
  // bad before warn, then alphabetical; cap at 15.
  return out
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'bad' ? -1 : 1;
      return a.studentName.localeCompare(b.studentName);
    })
    .slice(0, 15);
}
