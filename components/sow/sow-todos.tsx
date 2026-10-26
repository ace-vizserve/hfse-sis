import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { TodoRow } from '@/lib/sow/home';

// "To do" beside the week's lessons (board 15). The dot carries the urgency
// (09a §9.3): destructive for what the teacher must fix or answer, amber for
// what is due, muted for what can wait. Nothing renders without a to-do — an
// empty card would explain an absence of news.

const DOT: Record<TodoRow['tone'], string> = {
  locked: 'bg-destructive',
  warning: 'bg-brand-amber',
  muted: 'bg-muted-foreground/50',
};

export function SowTodos({
  todos,
  className,
}: {
  todos: TodoRow[];
  className?: string;
}) {
  if (todos.length === 0) return null;
  return (
    <section
      aria-labelledby="sow-todo-heading"
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-hairline bg-card p-4',
        className
      )}
    >
      <h2
        id="sow-todo-heading"
        className="pb-1.5 font-serif text-base font-semibold text-foreground"
      >
        To do
      </h2>
      <ul>
        {todos.map((t) => (
          <li key={t.id} className="border-t border-hairline first:border-t-0">
            <Link
              href={t.href}
              className="flex items-baseline gap-2.5 py-2 text-sm text-foreground hover:text-brand-indigo-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', DOT[t.tone])}
              />
              <span>{t.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
