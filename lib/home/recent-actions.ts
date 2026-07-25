import { createServiceClient } from '@/lib/supabase/service';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';

export type RecentAction = {
  id: string;
  label: string;
  summary: string;
  tone: 'default' | 'secondary' | 'destructive' | 'warning';
  timeAgo: string;
};

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
  limit = 8
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
  }));
}
