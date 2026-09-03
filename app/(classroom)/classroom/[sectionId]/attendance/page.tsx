import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight, CalendarCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSectionAttendanceSummary } from '@/lib/attendance/queries';
import { canReadAttendance } from '@/lib/classroom/scope';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Attendance — adviser/oversight only. Belt-and-braces: this page checks
// canReadAttendance ITSELF (not just the layout, which only asserts "any
// capability at all" — see lib/classroom/queries.ts). getSectionAttendanceSummary
// reads via the service client, which bypasses RLS, so this check is the
// real security boundary for a subject teacher typing this URL directly.
//
// Deliberately no embedded grid — the marking sheet assumes full viewport
// width (sticky columns, marking palette, up to 50 students). This is a
// summary + a link to the real writer at /attendance/[sectionId].
export default async function ClassroomAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  // The one role in force — see the
  // section layout for the full note; the shape is identical on every
  // classroom tab.
  const view = await getSessionUser();
  if (!view) redirect('/login');
  const { id: userId, role } = view;

  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  // ⚠ REACHABLE, unlike the `!capability` gate the layout answers first: a
  // viewer holding only `subject` capability on this class PASSES the layout
  // and is turned away here — a teacher who teaches a subject in a class she
  // does not advise. Attendance belongs to the form adviser.
  if (!capability || !canReadAttendance(capability)) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select('id, academic_year_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();

  const terms = await getTermsForAy(section.academic_year_id);
  const selectedTermId = resolveSelectedTermId(terms, sp.term_id);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;

  const summary = selectedTermId
    ? await getSectionAttendanceSummary(sectionId, selectedTermId)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Attendance summary
        </h2>
        {selectedTerm && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {selectedTerm.label}
          </span>
        )}
      </div>

      {!summary ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No term configured for this academic year.
        </div>
      ) : (
        <Card className="@container/card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Average, {selectedTerm?.label ?? 'this term'}
              </CardDescription>
              <CardTitle className="font-serif text-[24px] font-semibold tracking-tight text-foreground">
                {summary.averageAttendancePct != null
                  ? `${summary.averageAttendancePct.toFixed(1)}% average`
                  : 'No data yet'}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Read-only. Daily marking happens in the Attendance module.
              </p>
            </div>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <CalendarCheck className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-6">
              <Stat label="School days" value={summary.schoolDays} />
              <Stat label="Present" value={summary.totalDaysPresent} />
              <Stat
                label="Late"
                value={summary.totalDaysLate}
                className="text-amber-700 dark:text-amber-200"
              />
              <Stat
                label="Excused"
                value={summary.totalDaysExcused}
                className="text-sky-700 dark:text-sky-200"
              />
              <Stat
                label="Absent"
                value={summary.totalDaysAbsent}
                className="text-amber-700 dark:text-amber-200"
              />
              <Stat
                label="Perfect"
                value={summary.perfectAttendanceCount}
                suffix={` / ${summary.studentCount}`}
              />
              <div className="ml-auto">
                <Button asChild size="sm" className="gap-1.5">
                  <Link
                    href={`/attendance/${sectionId}${
                      selectedTermId ? `?term_id=${selectedTermId}` : ''
                    }`}
                  >
                    Open the attendance sheet
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  className,
}: {
  label: string;
  value: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={`font-serif text-[20px] font-semibold tabular-nums text-foreground ${className ?? ''}`}
      >
        {value.toLocaleString('en-SG')}
        {suffix && (
          <span className="ml-1 text-[13px] font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
    </div>
  );
}
