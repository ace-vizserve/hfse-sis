import Link from 'next/link';
import { ArrowRightIcon, ListChecks } from 'lucide-react';

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
import type { InsightSeverity } from '@/lib/dashboard/insights';

/**
 * ActionList — follow-up table conforming to `09a §8` card pattern
 * (gradient icon tile, serif title, divided list rows). Used for
 * stalled applicants, recent withdrawals, docs to collect.
 */

export type ActionItem = {
  label: string;
  sublabel?: string;
  meta?: string;
  // Unit label rendered right after `meta` (e.g. "cells", "comments", "sheets")
  // so the list number is self-labeled in its own unit — important when the
  // drill it opens counts in a different unit (students).
  metaLabel?: string;
  severity?: InsightSeverity;
  href?: string;
  // When set (and no `href`), the row renders as an accessible <button> that
  // fires this on click. `href` takes precedence when both are provided.
  onClick?: () => void;
};

const DOT_BY_SEVERITY: Record<InsightSeverity, string> = {
  good: 'bg-brand-mint',
  warn: 'bg-brand-amber',
  bad: 'bg-destructive',
  info: 'bg-brand-indigo',
};

export function ActionList({
  id,
  title,
  description,
  items,
  emptyLabel,
  viewAllHref,
}: {
  id?: string;
  title: string;
  description?: string;
  items: ActionItem[];
  emptyLabel: string;
  viewAllHref?: string;
}) {
  return (
    <Card id={id} className="@container/card h-full">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Action list
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        {description && (
          <p className="pt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListChecks className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {items.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-foreground">{emptyLabel}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {items.map((item, i) => (
              <ActionRow key={`${i}-${item.label}`} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
      {viewAllHref && items.length > 0 && (
        <CardFooter className="flex items-center justify-end border-t border-border px-6 py-3 text-xs">
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-indigo-deep"
          >
            View all
            <ArrowRightIcon className="size-3" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

function ActionRow({ item }: { item: ActionItem }) {
  const dot = DOT_BY_SEVERITY[item.severity ?? 'info'];
  const interactive = Boolean(item.href || item.onClick);
  const inner = (
    <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40">
      <span className={cn('size-2.5 shrink-0 rounded-full', dot)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {item.label}
        </div>
        {item.sublabel && (
          <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {item.sublabel}
          </div>
        )}
      </div>
      {item.meta && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {item.meta}
          {item.metaLabel && (
            <span className="ml-1 not-italic">{item.metaLabel}</span>
          )}
        </span>
      )}
      {interactive && (
        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      )}
    </div>
  );
  if (item.href) {
    return (
      <li>
        <Link href={item.href} className="block">
          {inner}
        </Link>
      </li>
    );
  }
  if (item.onClick) {
    return (
      <li>
        <button
          type="button"
          onClick={item.onClick}
          aria-label={`${item.label} — show details`}
          className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {inner}
        </button>
      </li>
    );
  }
  return <li>{inner}</li>;
}
