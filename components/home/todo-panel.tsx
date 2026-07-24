import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Nothing needs your attention right now.
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
          >
            <span className="w-[70px] shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.module}
            </span>
            <span className="flex-1 text-sm text-foreground">{item.text}</span>
            {item.aging ? (
              <Badge
                variant={item.aging.tone === 'success' ? 'success' : 'warning'}
              >
                {item.aging.label}
              </Badge>
            ) : null}
            {item.kind === 'change-request' && item.requestId ? (
              <TodoCrActions requestId={item.requestId} />
            ) : (
              <Link
                href={item.href}
                className="shrink-0 text-xs font-semibold text-brand-indigo hover:underline"
              >
                Review &rsaquo;
              </Link>
            )}
          </div>
        ))
      )}
    </Card>
  );
}
