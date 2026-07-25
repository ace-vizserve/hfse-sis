import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HomeTodoItem } from '@/lib/home/todos';
import { TodoCrActions } from './todo-cr-actions.client';

export function TodoPanel({
  title,
  items,
}: {
  title: string;
  items: HomeTodoItem[];
}) {
  return (
    <Card className="flex-[2] overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-serif text-base font-bold text-foreground">
          {title}
        </span>
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-4 text-xs text-muted-foreground">
          Nothing needs your attention right now.
        </div>
      ) : (
        <ol className="relative px-5 py-4 pl-9">
          <div
            className="absolute top-2 bottom-2 left-[2.05rem] w-px bg-border"
            aria-hidden
          />
          {items.map((item) => {
            const dotWarn =
              item.aging?.tone === 'warning' ||
              item.aging?.tone === 'destructive';
            return (
              <li key={item.id} className="relative pb-5 last:pb-0">
                <span
                  className={cn(
                    'absolute top-1 -left-[1.15rem] size-2.5 rounded-full border-2 bg-card',
                    dotWarn ? 'border-brand-amber' : 'border-brand-indigo'
                  )}
                  aria-hidden
                />
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
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
                    {item.requestedBy ? (
                      <span className="text-xs text-muted-foreground">
                        requested by {item.requestedBy}
                      </span>
                    ) : null}
                    {item.aging ? (
                      <Badge
                        variant={
                          item.aging.tone === 'destructive'
                            ? 'blocked'
                            : item.aging.tone
                        }
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
