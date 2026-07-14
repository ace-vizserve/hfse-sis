'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRightIcon, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

// Initial row count before "Load more" — Miller's Law (7±2).
// `buildAttentionRows` already severity-sorts (destructive first) and
// collapses same-cause signals into one row each, so the rows held back
// are the least urgent ones. The header count always uses the TRUE total,
// never the visible length — nothing is hidden without a trace, and
// clicking "Load more" reveals everything (no second page, no dead end).
const MAX_VISIBLE_ROWS = 6;
// Caps the row list at roughly MAX_VISIBLE_ROWS worth of height so a bad
// month (13+ rows once expanded) scrolls inside the card instead of
// pushing the whole hub layout taller than "Coming up" beside it.
const LIST_MAX_HEIGHT = 'max-h-96';

/**
 * HubAttentionFeed — the SIS Admin hub's "Needs attention" panel (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Rebuilt onto the same real Card/CardHeader/CardAction shape as
 * `components/dashboard/action-list.tsx` — the app's actual "list of
 * actionable rows" card (gradient icon tile, mono eyebrow, serif title,
 * divided rows with a hover state). Rows are built by the pure
 * `lib/sis/hub-attention.ts::buildAttentionRows` so severity-sorting stays
 * server-side; this component only owns the reveal/scroll interaction.
 * Severity dots are always paired with text — color is never the only
 * signal. Starts capped at MAX_VISIBLE_ROWS; "Load more" reveals the rest
 * inside a max-height scroll area rather than growing the card unbounded.
 */
export function HubAttentionFeed({ rows }: { rows: AttentionRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, MAX_VISIBLE_ROWS);
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
      <CardContent
        className={cn('space-y-0 p-0', rows.length === 0 && 'flex-1')}
      >
        {rows.length === 0 ? (
          // Same flex-1 + rich empty-state recipe as HubUpcomingEventsCard's
          // "Nothing scheduled" — grows to fill whatever height the grid
          // gives this card instead of leaving dead space below a
          // fixed-height box. Mint tile since "all clear" is a genuine
          // positive state, not a neutral absence (contrast the calendar
          // card's flat muted tile).
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="font-serif text-lg font-semibold text-foreground">
              All clear
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              Nothing needs attention right now — unassigned advisers, pending
              change requests, and level-demand gaps all show up here.
            </p>
          </div>
        ) : (
          <ul
            className={cn(
              'divide-y divide-border overflow-y-auto border-t border-border',
              showAll && LIST_MAX_HEIGHT
            )}
          >
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
        <CardFooter className="justify-center border-t border-border py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowAll(true)}
          >
            Load {hiddenCount} more
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
