'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type PageTab = {
  href: string;
  label: string;
  count?: number | string;
};

/**
 * The in-page switcher for a page whose views are their own routes.
 *
 * Kept alongside the sidebar's child rows rather than replaced by them: the
 * sidebar says where you can go, this says where you are within the page you
 * are already on. Removing it would leave a page whose sub-views are only
 * discoverable by looking away from it.
 *
 * Markup matches `09a-design-patterns.md` §8 "Tabs with URL-driven navigation"
 * — segmented `TabsList`, each trigger `asChild` around a real `Link`, so every
 * view is linkable and the back button works.
 */
export function PageTabNav({ tabs }: { tabs: PageTab[] }) {
  const pathname = usePathname() ?? '';

  // Longest match wins, so `/sis/admin/staff/accounts` selects Accounts rather
  // than its parent. Falls back to the first tab, which is always the parent
  // route's own view.
  //
  // Matched on the path only. A tab may carry a query string to preserve state
  // across the switch (Subject Setup keeps `?ay=` when changing level), and
  // that must not stop it matching the route it points at.
  const active =
    tabs
      .filter((t) => {
        const path = t.href.split('?')[0];
        return pathname === path || pathname.startsWith(path + '/');
      })
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? tabs[0]?.href;

  return (
    <Tabs value={active} className="w-full">
      <TabsList variant="segmented">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.href} value={tab.href} asChild>
            <Link href={tab.href} className="inline-flex items-center gap-1.5">
              {tab.label}
              {tab.count != null && (
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {tab.count}
                </span>
              )}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
