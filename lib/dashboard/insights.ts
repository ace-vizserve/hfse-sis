import type { Delta } from './range';

/**
 * Dashboard insights engine — pure functions that turn already-fetched
 * dashboard data into narrative observations for the CEO + module operators.
 *
 * Each generator takes the RangeResult + context it needs and returns
 * 0-5 insights, severity-sorted (bad → warn → good → info). No DB calls;
 * this file is fully pure and testable.
 */

export type InsightSeverity = 'good' | 'warn' | 'bad' | 'info';

export type Insight = {
  severity: InsightSeverity;
  title: string;
  detail: string;
  cta?: { label: string; href: string };
};

// Severity ordering — bad + warn float to the top of the panel.
const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  bad: 0,
  warn: 1,
  good: 2,
  info: 3,
};

export function sortInsights(items: Insight[]): Insight[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n.toLocaleString('en-SG')} ${many}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Admissions — the CEO's primary reporting surface.
// ─────────────────────────────────────────────────────────────────────────

export type AdmissionsInsightInput = {
  applications: number;
  enrolled: number;
  conversionPct: number;
  /** Undefined when the user hasn't opted into a comparison. */
  conversionPctPrior?: number;
  avgDaysToEnroll: number;
  /** Undefined when the user hasn't opted into a comparison. */
  avgDaysToEnrollPrior?: number;
  /** Undefined when the user hasn't opted into a comparison. */
  appsDelta?: Delta;
  outdatedCount: number;
  topReferral?: { source: string; count: number; totalCount: number };
  funnelDropOff?: { stage: string; dropOffPct: number };
};

