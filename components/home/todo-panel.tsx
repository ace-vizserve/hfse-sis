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
// the number back out so it can be rendered as its own headline numeral
// instead of buried in a badge string.
function dayCount(label: string): { value: number; unit: string } {
  const value = parseInt(label, 10) || 0;
  return { value, unit: value === 1 ? 'day old' : 'days old' };
}

function GroupLabel({
  tone,
  children,
}: {
  tone: 'destructive' | 'mint';
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3.5 pb-1.5">
      <span
        className={cn(
          'size-1.5 rounded-full',
          tone === 'destructive' ? 'bg-destructive' : 'bg-brand-mint'
        )}
        aria-hidden
      />
      <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {children}
      </span>
    </div>
  );
}

function TodoRow({ item }: { item: HomeTodoItem }) {
  return (
    <div className="relative flex items-stretch gap-3.5 border-b border-border py-3 pr-4 pl-5 last:border-b-0">
      <span
        className={cn('absolute top-0 left-0 h-full w-[3px]', railClass(item))}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="truncate font-mono text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
          {item.module}
          {item.requestedBy ? ` · ${item.requestedBy}` : ''}
        </span>
        <span className="font-serif text-[15px] leading-tight font-semibold text-foreground">
          {item.text}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center gap-2">
        {item.kind === 'change-request' && item.requestId ? (
          <>
            {item.aging ? (
              <div className="text-right leading-none">
                <div
                  className={cn(
                    'font-serif text-xl font-bold tabular-nums',
                    item.aging.tone === 'destructive'
                      ? 'text-destructive'
                      : 'text-foreground'
                  )}
                >
                  {dayCount(item.aging.label).value}
                </div>
                <div className="mt-0.5 font-mono text-[8.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {dayCount(item.aging.label).unit}
                </div>
              </div>
            ) : null}
            <TodoCrActions requestId={item.requestId} />
          </>
        ) : (
          <Link
            href={item.href}
            className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-indigo hover:underline"
          >
            Review
            <ChevronRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

export function TodoPanel({
  title,
  items,
}: {
  title: string;
  items: HomeTodoItem[];
}) {
  const urgent = items.filter(isUrgent);
  const calm = items.filter((item) => !isUrgent(item));
  const showGroups = urgent.length > 0 && calm.length > 0;

  return (
    <Card className="flex-[2] overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <ListChecks className="size-[17px] text-brand-indigo" aria-hidden />
          <span className="font-serif text-base font-semibold text-foreground">
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
      ) : showGroups ? (
        <>
          <GroupLabel tone="destructive">Needs a decision</GroupLabel>
          {urgent.map((item) => (
            <TodoRow key={item.id} item={item} />
          ))}
          <GroupLabel tone="mint">In good standing</GroupLabel>
          {calm.map((item) => (
            <TodoRow key={item.id} item={item} />
          ))}
        </>
      ) : (
        items.map((item) => <TodoRow key={item.id} item={item} />)
      )}
    </Card>
  );
}
