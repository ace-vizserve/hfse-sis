import { AlertTriangle, CheckCircle2, UserCheck, Users2 } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { StaffDirectoryChrome } from '@/components/sis/staff-directory-chrome';
import { StaffTable } from '@/components/sis/staff-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Crossfade } from '@/components/ui/crossfade';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { getTeacherList } from '@/lib/auth/staff-list';
import { getSectionStaffingCoverage } from '@/lib/sis/dashboard';
import { loadStaffAssignments } from '@/lib/sis/staff';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Teaching assignments — the staff directory's default cut. Form-adviser and
// subject-teacher assignments for the current year.
//
// Session and role are guarded by the layout, which runs for this route and
// every route beneath it.
export default async function StaffAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ay?: string }>;
}) {
  // Accounts used to live here as `?view=accounts`. That URL was linkable and
  // may be bookmarked, so it keeps working.
  const params = await searchParams;
  if (params.view === 'accounts') redirect('/sis/admin/staff/accounts');

  const sessionUser = await getSessionUser();
  if (!sessionUser?.role) redirect('/sis');

  const supabase = await createClient();

  // Assignments are per academic year (a row reaches a year through its
  // section), so the page is too. `?ay=` is validated against the years that
  // actually exist before it is honoured — an unknown or absent value falls
  // back to the current year, which is what a bare /sis/admin/staff means.
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(),
    listAyCodes(supabase),
  ]);
  const currentAyCode = currentAy?.ay_code;
  if (!currentAyCode) redirect('/sis');

  const ayCode =
    params.ay && ayCodes.includes(params.ay) ? params.ay : currentAyCode;

  // A finished year is a record, not a worksheet. A year still ahead stays
  // editable — staffing next year before it starts is the normal way to do it.
  const viewOnly = ayCode < currentAyCode;

  // Everything above this line is a GATE: each one can still send the reader
  // somewhere else, so none of it may stream. Everything below it is the
  // ANSWER, and an answer is allowed to arrive second — the header, the
  // people/teaching badge and the two tabs (the LCP) paint from the values
  // already in hand while the staffing reads are still in flight.
  return (
    <StaffDirectoryChrome role={sessionUser.role} ayCode={ayCode}>
      <Suspense fallback={<StaffAssignmentsFallback viewOnly={viewOnly} />}>
        <Crossfade>
          <StaffAssignmentsBody
            ayCode={ayCode}
            currentAyCode={currentAyCode}
            ayCodes={ayCodes}
            viewOnly={viewOnly}
          />
        </Crossfade>
      </Suspense>
    </StaffDirectoryChrome>
  );
}

/**
 * The staffing reads and everything they render.
 *
 * ONE boundary, not two, and that is forced rather than chosen: `rows` from
 * `loadStaffAssignments` feeds BOTH the "Active teachers" figure in the stat
 * grid AND the table below it, so splitting the grid from the table would mean
 * calling that loader twice.
 *
 * The accepted cost is the `AySwitcher` and the "View only" badge. Both depend
 * only on gate values and could paint immediately, but they live in the
 * `CardAction` of the same card as the table, so they stream in with it. That
 * is the right trade: a year switcher with no table under it is not something
 * anyone can use.
 *
 * No Supabase client is passed in or created here — all three loaders are
 * `unstable_cache`-wrapped and build their own.
 */
