import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RecentAction } from '@/lib/home/recent-actions';

export function RecentActionsPanel({ actions }: { actions: RecentAction[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-foreground">
          Recent actions
        </span>
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">
          {actions.length} {actions.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {actions.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Nothing you&apos;ve done shows up here yet.
        </div>
      ) : (
        actions.map((action) => (
          <div
            key={action.id}
            className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
          >
            <Badge variant={action.tone}>{action.label}</Badge>
            <span className="flex-1 truncate text-sm text-foreground">
              {action.summary}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {action.timeAgo}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}
