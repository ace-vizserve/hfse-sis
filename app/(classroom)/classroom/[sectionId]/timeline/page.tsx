import { notFound, redirect } from 'next/navigation';
import { History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  getClassroomTimeline,
  loadClassroomAccess,
} from '@/lib/classroom/queries';
import { TIMELINE_ROW_LIMIT } from '@/lib/classroom/timeline';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';
import { getSessionUser } from '@/lib/supabase/server';

// Timeline — "what happened in this class," a filtered view of audit_log.
// Every capability may open this tab (Phase 5 brief) — unlike Attendance and
// Write-ups, the data here is not gated by is_adviser_for_section, so there
// is no canReadX check to re-run beyond "does this viewer have a capability
// on this section at all." See lib/classroom/queries.ts::getClassroomTimeline
// for how the query is scoped to this section, and lib/classroom/timeline.ts
// for what is deliberately excluded (per-mark attendance) and why.
//
// Rendering goes through the shared humanizer (lib/audit/humanize.ts,
// KD #121) exactly like every other audit-log surface in the app — never a
// hand-rolled label, never JSON.stringify(context).
function actionBadgeVariant(
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

export default async function ClassroomTimelinePage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!capability) notFound();

  const rows = await getClassroomTimeline(sectionId);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Timeline
        </h2>
        {rows.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Most recent {rows.length}
            {rows.length === TIMELINE_ROW_LIMIT ? '+' : ''}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <History className="size-4" />
          </div>
          <p>Nothing recorded for this class yet.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing the most recent {TIMELINE_ROW_LIMIT} events for this class —
            sheet activity, grade changes, roster changes, and write-up saves.
            This is a recent window, not the full history.
          </p>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex flex-1 items-start gap-3">
                  <Badge variant={actionBadgeVariant(r.action)}>
                    {auditActionLabel(r.action)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {auditContextSummary(r.action, r.context)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.actor_email}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-muted-foreground">
                  {new Date(r.created_at).toLocaleString('en-SG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
