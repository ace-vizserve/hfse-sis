import Link from 'next/link';
import { Check, AlertTriangle, Circle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HomeTodoItem } from '@/lib/home/todos';
import { TodoCrActions } from './todo-cr-actions.client';

function initials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const chars =
    parts.length >= 2 ? [parts[0][0], parts[1][0]] : [local[0], local[1] ?? ''];
  return chars.join('').toUpperCase();
}

export function TodoPanel({
  title,
  items,
}: {
  title: string;
  items: HomeTodoItem[];
}) {
  return (
    <Card className="flex-[2] overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <span className="font-serif text-base font-bold text-foreground">
          {title}
        </span>
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[10px] font-semibold text-muted-foreground">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-4 text-xs text-muted-foreground">
          Nothing needs your attention right now.
        </div>
      ) : (
        <ol className="relative py-5 pr-5 pl-14">
          <div
            className="absolute top-[30px] bottom-[30px] left-[27px] w-px bg-border"
            aria-hidden
          />
          {items.map((item) => {
            const dotWarn =
              item.aging?.tone === 'warning' ||
              item.aging?.tone === 'destructive';
            const DotIcon = item.aging
              ? dotWarn
                ? AlertTriangle
                : Check
              : Circle;
            return (
              <li key={item.id} className="relative pb-7 last:pb-0">
                <span
                  className={cn(
                    'absolute top-0 -left-[42px] z-1 flex size-7 items-center justify-center rounded-full text-white shadow-sm',
                    dotWarn
                      ? 'bg-gradient-to-br from-brand-amber to-brand-amber/80'
                      : 'bg-gradient-to-br from-brand-indigo to-brand-navy'
                  )}
                  aria-hidden
                >
                  <DotIcon className={item.aging ? 'size-3.5' : 'size-2'} />
                </span>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="font-mono text-[10px] font-bold tracking-wide text-brand-indigo uppercase">
                    {item.module}
                  </span>
                  {item.aging ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      requested {item.aging.label} ago
                    </span>
                  ) : null}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {item.text}
                </div>
                {item.kind === 'change-request' && item.requestId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-muted px-3 py-2.5">
                    {item.requestedBy ? (
                      <>
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hairline text-[10px] font-bold text-foreground">
                          {initials(item.requestedBy)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          requested by {item.requestedBy}
                        </span>
                      </>
                    ) : null}
                    {item.aging ? (
                      <Badge
                        variant={
                          item.aging.tone === 'destructive'
                            ? 'blocked'
                            : item.aging.tone
                        }
                        className="ml-auto"
                      >
                        {item.aging.label}
                      </Badge>
                    ) : null}
                    <TodoCrActions requestId={item.requestId} />
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className="mt-1 inline-block text-xs font-semibold text-brand-indigo hover:underline"
                  >
                    Review &rsaquo;
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
