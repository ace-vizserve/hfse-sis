'use client';

import Link from 'next/link';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type ParentPortalTab = 'applications' | 'accounts';

const TABS: { value: ParentPortalTab; label: string }[] = [
  { value: 'applications', label: 'Applications' },
  { value: 'accounts', label: 'Parent accounts' },
];

// 09a §8 "Tabs with URL-driven navigation": each tab is a real link, so a refresh
// or a shared link keeps it. `PageTabNav` is the same markup, but it matches tabs
// by path and these two share one.
export function ParentPortalTabs({ active }: { active: ParentPortalTab }) {
  return (
    <Tabs value={active} className="w-full">
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} asChild>
            <Link href={`/sis/admin/parent-portal?tab=${tab.value}`}>
              {tab.label}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
