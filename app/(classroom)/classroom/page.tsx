import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Layers, Users } from 'lucide-react';

import { ClassroomListTable } from '@/components/classroom/classroom-list-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { UpcomingCoverPanel } from '@/components/relief/upcoming-cover';
import { loadUpcomingCoverForUser } from '@/lib/relief/upcoming';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { loadEffectiveAssignmentsForUserMemo } from '@/lib/auth/assignments-cache';
import { resolveClassroomScope } from '@/lib/classroom/scope';
import { compareLevelLabels } from '@/lib/sis/levels';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

export default async function ClassroomListPage() {
  const view = await getSessionUser();
  if (!view) redirect('/login');
  const { id: userId, role } = view;

  const supabase = await createClient();

  // Scoping — Phase 1's resolver. Only `teacher` derives a scope from
  // assignments; oversight roles skip the query (resolveClassroomScope
  // ignores assignments for them) and admissions/p_file_officer never
  // reach this page at all (ROUTE_ACCESS excludes them).
  //
  // The MEMO, not a fresh `loadEffectiveAssignmentsForUser(createServiceClient(), …)`:
  // a single navigation asks this same question from the palette, the sidebar
  // resolver and the classroom layout. Same loader, same data, same conditions
  // (lib/auth/assignments-cache.ts); the memo keys on the userId string, which
  // is why the service client has to be built inside it rather than passed in.
  const assignments =
    role === 'teacher' ? await loadEffectiveAssignmentsForUserMemo(userId) : [];
  const scope = resolveClassroomScope(role, assignments);

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  // `[]` (no assigned classes) is NOT the same as `null` (unscoped/all) —
  // an empty scoped list must render zero classes, never fall through to
  // "no filter."
  const noScopedClasses =
    scope.sectionIds !== null && scope.sectionIds.length === 0;

  let sections: Array<{
    id: string;
    name: string;
    level: LevelLite | LevelLite[] | null;
  }> = [];
  if (ay && !noScopedClasses) {
    let query = supabase
      .from('sections')
      .select('id, name, level:levels(id, code, label, level_type)')
      .eq('academic_year_id', ay.id);
    if (scope.sectionIds !== null) {
      query = query.in('id', scope.sectionIds);
    }
    const { data } = await query;
    sections = data ?? [];
  }

  const ids = sections.map((s) => s.id);
  const activeCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: enrolments } = await supabase
      .from('section_students')
      .select('section_id, enrollment_status')
      .in('section_id', ids);
    for (const row of enrolments ?? []) {
      if (row.enrollment_status === 'withdrawn') continue;
      activeCounts[row.section_id] = (activeCounts[row.section_id] ?? 0) + 1;
    }
  }

  const adviserMap = ay ? await loadFormAdvisersBySection(ids, ay.ay_code) : {};

  const getLevel = (l: LevelLite | LevelLite[] | null): LevelLite | null =>
    Array.isArray(l) ? (l[0] ?? null) : l;

  const rows = sections.map((s) => {
    const lvl = getLevel(s.level);
    return {
      id: s.id,
      name: s.name,
      levelLabel: lvl?.label ?? 'Unknown',
      levelId: lvl?.id ?? '',
      active: activeCounts[s.id] ?? 0,
      adviserName: adviserMap[s.id]?.name ?? null,
    };
  });

  const levelMap = new Map<
    string,
    { id: string; code: string; label: string }
  >();
  for (const s of sections) {
    const lvl = getLevel(s.level);
    if (lvl && !levelMap.has(lvl.id)) {
      levelMap.set(lvl.id, { id: lvl.id, code: lvl.code, label: lvl.label });
    }
  }
  const levels = Array.from(levelMap.values()).sort((a, b) =>
    compareLevelLabels(a.label, b.label)
  );

  const totalStudents = rows.reduce((n, r) => n + r.active, 0);

  // Every string on this page follows the list underneath it. The heading used
  // to be an unconditional "Your classes." shown to a coordinator standing over
  // all 32 of them, and a teacher with nothing assigned used to be told
  // "Classes appear here once sections are created", which is not her problem
  // and not her fix.
  const isTeacherView = !scope.isOversight && role === 'teacher';
  const heading = scope.isOversight ? 'All classes.' : 'Your classes.';
  const emptyTitle = isTeacherView
    ? 'No classes assigned yet.'
    : 'No classes yet.';
  const emptyBody = isTeacherView
    ? "You don't have any classes assigned this year. Ask your coordinator to add you as a form adviser or subject teacher."
    : 'Classes appear here once sections are created and a roster is synced.';

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Classroom
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {heading}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Everything about a class — roster, attendance, grading, and
            write-ups — in one place. Click a class to open it.
          </p>
        </div>
        {ay && (
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            {ay.ay_code}
          </Badge>
        )}
      </header>

      {/* Cover booked for this teacher that has not started. Not a link and
          never the word "covering" — see components/relief/upcoming-cover.tsx.

          Behind a boundary because this read used to sit on the critical path:
          it ran between resolveClassroomScope and the academic-year query, so
          the header waited on a panel that most teachers never see.

          `fallback={null}`, deliberately, not a skeleton — UpcomingCoverPanel
          returns null when nothing is booked, which is the common case, so a
          placeholder here would flash and then collapse the layout under it. */}
      <Suspense fallback={null}>
        <UpcomingCover userId={userId} role={role} className="mt-6" />
      </Suspense>

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
          <SummaryCard
            description="Classes"
            value={rows.length}
            icon={Layers}
            footerTitle={`${levels.length} ${levels.length === 1 ? 'level' : 'levels'}`}
            footerDetail={ay?.label ?? 'No current AY'}
          />
          <SummaryCard
            description="Students"
            value={totalStudents}
            icon={Users}
            footerTitle="Currently enrolled"
            footerDetail="Across the classes above"
          />
        </div>
      </div>

      <ClassroomListTable
        rows={rows}
        levels={levels}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
      />
    </PageShell>
  );
}

/**
 * Cover this teacher is booked to take but cannot open yet (migration 123).
 *
 * Caller's client on purpose: the row-read policy is deliberately unwindowed
 * (KD #191 — seeing a cover and acting on one are different questions), so
 * this needs no service-role escalation.
 *
 * Split out of the page body so it streams. Nothing else on the page consumes
 * its result, which is what makes it the one read here that decomposes — the
 * rest of the page funnels into a single `rows` array that both summary cards
 * and the table read, and prising that apart would mean restructuring the data
 * flow rather than adding a boundary.
 *
 * ⚠ THE ROLE TEST IS AN OPTIMISATION, NOT A GATE, AND RLS IS WHY THAT IS SAFE.
 * It reads through the CALLER'S client against a policy that already scopes the
 * rows to the viewer's own bookings, so the branch only skips a query whose
 * answer would be empty.
 */
async function UpcomingCover({
  userId,
  role,
  className,
}: {
  userId: string;
  role: string | null;
  className?: string;
}) {
  if (role !== 'teacher') return null;
  const supabase = await createClient();
  const covers = await loadUpcomingCoverForUser(supabase, userId);
  return <UpcomingCoverPanel covers={covers} className={className} />;
}

function SummaryCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
