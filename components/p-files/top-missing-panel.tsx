import { AlertCircle, FileX } from 'lucide-react';

import type { DocumentBacklogRow } from '@/lib/sis/dashboard';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function TopMissingPanel({
  data,
  limit = 6,
}: {
  data: DocumentBacklogRow[];
  limit?: number;
}) {
  // Rank by missing + rejected desc. Pending is a softer problem; show
  // separately per row but don't let it dominate the sort.
  const ranked = [...data]
    .map((r) => ({ ...r, gap: r.missing + r.rejected }))
    .filter((r) => r.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit);

  const empty = ranked.length === 0;
  const totalGap = ranked.reduce((sum, r) => sum + r.gap, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Collection · Priority
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Top missing documents
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileX className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {empty ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center">
            <FileX className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">All documents on file</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Nothing is missing or rejected right now.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {ranked.map((r) => (
              <li key={r.slotKey} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {r.missing > 0 && `${r.missing} missing`}
                    {r.missing > 0 && r.rejected > 0 && ' · '}
                    {r.rejected > 0 && `${r.rejected} rejected`}
                    {r.pending > 0 && ` · ${r.pending} pending`}
                  </p>
                </div>
                <Badge
                  className="h-6 border-destructive/40 bg-destructive/10 text-destructive tabular-nums"
                  variant="outline"
                >
                  {r.gap}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {!empty && (
        <CardFooter className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <AlertCircle className="size-3 text-destructive" />
          <span>
            <span className="font-semibold tabular-nums text-foreground">{totalGap}</span> slots
            across {ranked.length} document{ranked.length === 1 ? '' : ' types'} need action
          </span>
        </CardFooter>
      )}
    </Card>
  );
}
