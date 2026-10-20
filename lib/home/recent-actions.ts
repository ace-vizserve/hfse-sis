import { createServiceClient } from '@/lib/supabase/service';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';
import { auditModuleForAction } from '@/lib/audit/modules';

export type RecentAction = {
  id: string;
  label: string;
  summary: string;
  tone: 'default' | 'secondary' | 'destructive' | 'warning';
  timeAgo: string;
  /** The module the action happened in, named as the module switcher names
   *  it. Null for an action no module claims yet. */
  module: string | null;
};

// The audit chart's module list (lib/audit/modules.ts) groups for COUNTING, so
// it files a few families where they are configured rather than where a person
// did the work. The home tag names the place the viewer would go back to, so
// it reads that list and renames the groups that have no module of their own.
const TAG_BY_AUDIT_MODULE: Record<string, string> = {
  markbook: 'Markbook',
  attendance: 'Attendance',
  evaluation: 'Evaluation',
  pfiles: 'P-Files',
  admissions: 'Admissions',
  records: 'Records',
  classes: 'SIS Admin',
  'year-setup': 'SIS Admin',
  access: 'SIS Admin',
};

export function recentActionModule(action: string): string | null {
  // Filed under Admissions in the chart list; the work lives in Billing.
  if (action.startsWith('qbo.') || action.startsWith('billing.')) {
    return 'Billing';
  }
  // Filed under Records in the chart list; it is the Classroom module.
  if (action.startsWith('classroom.')) return 'Classroom';
  // Filed under "People & access" in the chart list; absence declarations
  // are decided in Attendance.
  if (action.startsWith('declaration.')) return 'Attendance';
  const auditModule = auditModuleForAction(action);
  return auditModule ? (TAG_BY_AUDIT_MODULE[auditModule.key] ?? null) : null;
}

// Same tone→Badge-variant mapping as
// app/(markbook)/markbook/audit-log/audit-log-data-table.tsx's
// actionBadgeVariant — kept in sync by hand since it's a 4-line switch, not
// worth a shared export across an app/ ↔ lib/ boundary.
function toBadgeVariant(
  action: string
): 'default' | 'secondary' | 'destructive' | 'warning' {
  switch (auditActionTone(action)) {
    case 'destructive':
      return 'destructive';
    case 'warning':
      return 'warning';
    case 'info':
      return 'default';
    default:
      return 'secondary';
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

type RawAuditRow = {
  id: string;
  action: string;
  context: Record<string, unknown> | null;
  created_at: string;
};

/**
 * The signed-in user's own recent activity across every module, for the
 * home page. Scoped strictly by actor_email — never a module allowlist —
 * so it's safe for every role by construction: a viewer only ever sees
 * rows where THEY were the actor, regardless of which module the action
 * happened in (KD #9's per-module audit pages use action allowlists
 * because they show OTHER people's actions too; this doesn't need one).
 */
export async function getRecentActions(
  actorEmail: string,
  limit = 5
): Promise<RecentAction[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('audit_log')
    .select('id, action, context, created_at')
    .eq('actor_email', actorEmail)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as RawAuditRow[]).map((row) => ({
    id: row.id,
    label: auditActionLabel(row.action),
    summary: auditContextSummary(row.action, row.context),
    tone: toBadgeVariant(row.action),
    timeAgo: timeAgo(row.created_at),
    module: recentActionModule(row.action),
  }));
}
