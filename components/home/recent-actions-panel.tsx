import { Activity } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { RecentAction } from '@/lib/home/recent-actions';

// Same tone → dot-color mapping the humanizer's tone bucket already drives
// on the per-module audit-log tables (via Badge variant there) — expressed
// here as a filled timeline dot instead of a chip, to match the reference
// timeline layout.
function dotClass(tone: RecentAction['tone']): string {
  if (tone === 'destructive') return 'from-destructive to-destructive/80';
  if (tone === 'warning') return 'from-brand-amber to-brand-amber/80';
  return 'from-brand-indigo to-brand-navy';
}

export function RecentActionsPanel({ actions }: { actions: RecentAction[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
        <div className="flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Activity className="size-[15px]" aria-hidden />
        </div>
        <span className="font-serif text-base font-bold text-foreground">
          Recent actions
        </span>
      </div>
      {actions.length === 0 ? (
        <div className="px-5 py-4 text-xs text-muted-foreground">
          Nothing you&apos;ve done shows up here yet.
        </div>
      ) : (
        <ol className="relative py-5 pr-5 pl-14">
          <div
            className="absolute top-[30px] bottom-[30px] left-[27px] w-px bg-border"
            aria-hidden
          />
          {actions.map((action) => (
            <li key={action.id} className="relative pb-7 last:pb-0">
              <span
                className={cn(
                  'absolute top-0 -left-[42px] z-1 flex size-7 items-center justify-center rounded-full bg-gradient-to-br shadow-sm',
                  dotClass(action.tone)
                )}
                aria-hidden
              >
                <span className="size-2 rounded-full bg-white" />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {action.label}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {action.summary}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {action.timeAgo}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