export function admissionsInsights(input: AdmissionsInsightInput): Insight[] {
  const out: Insight[] = [];

  // Applications velocity vs prior
  if (input.appsDelta && input.appsDelta.pct !== null && Math.abs(input.appsDelta.pct) >= 5) {
    const up = input.appsDelta.direction === 'up';
    out.push({
      severity: up ? 'good' : 'warn',
      title: up ? 'Applications rising' : 'Applications slowing',
      detail: `${pluralize(input.applications, 'application', 'applications')} in range — ${pct(input.appsDelta.pct)} vs prior period`,
    });
  }

  // Conversion trend
  if (input.conversionPctPrior != null) {
    const convDelta = input.conversionPct - input.conversionPctPrior;
    if (Math.abs(convDelta) >= 3) {
      const up = convDelta > 0;
      out.push({
        severity: up ? 'good' : 'bad',
        title: up ? 'Conversion improving' : 'Conversion dropping',
        detail: `${input.conversionPct.toFixed(1)}% this period vs ${input.conversionPctPrior.toFixed(1)}% prior — ${up ? '+' : ''}${convDelta.toFixed(1)} pp`,
      });
    }
  }

  // Time-to-enroll drift
  if (
    input.avgDaysToEnrollPrior != null &&
    input.avgDaysToEnrollPrior > 0 &&
    input.avgDaysToEnroll > 0
  ) {
    const driftDays = input.avgDaysToEnroll - input.avgDaysToEnrollPrior;
    if (Math.abs(driftDays) >= 5) {
      const slower = driftDays > 0;
      out.push({
        severity: slower ? 'warn' : 'good',
        title: slower ? 'Enrollment slower' : 'Enrollment faster',
        detail: `${input.avgDaysToEnroll}d average vs ${input.avgDaysToEnrollPrior}d prior (${slower ? '+' : ''}${driftDays}d)`,
      });
    }
  }

  // Stalled applications — actionable for admissions team
  if (input.outdatedCount >= 3) {
    out.push({
      severity: input.outdatedCount >= 10 ? 'bad' : 'warn',
      title: `${pluralize(input.outdatedCount, 'applicant', 'applicants')} need follow-up`,
      detail: 'Stages not updated in >7 days — outside Enrolled/Cancelled/Withdrawn',
      cta: { label: 'Review list', href: '#outdated-applications' },
    });
  }

  // Top referral source — informational, aids CEO reporting
  if (input.topReferral && input.topReferral.totalCount > 0) {
    const share = (input.topReferral.count / input.topReferral.totalCount) * 100;
    if (share >= 15) {
      out.push({
        severity: 'info',
        title: `Top source: ${input.topReferral.source}`,
        detail: `${share.toFixed(0)}% of applicants in range (${input.topReferral.count} of ${input.topReferral.totalCount})`,
      });
    }
  }

  // Funnel drop-off callout
  if (input.funnelDropOff && input.funnelDropOff.dropOffPct >= 25) {
    out.push({
      severity: 'warn',
      title: `Drop-off at ${input.funnelDropOff.stage}`,
      detail: `${input.funnelDropOff.dropOffPct}% of applicants don't advance past this stage`,
    });
  }

  return sortInsights(out).slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────────
// Admissions chase (Workstream A) — un-enrolled document chase lens that
// runs alongside the funnel-conversion `admissionsInsights` above. Drives
// the InsightsPanel mount on /admissions for the chase strip + new
// PriorityPanel pair (KD #57 operational top-of-fold).
// ─────────────────────────────────────────────────────────────────────────

export type AdmissionsChaseInsightInput = {
  chaseToFollow: number;
  chaseRejected: number;
  chaseUploaded: number;
  chaseExpired: number;
  totalApplicants: number;
};

export function admissionsChaseInsights(input: AdmissionsChaseInsightInput): Insight[] {
  const out: Insight[] = [];

  if (input.chaseRejected >= 1) {
    out.push({
      severity: input.chaseRejected >= 5 ? 'bad' : 'warn',
      title: `${pluralize(input.chaseRejected, 'applicant', 'applicants')} need re-uploads`,
      detail:
        'Documents rejected by registrar — re-notify parents to re-upload before the funnel stalls',
      cta: { label: 'View rejected', href: '?status=rejected' },
    });
  }

  if (input.chaseExpired >= 1) {
    out.push({
      severity: 'bad',
      title: `${pluralize(input.chaseExpired, 'applicant has', 'applicants have')} expired documents`,
      detail:
        'Passport / pass / guardian docs lapsed mid-pipeline — chase parents before enrollment can finish',
      cta: { label: 'View expired', href: '?status=expired' },
    });
  }

  if (input.chaseToFollow >= 5) {
    out.push({
      severity: input.chaseToFollow >= 15 ? 'warn' : 'info',
      title: `${pluralize(input.chaseToFollow, 'applicant', 'applicants')} marked 'To follow'`,
      detail:
        'Parents committed to upload — chase up before the promise goes stale',
      cta: { label: 'View To follow', href: '?status=to-follow' },
    });
  }

  if (input.chaseUploaded >= 10) {
    out.push({
      severity: input.chaseUploaded >= 30 ? 'warn' : 'info',
      title: `${pluralize(input.chaseUploaded, 'document', 'documents')} awaiting registrar review`,
      detail: 'Parents uploaded — the validation backlog is growing',
      cta: { label: 'View pending review', href: '?status=uploaded' },
    });
  }

  if (
    input.chaseToFollow === 0 &&
    input.chaseRejected === 0 &&
    input.chaseUploaded === 0 &&
    input.chaseExpired === 0 &&
    input.totalApplicants > 0
  ) {
    out.push({
      severity: 'good',
      title: 'No chase signals today',
      detail: `${input.totalApplicants.toLocaleString('en-SG')} applicants in scope · all docs in steady state`,
    });
  }

  return sortInsights(out).slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
// Records — enrolled-student lens.
// ─────────────────────────────────────────────────────────────────────────

export type RecordsInsightInput = {
  newEnrollments: number;
  withdrawals: number;
  /** Undefined when the user hasn't opted into a comparison. */
  newEnrollmentsPrior?: number;
  /** Undefined when the user hasn't opted into a comparison. */
  withdrawalsPrior?: number;
  activeEnrolled: number;
  expiringSoon: number;
  /** Undefined when the user hasn't opted into a comparison. */
  enrollmentDelta?: Delta;
};

export function recordsInsights(input: RecordsInsightInput): Insight[] {
  const out: Insight[] = [];
  const hasCmp = input.enrollmentDelta != null;

  // Good-signal only when the delta is materially positive (spec §2: Δ ≥ +5%).
  // Volume-only fallback when no prior period to compare against yet.
  if (
    input.newEnrollments > 0 &&
    hasCmp &&
    input.enrollmentDelta!.pct !== null &&
    input.enrollmentDelta!.pct >= 5
  ) {
    out.push({
      severity: 'good',
      title: `${pluralize(input.newEnrollments, 'new enrollment', 'new enrollments')} rising`,
      detail: `${pct(input.enrollmentDelta!.pct!)} vs prior period`,
    });
  } else if (
    input.newEnrollments > 0 &&
    hasCmp &&
    input.enrollmentDelta!.pct === null
  ) {
    out.push({
      severity: 'info',
      title: `${pluralize(input.newEnrollments, 'new enrollment', 'new enrollments')}`,
      detail: `${input.newEnrollmentsPrior ?? 0} in prior period`,
    });
  } else if (input.newEnrollments > 0 && !hasCmp) {
    out.push({
      severity: 'info',
      title: `${pluralize(input.newEnrollments, 'new enrollment', 'new enrollments')}`,
      detail: 'In current range',
    });
  }

  if (input.withdrawals > 0) {
    const prior = input.withdrawalsPrior ?? 0;
    const severity: InsightSeverity = hasCmp
      ? input.withdrawals > prior * 1.5 && prior > 0
        ? 'bad'
        : input.withdrawals > 3
          ? 'warn'
          : 'info'
      : input.withdrawals > 3
        ? 'warn'
        : 'info';
    out.push({
      severity,
      title: `${pluralize(input.withdrawals, 'withdrawal', 'withdrawals')} logged`,
      detail: hasCmp
        ? `${prior} in prior period — ${severity === 'bad' ? 'investigate' : 'monitor'}`
        : `${severity === 'warn' ? 'Above the usual cadence — investigate' : 'In current range'}`,
      cta: { label: 'Review withdrawals', href: '#recent-withdrawals' },
    });
  }

  if (input.expiringSoon >= 3) {
    out.push({
      severity: input.expiringSoon >= 10 ? 'warn' : 'info',
      title: `${pluralize(input.expiringSoon, 'document', 'documents')} expiring ≤60d`,
      detail: 'Flag for collection via P-Files',
      cta: { label: 'Open P-Files', href: '/p-files' },
    });
  }

  if (input.activeEnrolled > 0) {
    out.push({
      severity: 'info',
      title: `${input.activeEnrolled.toLocaleString('en-SG')} active enrolled`,
      detail: 'Current headcount across all sections',
    });
  }

  return sortInsights(out).slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
// P-Files — document repository lens.
// ─────────────────────────────────────────────────────────────────────────

export type PfilesInsightInput = {
  revisionsInRange: number;
  /** Undefined when the user hasn't opted into a comparison. */
  revisionsInRangePrior?: number;
  expiringSoon: number;
  totalDocuments: number;
  /** Undefined when the user hasn't opted into a comparison. */
  revisionsDelta?: Delta;
};

export function pfilesInsights(input: PfilesInsightInput): Insight[] {
  const out: Insight[] = [];

  if (input.expiringSoon >= 1) {
    out.push({
      severity: input.expiringSoon >= 10 ? 'bad' : 'warn',
      title: `${pluralize(input.expiringSoon, 'document', 'documents')} expiring soon`,
      detail: 'Next 60 days — contact families for renewal',
    });
  }

  // Phase 2B drop: the prior "pending review" + validation-coverage insights
  // both belonged to admissions (initial chase). P-Files surfaces the
  // renewal lens only — expiring-soon above + revision-volume below.

  if (
    input.revisionsInRange > 0 &&
    input.revisionsDelta &&
    input.revisionsDelta.pct !== null &&
    Math.abs(input.revisionsDelta.pct) >= 20
  ) {
    const up = input.revisionsDelta.direction === 'up';
    out.push({
      severity: 'info',
      title: up ? 'Upload volume up' : 'Upload volume down',
      detail: `${pluralize(input.revisionsInRange, 'revision', 'revisions')} in range (${pct(input.revisionsDelta.pct)})`,
    });
  }

  return sortInsights(out).slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
// Markbook — grading lens.
// ─────────────────────────────────────────────────────────────────────────

export type MarkbookInsightInput = {
  gradesEntered: number;
  /** Undefined when the user hasn't opted into a comparison. */
  gradesDelta?: Delta;
  sheetsLocked: number;
  sheetsTotal: number;
  lockedPct: number;
  changeRequestsPending: number;
  avgDecisionHours: number | null;
};

export function markbookInsights(input: MarkbookInsightInput): Insight[] {
  const out: Insight[] = [];

  if (input.changeRequestsPending >= 1) {
    out.push({
      severity: input.changeRequestsPending >= 5 ? 'bad' : 'warn',
      title: `${pluralize(input.changeRequestsPending, 'change request', 'change requests')} pending`,
      detail: input.avgDecisionHours != null
        ? `Avg decision time: ${input.avgDecisionHours.toFixed(1)}h`
        : 'Awaiting approver action',
      cta: { label: 'Review requests', href: '/markbook/change-requests' },
    });
  }

  if (input.lockedPct >= 90) {
    out.push({
      severity: 'good',
      title: 'Sheets nearly all locked',
      detail: `${input.lockedPct.toFixed(0)}% of ${input.sheetsTotal.toLocaleString('en-SG')} sheets finalized`,
    });
  } else if (input.lockedPct < 50 && input.sheetsTotal > 0) {
    out.push({
      severity: 'warn',
      title: 'Locking behind',
      detail: `Only ${input.lockedPct.toFixed(0)}% of ${input.sheetsTotal.toLocaleString('en-SG')} sheets locked`,
    });
  }

  if (
    input.gradesEntered > 0 &&
    input.gradesDelta &&
    input.gradesDelta.pct !== null &&
    Math.abs(input.gradesDelta.pct) >= 15
  ) {
    const up = input.gradesDelta.direction === 'up';
    out.push({
      severity: 'info',
      title: up ? 'Entry velocity up' : 'Entry velocity down',
      detail: `${input.gradesEntered.toLocaleString('en-SG')} grades entered — ${pct(input.gradesDelta.pct)} vs prior`,
    });
  }

  return sortInsights(out).slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
// Attendance — daily operations lens.
// ─────────────────────────────────────────────────────────────────────────

export type AttendanceInsightInput = {
  attendancePct: number;
  /** Undefined when the user hasn't opted into a comparison. */
  attendancePctPrior?: number;
  late: number;
  /** Undefined when the user hasn't opted into a comparison. */
  latePrior?: number;
  excused: number;
  absent: number;
  /** Undefined when the user hasn't opted into a comparison. */
  absentPrior?: number;
  encodedDays: number;
};

export function attendanceInsights(input: AttendanceInsightInput): Insight[] {
  const out: Insight[] = [];

  // Attendance rate vs prior
  if (input.attendancePctPrior != null) {
    const diff = input.attendancePct - input.attendancePctPrior;
    if (input.encodedDays > 0 && Math.abs(diff) >= 1) {
      const up = diff > 0;
      out.push({
        severity: up ? 'good' : input.attendancePct < 90 ? 'bad' : 'warn',
        title: up ? 'Attendance improving' : 'Attendance dropping',
        detail: `${input.attendancePct.toFixed(1)}% vs ${input.attendancePctPrior.toFixed(1)}% prior (${up ? '+' : ''}${diff.toFixed(1)} pp)`,
      });
    }
  }

  // Absolute absence spike
  if (
    input.absentPrior != null &&
    input.absent > 0 &&
    input.absentPrior > 0 &&
    input.absent > input.absentPrior * 1.5
  ) {
    out.push({
      severity: 'bad',
      title: 'Absence spike',
      detail: `${input.absent} absences vs ${input.absentPrior} prior — investigate`,
    });
  }

  // Late incidents spike
  if (
    input.latePrior != null &&
    input.late > 0 &&
    input.latePrior > 0 &&
    input.late > input.latePrior * 1.5
  ) {
    out.push({
      severity: 'warn',
      title: 'Late incidents up',
      detail: `${input.late} lates vs ${input.latePrior} prior`,
    });
  }

  // Low-enrollment guard
  if (input.encodedDays === 0) {
    out.push({
      severity: 'info',
      title: 'No attendance data',
      detail: 'No records encoded in range — pick a range covering school days',
    });
  } else if (input.attendancePct >= 95) {
    out.push({
      severity: 'good',
      title: 'High attendance',
      detail: `${input.attendancePct.toFixed(1)}% over ${input.encodedDays.toLocaleString('en-SG')} encoded days`,
    });
  }

  return sortInsights(out).slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
// Evaluation — adviser write-up lens.
// ─────────────────────────────────────────────────────────────────────────

export type EvaluationInsightInput = {
  submissionPct: number;
  submitted: number;
  expected: number;
  medianTimeToSubmitDays: number | null;
  /** Null when the user hasn't opted into a comparison. */
  medianTimeToSubmitDaysPrior?: number | null;
  lateSubmissions: number;
};

export function evaluationInsights(input: EvaluationInsightInput): Insight[] {
  const out: Insight[] = [];

  if (input.expected > 0) {
    if (input.submissionPct >= 90) {
      out.push({
        severity: 'good',
        title: 'Submissions on track',
        detail: `${input.submissionPct.toFixed(0)}% of ${input.expected.toLocaleString('en-SG')} expected write-ups submitted`,
      });
    } else if (input.submissionPct < 50) {
      out.push({
        severity: 'bad',
        title: 'Submissions behind',
        detail: `Only ${input.submissionPct.toFixed(0)}% of ${input.expected.toLocaleString('en-SG')} expected write-ups submitted`,
      });
    } else {
      out.push({
        severity: 'warn',
        title: 'Submissions in progress',
        detail: `${input.submissionPct.toFixed(0)}% of ${input.expected.toLocaleString('en-SG')} expected write-ups submitted`,
      });
    }
  }

  if (input.lateSubmissions >= 1) {
    out.push({
      severity: input.lateSubmissions >= 5 ? 'warn' : 'info',
      title: `${pluralize(input.lateSubmissions, 'late submission', 'late submissions')}`,
      detail: 'Submitted >14 days after term opened',
    });
  }

  if (input.medianTimeToSubmitDays != null && input.medianTimeToSubmitDaysPrior != null) {
    const diff = input.medianTimeToSubmitDays - input.medianTimeToSubmitDaysPrior;
    if (Math.abs(diff) >= 2) {
      const slower = diff > 0;
      out.push({
        severity: slower ? 'warn' : 'good',
        title: slower ? 'Slower turnaround' : 'Faster turnaround',
        detail: `${input.medianTimeToSubmitDays}d median vs ${input.medianTimeToSubmitDaysPrior}d prior`,
      });
    }
  }

  return sortInsights(out).slice(0, 4);
}

// ─────────────────────────────────────────────────────────────────────────
// SIS Admin — system-operations lens.
// ─────────────────────────────────────────────────────────────────────────

export type SisInsightInput = {
  auditEventsCurrent: number;
  /** Undefined when the user hasn't opted into a comparison. */
  auditEventsComparison?: number;
  /** Undefined when the user hasn't opted into a comparison. */
  auditDelta?: Delta;
  topModule?: { module: string; count: number };
  activeModules: number;
  trackedModules: number;
};

export function sisInsights(input: SisInsightInput): Insight[] {
  const out: Insight[] = [];

  if (
    input.auditDelta &&
    input.auditDelta.pct !== null &&
    Math.abs(input.auditDelta.pct) >= 25
  ) {
    const up = input.auditDelta.direction === 'up';
    out.push({
      severity: up ? 'info' : 'warn',
      title: up ? 'System activity rising' : 'System activity falling',
      detail: `${input.auditEventsCurrent.toLocaleString('en-SG')} audit events — ${pct(input.auditDelta.pct)} vs prior`,
    });
  }

  if (input.topModule && input.topModule.count > 0 && input.auditEventsCurrent > 0) {
    const share = (input.topModule.count / input.auditEventsCurrent) * 100;
    if (share >= 40) {
      out.push({
        severity: 'info',
        title: `${input.topModule.module} dominates`,
        detail: `${share.toFixed(0)}% of all audit events (${input.topModule.count.toLocaleString('en-SG')} of ${input.auditEventsCurrent.toLocaleString('en-SG')})`,
      });
    }
  }

  if (input.activeModules < input.trackedModules && input.trackedModules > 0) {
    const inactive = input.trackedModules - input.activeModules;
    if (inactive >= 2) {
      out.push({
        severity: 'info',
        title: `${pluralize(inactive, 'module', 'modules')} quiet in range`,
        detail: `${input.activeModules}/${input.trackedModules} modules logged activity`,
      });
    }
  }

  if (input.auditEventsCurrent === 0) {
    out.push({
      severity: 'info',
      title: 'No audit activity',
      detail: 'No mutations logged in range — pick a broader range',
    });
  }

  return sortInsights(out).slice(0, 4);
}
