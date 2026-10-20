import Link from 'next/link';
import { Activity, ChevronRight, History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { RecentAction } from '@/lib/home/recent-actions';

// Same tone the humanizer's bucket drives on the per-module audit-log tables,
// as a small dot ahead of the label.
function dotClass(tone: RecentAction['tone']): string {
  if (tone === 'destructive') return 'bg-destructive';
  if (tone === 'warning') return 'bg-brand-amber';
  return 'bg-brand-indigo';
}

export function RecentActionsPanel({
  actions,
  auditLogHref,
}: {
  actions: RecentAction[];
  /** Set only when the viewer may open the audit log; no link otherwise. */
  auditLogHref?: string;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      {/* Header treatment matched to `todo-panel.tsx` — see the note there. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Activity className="size-[17px]" aria-hidden />
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Recent actions
          </span>
        </div>
        {actions.length > 0 ? (
          <Badge variant="secondary" className="h-6">
            Your last {actions.length}
          </Badge>
        ) : null}
      </div>
      {actions.length === 0 ? (
        // §7.6 — matched to `todo-panel.tsx`'s empty state.
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <History className="size-[18px]" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-serif text-[15px] font-semibold text-foreground">
              No activity yet
            </p>
            <p className="text-xs text-muted-foreground">
              Marks, attendance and approvals you record will appear here as you
              go.
            </p>
          </div>
        </div>
      ) : (
        <ol>
          {actions.map((action) => (
            <li
              key={action.id}
              className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-border px-5 py-3 last:border-b-0 max-sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="max-sm:col-span-2">
                {action.module ? (
                  <span className="inline-flex rounded-md bg-accent px-1.5 py-1 font-mono text-[9.5px] leading-none font-semibold tracking-[0.1em] text-brand-indigo-deep uppercase">
                    {action.module}
                  </span>
                ) : null}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      dotClass(action.tone)
                    )}
                    aria-hidden
                  />
                  {action.label}
                </div>
                <div className="mt-0.5 truncate pl-3.5 text-xs text-muted-foreground">
                  {action.summary}
                </div>
              </div>
              <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
                {action.timeAgo}
              </span>
            </li>
          ))}
        </ol>
      )}
      {auditLogHref && actions.length > 0 ? (
        <div className="flex justify-end border-t border-border px-5 py-2.5">
          <Link
            href={auditLogHref}
            className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-brand-indigo hover:underline"
          >
            See all in the audit log
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
