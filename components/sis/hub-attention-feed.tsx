import Link from 'next/link';
import { AlertTriangle, ArrowRightIcon, CheckCircle2 } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AttentionRow } from '@/lib/sis/hub-attention';

// Max rows rendered before truncating — Miller's Law (7±2). `buildAttentionRows`
// already severity-sorts (destructive first) and collapses same-cause signals
// into one row each, so the rows that get cut are the least urgent ones. The
// header count and the "+N more" line both use the TRUE total, never the
// capped length — nothing is hidden without a trace.
const MAX_VISIBLE_ROWS = 6;

/**
 * HubAttentionFeed — the SIS Admin hub's "Needs attention" panel (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Rebuilt onto the same real Card/CardHeader/CardAction shape as
 * `components/dashboard/action-list.tsx` — the app's actual "list of
 * actionable rows" card (gradient icon tile, mono eyebrow, serif title,
 * divided rows with a hover state) — after a review found this panel was a
 * hand-rolled flat header + bare `<ul>` with no icon tile at all, unlike
 * every real list-card elsewhere in the app. Rows are built by the pure
 * `lib/sis/hub-attention.ts::buildAttentionRows` so the component stays
 * presentational. Severity dots are always paired with text — color is
 * never the only signal. Capped at MAX_VISIBLE_ROWS (layout redesign pass,
 * Miller's Law) — no "view all" link because no dedicated cross-module
 * attention page exists; the "+N more" line is honest, not a fake
 * affordance to nowhere.
 */
export function HubAttentionFeed({ rows }: { rows: AttentionRow[] }) {
  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {rows.length === 0
            ? 'All clear'
            : `${rows.length} item${rows.length === 1 ? '' : 's'}`}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Needs attention
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
            <AlertTriangle className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {rows.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <CheckCircle2 className="size-5 text-brand-mint" />
            <p className="text-sm font-medium text-foreground">
              All clear — nothing needs attention.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {visibleRows.map((row) => (
              <li key={row.id}>
                <Link
                  href={row.href}
                  className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40"
                >
                  <span
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      row.severity === 'destructive'
                        ? 'bg-destructive'
                        : 'bg-brand-amber'
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {row.text}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {row.actionLabel}
                    </div>
                  </div>
                  {row.meta && (
                    <span className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:inline">
                      {row.meta}
                    </span>
                  )}
                  <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {hiddenCount > 0 && (
        <CardFooter className="justify-center border-t border-border py-3 text-xs">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            +{hiddenCount} more, lower priority
          </span>
        </CardFooter>
      )}
    </Card>
  );
}
