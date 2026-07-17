// Pure aggregator for the SIS Admin hub's "Needs attention" feed. Merges
// independent signals — enrolled-but-unplaced students, pending grade
// change requests, unadvised sections, approver-flow gaps, and Structure
// Defaults subject gaps — into one severity-ranked row list. No I/O; the
// RSC page fetches the inputs and this function just shapes them for
// `<HubAttentionFeed>`.
//
// A "demand for a level that isn't offered" signal used to live here too
// (fed by lib/sis/level-demand.ts) — removed by migration 086 alongside
// the whole Grade Levels admin page and its offered/shelved concept: the
// level catalog is now a fixed 10 core levels, always offered, so "demand
// for an unoffered level" can no longer happen.
//
// Severity vocabulary: 'destructive' (red) for a blocking gap that keeps a
// student out of attendance/markbook/evaluation; 'amber' for a
// worth-a-look signal that isn't blocking anything today. Text always
// carries the meaning too — color is never the only signal.

import type { ClassAssignmentReadinessRow } from '@/lib/sis/dashboard';
import { classifyApproverReadiness } from '@/lib/sis/approver-readiness';
import type { SubjectConfigGap } from '@/lib/sis/subject-config-gaps';

export type AttentionSeverity = 'destructive' | 'amber';

export type AttentionRow = {
  id: string;
  severity: AttentionSeverity;
  text: string;
  meta?: string;
  href: string;
  actionLabel: string;
};

export function buildAttentionRows(input: {
  unassigned: ClassAssignmentReadinessRow[];
  pendingChangeRequests: number;
  // Sections in the current AY with zero `form_adviser` teacher_assignments
  // row. Optional — the hub page fetches these separately; other callers
  // (tests, future consumers) can omit it and get the pre-existing 3-signal
  // behaviour untouched.
  unassignedAdviserSections?: Array<{ id: string; name: string }>;
  // Per-flow assigned-approver count (e.g. { 'markbook.change_request': 1 }).
  // Superadmin-only signal — the hub page only fetches this for that role
  // (mirrors the /sis/admin/approvers ROUTE_ACCESS gate + the system-health
  // strip's existing superadmin-only framing).
  approverFlowCounts?: Record<string, number>;
  // Levels whose Structure Defaults template lists subjects this AY's
  // subject_configs is missing — same computation that powers the warning
  // banner on /sis/admin/subjects, surfaced here so the gap doesn't require
  // a visit to that page to notice.
  subjectConfigGaps?: SubjectConfigGap[];
}): AttentionRow[] {
  const rows: AttentionRow[] = [];

  if (input.unassigned.length > 0) {
    const byLevel = new Map<string, number>();
    for (const r of input.unassigned) {
      const level = r.level?.trim() || 'Unknown level';
      byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
    }
    const meta = Array.from(byLevel.entries())
      .map(([level, count]) => (count > 1 ? `${level} ×${count}` : level))
      .join(' · ');
    const count = input.unassigned.length;
    rows.push({
      id: 'unplaced-students',
      severity: 'destructive',
      text: `${count} enrolled ${count === 1 ? 'student has' : 'students have'} no class yet`,
      meta,
      href: '/records/unsynced',
      actionLabel: 'Assign',
    });
  }

  if (input.pendingChangeRequests > 0) {
    const count = input.pendingChangeRequests;
    rows.push({
      id: 'pending-change-requests',
      severity: 'amber',
      text: `${count} grade ${count === 1 ? 'change is' : 'changes are'} waiting on an approver`,
      href: '/markbook/change-requests',
      actionLabel: 'Review',
    });
  }

  const unadvised = input.unassignedAdviserSections ?? [];
  if (unadvised.length > 0) {
    const count = unadvised.length;
    rows.push({
      id: 'unassigned-adviser-sections',
      severity: 'destructive',
      text: `${count} ${count === 1 ? 'section has' : 'sections have'} no form adviser`,
      meta: unadvised.map((s) => s.name).join(' · '),
      href: '/sis/sections',
      actionLabel: 'Assign',
    });
  }

  for (const [flow, count] of Object.entries(input.approverFlowCounts ?? {})) {
    const readiness = classifyApproverReadiness(count);
    if (readiness.tone === 'mint') continue; // ready, nothing to flag
    rows.push({
      id: `approver-flow-${flow}`,
      severity: 'destructive',
      text: readiness.warning ?? readiness.label,
      meta: readiness.label,
      href: '/sis/admin/approvers',
      actionLabel: 'Add approver',
    });
  }

  for (const gap of input.subjectConfigGaps ?? []) {
    const n = gap.missingSubjectCodes.length;
    rows.push({
      id: `subject-config-gap-${gap.levelId}`,
      severity: 'amber',
      text: `${gap.levelLabel} is missing ${n} subject${n === 1 ? '' : 's'} from Structure Defaults`,
      meta: gap.missingSubjectCodes.join(', '),
      href: '/sis/admin/subjects',
      actionLabel: 'Fix',
    });
  }

  // Severity-sorted, not arrival-order (Serial Position Effect — the first
  // slot in the feed should hold the most urgent item, not whichever signal
  // happened to be computed first). Array.prototype.sort is stable per spec,
  // so rows within the same severity keep their original relative order.
  const SEVERITY_RANK: Record<AttentionSeverity, number> = {
    destructive: 0,
    amber: 1,
  };
  return rows.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
}
