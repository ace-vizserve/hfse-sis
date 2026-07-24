import { createServiceClient } from '@/lib/supabase/service';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';

export type ActivityRow = {
  id: string;
  createdAt: string;
  label: string;
  summary: string | null;
  tone: 'default' | 'info' | 'warning' | 'destructive';
};

type RawAuditRow = {
  id: string;
  action: string;
  entity_type: string;
  context: Record<string, unknown> | null;
  created_at: string;
};

/**
 * The signed-in account's own last N audit_log rows, humanized. Reads via
 * the service client — audit_log SELECT is RLS-gated to
 * is_registrar_or_above() (migration 006), so a plain server client would
 * return nothing for a teacher/p_file_officer/admissions session. This is
 * the same reason every per-module audit-log page already uses the service
 * client.
 */
export async function getRecentActivity(
  email: string,
  limit = 6
): Promise<ActivityRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('audit_log')
    .select('id, action, entity_type, context, created_at')
    .eq('actor_email', email)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as RawAuditRow[]).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    label: auditActionLabel(row.action),
    summary: auditContextSummary(row.action, row.context ?? undefined),
    tone: auditActionTone(row.action),
  }));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "14 min ago" / "3 hours ago" / "Yesterday" / "3 days ago" / a short date beyond a week. */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date()
): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < HOUR) {
    const mins = Math.max(1, Math.floor(ms / MINUTE));
    return `${mins} min ago`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(ms / DAY);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
  });
}
