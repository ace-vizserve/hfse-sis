'use client';

import { ArrowDownAZ, History, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CustomerNavItem } from '@/lib/billing/customer-nav.server';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// QuickBooks' customer-page left panel: "Search by name or details", Recent
// or Name order, each customer with their open balance; the open one is
// highlighted. Recent is this browser's own list (a per-viewer convenience).

const KEY = 'billing:recent-customers';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function CustomerNavPanel({
  customers,
  current,
}: {
  customers: CustomerNavItem[];
  current: string;
}) {
  const [q, setQ] = React.useState('');
  const [order, setOrder] = React.useState<'recent' | 'name'>('recent');
  const [recent, setRecent] = React.useState<string[]>([]);

  // Remember this customer as recently viewed.
  React.useEffect(() => {
    const next = [current, ...readRecent().filter((s) => s !== current)].slice(
      0,
      30
    );
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked — Recent just shows this customer */
    }
    setRecent(next);
  }, [current]);

  const byNumber = React.useMemo(
    () => new Map(customers.map((c) => [c.studentNumber, c])),
    [customers]
  );
  const term = q.trim().toLowerCase();
  const list = React.useMemo(() => {
    if (term)
      return customers.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.studentNumber.toLowerCase().includes(term)
      );
    if (order === 'recent')
      return recent
        .map((sn) => byNumber.get(sn))
        .filter((c): c is CustomerNavItem => !!c);
    return customers;
  }, [customers, term, order, recent, byNumber]);

  return (
    <aside
      aria-label="Customers"
      className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card"
    >
      <div className="space-y-2 border-b border-border p-3">
        <label
          htmlFor="cust-nav-q"
          className="text-[12px] text-muted-foreground"
        >
          Search by name or details
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="cust-nav-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex items-center gap-1 text-[13px]">
          {(
            [
              ['recent', 'Recent', History],
              ['name', 'Name', ArrowDownAZ],
            ] as const
          ).map(([v, label, Icon]) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              onClick={() => setOrder(v)}
              aria-pressed={order === v}
              className={cn(
                'h-7 gap-1 px-2 font-normal text-muted-foreground',
                order === v && !term && 'bg-muted text-foreground'
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>
      {!term && order === 'recent' && (
        <p className="px-3 pt-3 text-center text-[12px] text-muted-foreground">
          Recently viewed customers
        </p>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-0.5 p-2">
          {list.length === 0 && (
            <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">
              No customer matches.
            </li>
          )}
          {list.map((c) => {
            const on = c.studentNumber === current;
            return (
              <li key={c.studentNumber}>
                <Link
                  href={`/billing/${encodeURIComponent(c.studentNumber)}`}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-3 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                    on && 'bg-accent hover:bg-accent'
                  )}
                >
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {c.name}
                  </span>
                  <span className="block text-[13px] tabular-nums text-muted-foreground">
                    {formatSgd(c.openBalance)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </aside>
  );
}
