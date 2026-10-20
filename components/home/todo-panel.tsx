import Link from 'next/link';
import { Check, ChevronRight, ListChecks } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HomeTodoItem } from '@/lib/home/todos';
import { TodoCrActions } from './todo-cr-actions.client';

function isUrgent(item: HomeTodoItem): boolean {
  return item.aging?.tone === 'warning' || item.aging?.tone === 'destructive';
}

function railClass(item: HomeTodoItem): string {
  if (item.aging?.tone === 'destructive') return 'bg-destructive';
  if (item.aging?.tone === 'warning') return 'bg-brand-amber';
  if (item.aging?.tone === 'success') return 'bg-brand-mint';
  return 'bg-brand-indigo/25';
}

// aging.label is always "N day(s)" (see lib/home/todos.ts::agingFor) — pull
// the number back out so it can be rendered as its own numeral instead of
// buried in a badge string.
function dayCount(label: string): { value: number; unit: string } {
  const value = parseInt(label, 10) || 0;
  return { value, unit: value === 1 ? 'day old' : 'days old' };
}

/**
 * The row's leading numeral. A counted row leads with how many are waiting; a
 * change request is ONE item, so its numeral is its age instead, captioned so
 * the two are never read as the same kind of number.
 */
function LeadNumeral({ item }: { item: HomeTodoItem }) {
  if (item.count !== undefined) {
    return (
      <div className="text-right font-serif text-[28px] leading-none font-bold text-foreground tabular-nums">
        {item.count.toLocaleString('en-SG')}
      </div>
    );
  }
  if (item.aging) {
    const { value, unit } = dayCount(item.aging.label);
    return (
      <div className="text-right leading-none">
        <div
          className={cn(
            'font-serif text-xl font-bold tabular-nums',
            item.aging.tone === 'destructive'
              ? 'text-destructive'
              : 'text-foreground'
          )}
        >
          {value}
        </div>
        <div className="mt-1 font-mono text-[8.5px] font-semibold tracking-wide text-muted-foreground uppercase">
          {unit}
        </div>
      </div>
    );
  }
  return <div aria-hidden />;
}

function TodoRow({ item }: { item: HomeTodoItem }) {
  return (
    <div className="relative flex items-center gap-4 border-b border-border py-3.5 pr-5 pl-4 last:border-b-0">
      <span
        className={cn('absolute top-0 left-0 h-full w-[3px]', railClass(item))}
        aria-hidden
      />
      {/* A floor, not a fixed track: short counts still line up on the right,
          and a four-digit one widens the slot instead of running into the
          text (a 56px grid column did). */}
      <div className="min-w-14 shrink-0">
        <LeadNumeral item={item} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm leading-snug font-semibold text-foreground">
          {item.text}
        </span>
        <span className="truncate text-[12.5px] text-muted-foreground">
          {item.module}
          {item.requestedBy ? ` · ${item.requestedBy}` : ''}
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        {item.kind === 'change-request' && item.requestId ? (
          <TodoCrActions
            requestId={item.requestId}
            approvalRequestId={item.approvalRequestId ?? null}
          />
        ) : (
          <Link
            href={item.href}
            className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-brand-indigo hover:underline"
          >
            Review
            <ChevronRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Rows render in the order given — the home page sorts them with
 * `sortTodosByCount` (largest count first) before passing them in.
 */
export function TodoPanel({
  title,
  items,
}: {
  title: string;
  items: HomeTodoItem[];
}) {
  const urgent = items.filter(isUrgent);

  return (
    // No flex ratio here — the home page's grid owns the column split.
    <Card className="gap-0 overflow-hidden p-0">
      {/* ⚠ THE THREE HOME PANELS SHARE ONE HEADER TREATMENT — size-9 tile,
          serif 18px, px-5 py-4. Keep them identical, or nothing lines up
          across the row. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListChecks className="size-[17px]" aria-hidden />
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
            {title}
          </span>
        </div>
        {items.length === 0 ? (
          <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
            All caught up
          </Badge>
        ) : urgent.length > 0 ? (
          <Badge className="h-6 border-brand-amber/40 bg-brand-amber/10 text-ink">
            {urgent.length} need{urgent.length === 1 ? 's' : ''} attention
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-6">
            {items.length} to review
          </Badge>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Check className="size-[18px]" />
          </div>
          <div className="space-y-1">
            <p className="font-serif text-[15px] font-semibold text-foreground">
              Nothing needs you right now
            </p>
            <p className="text-xs text-muted-foreground">
              New approvals and reviews will show up here as they come in.
            </p>
          </div>
        </div>
      ) : (
        items.map((item) => <TodoRow key={item.id} item={item} />)
      )}
    </Card>
  );
}
