import Link from 'next/link';
import { ArrowRightIcon, CheckCircle2 } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AttentionRow } from '@/lib/sis/hub-attention';

/**
 * HubAttentionFeed — the SIS Admin hub's "Needs attention" panel (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Replaces the standalone `HubClassAssignmentCallout` — its signal is
 * now one row in this merged feed alongside pending change requests and
 * un-offered level demand. Rows are built by the pure
 * `lib/sis/hub-attention.ts::buildAttentionRows` so the component stays
 * presentational. Severity dots are always paired with text — color is
 * never the only signal.
 */
export function HubAttentionFeed({ rows }: { rows: AttentionRow[] }) {
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
          {rows.map((row) => (
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
    </Card>
  );
}
