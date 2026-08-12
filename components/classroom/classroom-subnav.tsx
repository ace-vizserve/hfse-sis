'use client';

// Classroom hub sub-navigation — the tab strip (Overview / Grades / Students
// / Attendance / Write-ups) plus the term selector. Both rows preserve each
// other: switching a tab keeps the selected term in the URL, and switching
// term keeps whichever tab you're on (the term Link's href is built from the
// CURRENT pathname, which already is that sub-route).
//
// This lives in the layout, which — unlike a page — never receives
// `searchParams`, so reading `?term_id=` here has to go through the
// client-side `useSearchParams()` hook rather than an awaited prop. Every
// page under this layout re-derives the identical `selectedTermId` from its
// own `searchParams` + `terms` using the same pure `resolveSelectedTermId`,
// so the tab this component highlights always matches what the page actually
// rendered for that URL.
//
// Which tabs even appear is capability-gated by `tabsForCapability` — a
// subject-teacher-only viewer never sees Attendance / Write-ups triggers
// here. That is a UX nicety, not the security boundary: each of those two
// pages re-checks the capability itself (see the "Authorization" note in the
// Phase 4 brief) because their data reads go through the service client,
// which bypasses RLS.

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ClassroomCapability } from '@/lib/classroom/scope';
import {
  classroomTabHref,
  tabsForCapability,
  type ClassroomTabKey,
} from '@/lib/classroom/tabs';
import {
  resolveSelectedTermId,
  type ClassroomTerm,
} from '@/lib/classroom/terms';

function activeTabFromPathname(
  pathname: string,
  sectionId: string
): ClassroomTabKey {
  const prefix = `/classroom/${sectionId}`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  const segment = rest.replace(/^\//, '').split('/')[0];
  if (
    segment === 'grades' ||
    segment === 'students' ||
    segment === 'attendance' ||
    segment === 'write-ups' ||
    segment === 'timeline' ||
    segment === 'settings'
  ) {
    return segment;
  }
  return 'overview';
}

export function ClassroomSubnav({
  sectionId,
  capability,
  substantiveCapability,
  terms,
}: {
  sectionId: string;
  /** What the viewer may DO here — cover included. */
  capability: ClassroomCapability | null;
  /**
   * What the viewer IS here — cover excluded. The Write-ups tab turns on this
   * rather than `capability`, because a substitute covering the class does not
   * write the adviser's write-ups and the page behind that tab 404s for them.
   */
  substantiveCapability: ClassroomCapability | null;
  terms: ClassroomTerm[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedTermId = resolveSelectedTermId(
    terms,
    searchParams.get('term_id') ?? undefined
  );
  const tabs = tabsForCapability(capability, substantiveCapability);
  const activeTabKey = activeTabFromPathname(pathname, sectionId);

  return (
    <div className="flex flex-col gap-4 border-b border-border pb-4">
      <Tabs value={activeTabKey} aria-label="Classroom section">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} asChild>
              <Link href={classroomTabHref(sectionId, tab, selectedTermId)}>
                {tab.label}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Term selector — hidden when there is nothing to switch between,
          same threshold app/(attendance)/attendance/[sectionId]/page.tsx uses. */}
      {terms.length > 1 && (
        <Tabs value={selectedTermId ?? undefined} aria-label="Term">
          <TabsList variant="segmented">
            {terms.map((t) => (
              <TabsTrigger key={t.id} value={t.id} asChild>
                <Link href={`${pathname}?term_id=${t.id}`}>
                  {t.label}
                  {t.is_current && (
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-wider opacity-70">
                      current
                    </span>
                  )}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
    </div>
  );
}
