import Link from 'next/link';
import { ArrowRightIcon, CheckCircle2 } from 'lucide-react';

import { Card } from '@/components/ui/card';
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
 * 1). Replaces the standalone `HubClassAssignmentCallout` — its signal is
 * now one row in this merged feed alongside pending change requests and
 * un-offered level demand. Rows are built by the pure
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
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="font-serif text-[15.5px] font-semibold text-foreground">
          Needs attention
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {rows.length === 0
            ? 'All clear'
            : `${rows.length} item${rows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-6">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-mint/25 text-ink">
            <CheckCircle2 className="size-4" />
          </div>
          <p className="text-[13px] text-foreground">
            All clear — nothing needs attention.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visibleRows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 px-4 py-3 text-[13px]"
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  row.severity === 'destructive'
                    ? 'bg-destructive'
                    : 'bg-brand-amber'
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {row.text}
              </span>
              {row.meta && (
                <span className="hidden shrink-0 font-mono text-[10.5px] text-muted-foreground sm:inline">
                  {row.meta}
                </span>
              )}
              <Link
                href={row.href}
                className="group/action inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand-indigo hover:underline"
              >
                {row.actionLabel}
                <ArrowRightIcon className="size-3 transition-transform group-hover/action:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="border-t border-border px-4 py-2.5 text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          +{hiddenCount} more, lower priority
        </p>
      )}
    </Card>
  );
}
