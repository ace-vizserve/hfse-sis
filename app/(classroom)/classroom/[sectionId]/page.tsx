import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowUpRight,
  BookOpen,
  CalendarCheck,
  MessageSquare,
  Users,
} from 'lucide-react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSectionAttendanceSummary } from '@/lib/attendance/queries';
import { canReadAttendance, canReadWriteups } from '@/lib/classroom/scope';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import { getWriteupProgressByTerm } from '@/lib/evaluation/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Overview — the class at a glance for the selected term. A compact
// per-term summary + links out to the four other tabs; the full roster now
// lives on the Students tab (this used to be the whole Phase 2 page), and
// the Health strip (attendance %, missing scores, at-risk students) is
// explicitly Phase 5 — not built here (see the Phase 4 brief).

export default async function ClassroomOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  // Belt-and-braces re-check (see the layout for the section-level gate);
  // Overview itself has no RLS-restricted data, but capability drives which
  // stat cards below are meaningful to show.
  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!capability) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select('id, name, academic_year_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();

  const terms = await getTermsForAy(section.academic_year_id);
  const selectedTermId = resolveSelectedTermId(terms, sp.term_id);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;
  const isT4 = selectedTerm?.term_number === 4;

  const { count: activeCount } = await supabase
    .from('section_students')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .neq('enrollment_status', 'withdrawn');

  let sheetsCount = 0;
  let lockedCount = 0;
  if (selectedTermId) {
    const { data: sheets } = await supabase
      .from('grading_sheets')
      .select('id, is_locked')
      .eq('section_id', sectionId)
      .eq('term_id', selectedTermId);
    sheetsCount = sheets?.length ?? 0;
    lockedCount = (sheets ?? []).filter((s) => s.is_locked).length;
  }

  const showAttendance = canReadAttendance(capability);
  const showWriteups = canReadWriteups(capability);

  const attendanceSummary =
    showAttendance && selectedTermId
      ? await getSectionAttendanceSummary(sectionId, selectedTermId)
      : null;

  // KD #120/#126 submitted+non-empty predicate is baked into this loader
  // already — see lib/evaluation/queries.ts::getWriteupProgressByTerm.
  const writeupProgress =
    showWriteups && selectedTermId && !isT4
      ? (await getWriteupProgressByTerm(selectedTermId, [sectionId]))[sectionId]
      : null;

  const termQuery = selectedTermId ? `?term_id=${selectedTermId}` : '';

  return (
    <div className="space-y-6">
      {selectedTerm && (
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {selectedTerm.label}
          {selectedTerm.is_current ? ' · Current term' : ''}
        </p>
      )}

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @4xl/main:grid-cols-4">
          <LinkStatCard
            description="Students"
            value={(activeCount ?? 0).toLocaleString('en-SG')}
            icon={Users}
            footerTitle="Open the roster"
            footerDetail="Active + late enrollees"
            href={`/classroom/${sectionId}/students${termQuery}`}
          />
          <LinkStatCard
            description="Grading sheets"
            value={sheetsCount.toLocaleString('en-SG')}
            icon={BookOpen}
            footerTitle={
              sheetsCount === 0
                ? 'None yet this term'
                : `${lockedCount} locked, ${sheetsCount - lockedCount} open`
            }
            footerDetail="This term"
            href={`/classroom/${sectionId}/grades${termQuery}`}
          />
          {showAttendance && (
            <LinkStatCard
              description="Attendance"
              value={
                attendanceSummary?.averageAttendancePct != null
                  ? `${attendanceSummary.averageAttendancePct.toFixed(1)}%`
                  : '—'
              }
              icon={CalendarCheck}
              footerTitle={
                attendanceSummary && attendanceSummary.schoolDays > 0
                  ? `${attendanceSummary.schoolDays} school days`
                  : 'No data yet'
              }
              footerDetail="Average, this term"
              href={`/classroom/${sectionId}/attendance${termQuery}`}
            />
          )}
          {showWriteups && (
            <LinkStatCard
              description="Write-ups"
              value={
                isT4
                  ? '—'
                  : `${writeupProgress?.submitted_count ?? 0}/${writeupProgress?.active_count ?? 0}`
              }
              icon={MessageSquare}
              footerTitle={isT4 ? 'No FCA write-up for Term 4' : 'Submitted'}
              footerDetail={isT4 ? 'Final term has no comment' : 'This term'}
              href={`/classroom/${sectionId}/write-ups${termQuery}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LinkStatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
  href,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block transition-all hover:-translate-y-0.5 focus-visible:outline-none"
    >
      <Card className="@container/card h-full transition-all group-hover:border-brand-indigo/40 group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-indigo/40">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {description}
          </CardDescription>
          <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
            {value}
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <p className="inline-flex items-center gap-1 font-medium text-foreground">
            {footerTitle}
            <ArrowUpRight className="size-3 opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
          </p>
          <p className="text-xs text-muted-foreground">{footerDetail}</p>
        </CardFooter>
      </Card>
    </Link>
  );
}
