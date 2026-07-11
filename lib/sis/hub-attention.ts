// Pure aggregator for the SIS Admin hub's "Needs attention" feed. Merges
// three independent signals — enrolled-but-unplaced students, pending grade
// change requests, and demand for a level that isn't offered — into one
// severity-ranked row list. No I/O; the RSC page fetches the three inputs
// and this function just shapes them for `<HubAttentionFeed>`.
//
// Severity vocabulary: 'destructive' (red) for a blocking gap that keeps a
// student out of attendance/markbook/evaluation; 'amber' for a
// worth-a-look signal that isn't blocking anything today. Text always
// carries the meaning too — color is never the only signal.

import type { ClassAssignmentReadinessRow } from '@/lib/sis/dashboard';
import type { LevelDemandRow } from '@/lib/sis/level-demand';

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
  levelDemand: LevelDemandRow[];
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

  const unmetDemand = input.levelDemand.filter(
    (r) => !r.offered && r.count > 0
  );
  for (const row of unmetDemand) {
    rows.push({
      id: `level-demand-${row.label}`,
      severity: 'amber',
      text: `${row.count} ${row.count === 1 ? 'applicant chose' : 'applicants chose'} ${row.label} — not offered this year`,
      href: '/sis/admin/levels',
      actionLabel: 'Grade levels',
    });
  }

  return rows;
}
