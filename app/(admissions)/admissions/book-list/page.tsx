import { BookOpen, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { CopyBookListButton } from '@/components/admissions/book-list-copy-button';
import { BookListLevelSelect } from '@/components/admissions/book-list-level-select';
import { BookListTable } from '@/components/admissions/book-list-table';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { canWriteStudentRecord } from '@/lib/auth/student-record';
import { getLevelRows } from '@/lib/sis/levels';
import { loadLevelSupplies } from '@/lib/sis/supplies/level-counts';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /admissions/book-list — the year's books and supplies, one level at a time,
// and for each item how many of the level's students have been given it
// (plan 2026-10-28-books-supplies-tracker.md, Phases 3 and 4). Ticks are made
// on each student's Supplies stage. The counting is
// lib/sis/supplies/level-counts.ts; the list is the shared DataTable
// (components/admissions/book-list-table.tsx).
//
// Each year's list is edited here (Phase 4): student-record writers get Add
// book / Add supply, Edit and Remove on each row, and on an empty year "Copy
// from <AY>" for every other year with a list. The importer stays as an
// optional first load. Read-only viewers see none of those controls.
//
// `?ay=` (the Admissions switcher, defaulting to the newest year with a list
// loaded, else the current year), `?level=<code>` (always set — no "all levels" scroll) and
// `?type=Global|Standard` for a level whose books are split by track.
//
// Audience: the application page's — student-record writers, or anyone who
// may read pre-enrolment documents.

export default async function BookListPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string; type?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  // The application page's rule, in its shape (one `canOpen`): writers OR the
  // document-read capability.
  const canEdit = canWriteStudentRecord(sessionUser.role);
  const canOpen = canEdit || can(capabilities, 'documents_pre_enrolment.read');
  if (!canOpen) redirect('/');

  const service = createServiceClient();
  const [currentAy, ayCodes, levels, params] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
    getLevelRows(service),
    searchParams,
  ]);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }
  // No `?ay=` → the newest year that has a list loaded, else the current
  // year. Books are handed out for the coming year, so opening on the current
  // one would greet the office with an empty page (Mr Ace, 2026-10-28).
  const withList = await aysWithList(service, ayCodes);
  const selectedAy =
    params.ay && ayCodes.includes(params.ay)
      ? params.ay
      : (withList[0] ?? currentAy.ay_code);
  const level = levels.find((l) => l.code === params.level) ?? levels[0];
  const copySources = canEdit ? withList.filter((ay) => ay !== selectedAy) : [];

  const list = level
    ? await loadLevelSupplies(service, {
        ayCode: selectedAy,
        levelId: level.id,
        track: params.type ?? null,
      })
    : null;

  const classesLabel = list?.track
    ? `${level.label} ${list.track} classes`
    : `${level?.label} classes`;

  const hrefFor = (type: string) => {
    const next = new URLSearchParams({
      ay: selectedAy,
      level: level.code,
      type,
    });
    return `/admissions/book-list?${next.toString()}`;
  };

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · {selectedAy}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Book list
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            The books and supplies on {selectedAy}&apos;s list for each level,
            and how many of the level&apos;s students have been given each one.
            Items are ticked off on each student&apos;s Supplies stage.
            {canEdit && ' Add, change or remove items for this year here.'}
          </p>
        </div>
        <div className="w-full md:w-48">
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      {!list || !level ? (
        <Card className="items-center gap-3 px-6 py-12 text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-gradient-to-b from-accent/20 to-accent/5 text-accent-foreground ring-1 ring-inset ring-accent/30">
            <BookOpen className="size-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="font-serif text-base text-foreground">
              No book list has been loaded for {selectedAy} yet.
            </p>
            <p className="text-sm text-muted-foreground">
              {copySources.length
                ? `Copy another year's list to start ${selectedAy}'s, then change it level by level.`
                : "Once the year's list is loaded, its books and supplies appear here level by level."}
            </p>
          </div>
          {copySources.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {copySources.map((from) => (
                <CopyBookListButton
                  key={from}
                  fromAy={from}
                  toAy={selectedAy}
                />
              ))}
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <BookListLevelSelect
              current={level.code}
              options={levels.map((l) => ({ code: l.code, label: l.label }))}
            />
            {list.track && (
              <Tabs value={list.track} aria-label="Class type">
                <TabsList>
                  {list.tracks.map((t) => (
                    <TabsTrigger key={t} value={t} asChild>
                      <Link href={hrefFor(t)} scroll={false}>
                        {t}
                      </Link>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground sm:ml-auto">
              <Users className="size-4" aria-hidden />
              <span className="font-semibold tabular-nums text-foreground">
                {list.students.toLocaleString('en-SG')}
              </span>
              {list.students === 1 ? 'student' : 'students'} in {classesLabel}
            </p>
          </div>

          {list.students === 0 && list.groups.length > 0 && (
            <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft/40 bg-accent p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Users className="size-4" aria-hidden />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  No students in {classesLabel} for {selectedAy} yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  The Given column appears once students are placed in a class.
                </p>
              </div>
            </div>
          )}

          <BookListTable
            // A fresh table per level and track, so its sort and search
            // don't carry over to a different list.
            key={`${selectedAy}-${level.code}-${list.track ?? ''}`}
            groups={list.groups}
            ayCode={selectedAy}
            level={{
              id: level.id,
              label: level.label,
              levelType: level.levelType,
            }}
            subjects={list.subjects}
            track={list.track}
            canEdit={canEdit}
            showCounts={list.students > 0}
          />
        </>
      )}
    </PageShell>
  );
}

/**
 * The AYs (newest first, by code) with at least one active item on their
 * list — the default year is the first, and an empty year offers to copy from
 * each of them.
 */
async function aysWithList(
  service: ReturnType<typeof createServiceClient>,
  ayCodes: string[]
): Promise<string[]> {
  const { data: years } = await service
    .from('academic_years')
    .select('id, ay_code')
    .in('ay_code', ayCodes);
  const sorted = [...(years ?? [])].sort((a, b) =>
    b.ay_code.localeCompare(a.ay_code)
  );
  const counts = await Promise.all(
    sorted.map((y) =>
      service
        .from('supply_items')
        .select('id', { count: 'exact', head: true })
        .eq('academic_year_id', y.id)
        .eq('is_active', true)
    )
  );
  return sorted.filter((_, i) => counts[i].count).map((y) => y.ay_code);
}