async function StaffAssignmentsBody({
  ayCode,
  currentAyCode,
  ayCodes,
  viewOnly,
}: {
  ayCode: string;
  currentAyCode: string;
  ayCodes: string[];
  viewOnly: boolean;
}) {
  const [rows, coverage, teacherList] = await Promise.all([
    loadStaffAssignments(ayCode),
    getSectionStaffingCoverage(ayCode),
    getTeacherList(),
  ]);

  const totalTeachers = rows.filter((r) => !r.disabled).length;
  const withFca = coverage?.withAdviser ?? 0;
  const sectionsMissingFca = coverage
    ? coverage.total - coverage.withAdviser
    : 0;
  const teachingCount = teacherList.length;

  return (
    <>
      {/* "Sections missing FCA" leads — it is the one actionable metric of the
          three (Serial Position / Pareto). */}
      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs sm:grid-cols-3">
        <Card
          data-slot="card"
          className={
            sectionsMissingFca > 0
              ? 'border-brand-amber/30 bg-gradient-to-r from-brand-amber/10 to-card'
              : 'bg-gradient-to-t from-primary/5 to-card'
          }
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Sections missing FCA
            </CardDescription>
            <CardTitle
              className={`font-serif text-3xl tabular-nums ${sectionsMissingFca > 0 ? 'text-brand-amber' : 'text-foreground'}`}
            >
              {sectionsMissingFca}
            </CardTitle>
            {/* A link only when there is something to look at. At zero it
                stays plain text — a link promising a list of nothing is worse
                than a number. Points at the existing sections list, which
                already flags a missing adviser per row; a separate filtered
                view would be a second page saying the same thing. */}
            {sectionsMissingFca > 0 && (
              <CardDescription>
                <Link
                  href={
                    ayCode === currentAyCode
                      ? '/sis/sections'
                      : `/sis/sections?ay=${ayCode}`
                  }
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  See which classes
                </Link>
              </CardDescription>
            )}
            <CardAction>
              <div
                className={`flex size-9 items-center justify-center rounded-xl ${
                  sectionsMissingFca > 0
                    ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
                    : 'bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint'
                }`}
              >
                {sectionsMissingFca > 0 ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Active teachers
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {totalTeachers}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Users2 className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>

        <Card
          data-slot="card"
          className="bg-gradient-to-t from-primary/5 to-card"
        >
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Sections with FCA
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {withFca}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint">
                <UserCheck className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {teachingCount} teaching staff
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Users2 className="size-4" />
              </div>
              Teaching assignments
            </span>
          </CardTitle>
          {/* The year is SCOPE, not a table filter — it changes which rows
              exist rather than which of them show. It sits on the title row so
              it reads as "this card is showing AY2026", and so the filter row
              below is nothing but filters. */}
          <CardAction className="flex items-center gap-2 self-center">
            {viewOnly && (
              <Badge
                variant="outline"
                className="h-8 border-brand-indigo-soft bg-accent px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep"
              >
                View only
              </Badge>
            )}
            <AySwitcher
              current={ayCode}
              options={ayCodes}
              className="h-9 w-[128px]"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <StaffTable rows={rows} ayCode={ayCode} viewOnly={viewOnly} />
        </CardContent>
      </Card>
    </>
  );
}

/**
 * What stands in the boundary's place while the three staffing reads run.
 *
 * Built from the archetypes in `components/ui/skeleton-layouts.tsx`, so the
 * placeholder renders the REAL `<Card>` and `<Table>` emptied and cannot drift
 * from the shape it stands in for.
 *
 * Three cards with `footer={false}`: these are CardHeader-only (description,
 * `text-3xl` figure, `size-9` tile) and therefore shorter than the
 * footer-carrying stat cards elsewhere in the app. The grid classes are the
 * loaded grid's own.
 *
 * Four table columns, not eight: `StaffTable` defines eight and hides levels,
 * subjects, roles and cover through `initialColumnVisibility`, so four is what
 * a reader actually sees. Twelve rows against a page size of 20 and a roster of
 * roughly two dozen accounts. No widths are pinned because no column declares
 * one — inventing them here would cause the shift this file exists to avoid.
 */
function StaffAssignmentsFallback({ viewOnly }: { viewOnly: boolean }) {
  return (
    <>
      {/* `grid`, not `className`: it REPLACES the default grid rather than
          merging with it. Merging would leave the default's `lg:grid-cols-4`
          applying alongside `sm:grid-cols-3`, so the fallback would lay out
          four columns where the real grid has three. */}
      <SkeletonCards
        count={3}
        footer={false}
        grid="grid grid-cols-1 gap-4 sm:grid-cols-3"
      />

      {/* Real card chrome, so the border and padding do not pop in around the
          table when the data lands. */}
      <Card>
        <CardHeader>
          <SkeletonText variant="micro" className="w-[120px]" />
          <div className="flex items-center gap-2">
            <div
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
            />
            <SkeletonText variant="title" className="w-[168px]" />
          </div>
          {/* Where the AySwitcher lands — same height and width, so the title
              row keeps its shape. The "View only" badge has to be reserved
              too: it renders whenever a past year is selected, and `viewOnly`
              is already settled in the gate above the boundary, so leaving it
              out would shift the title row on ?ay=AY2025. */}
          <CardAction className="flex items-center gap-2 self-center">
            {viewOnly && <Skeleton className="h-8 w-[86px]" />}
            <Skeleton className="h-9 w-[128px]" />
          </CardAction>
        </CardHeader>
        <CardContent>
          {/* No `pagination`: StaffTable sets `hidePagination={rows.length
              <= 20}` and AY2026 has 19 teacher accounts, so the footer bar
              does not render. If staffing grows past 20 this needs
              `pagination` — it is a real ~45px of layout. */}
          <SkeletonTable columns={4} rows={12} />
        </CardContent>
      </Card>
    </>
  );
}
