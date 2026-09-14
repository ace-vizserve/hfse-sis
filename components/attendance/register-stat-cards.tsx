'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CalendarCheck,
  CalendarDays,
  Percent,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import type { SectionAttendanceSummary } from '@/lib/attendance/section-summary';

/**
 * The four cards above the register.
 *
 * WHY THEY OWN THEIR DATA NOW. Two of these read the term summary, which
 * changes with every mark. They used to arrive as server props, so the only way
 * to refresh them was `router.refresh()` — and the grid AWAITED that whole page
 * render before reporting a save, 800ms to 3.3s per cell, with the grid locked
 * throughout. The mark itself goes straight to Supabase (migration 149); this
 * query is what the grid invalidates instead, so a save costs one insert and
 * one small read.
 *
 * `initialData` is the summary the page already loaded, so the first paint is
 * byte-identical to the server-rendered version and there is no fetch waterfall
 * on arrival — the query only ever runs when the grid invalidates it.
 */
export function RegisterStatCards({
  sectionId,
  termId,
  initialSummary,
  activeCount,
  withdrawnCount,
  schoolDayCount,
  holidayCount,
  termLabel,
}: {
  sectionId: string;
  termId: string;
  initialSummary: SectionAttendanceSummary;
  /** Static per section+term — no reason to refetch these with the summary. */
  activeCount: number;
  withdrawnCount: number;
  schoolDayCount: number;
  holidayCount: number;
  termLabel: string;
}) {
  const { data: summary } = useQuery({
    queryKey: queryKeys.attendanceSectionSummary(sectionId, termId),
    queryFn: () =>
      apiFetch<SectionAttendanceSummary>(
        `/api/attendance/sections/${sectionId}/summary?term=${encodeURIComponent(termId)}`
      ),
    initialData: initialSummary,
    // The page handed us a fresh copy; don't refetch just for mounting.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="@container/main">
      <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-4">
        <StatCard
          description="Students"
          value={activeCount.toLocaleString('en-SG')}
          icon={Users}
          footerTitle="Active roster"
          footerDetail={`${withdrawnCount} withdrawn`}
        />
        <StatCard
          description="School days"
          value={schoolDayCount.toLocaleString('en-SG')}
          icon={CalendarDays}
          footerTitle={
            schoolDayCount === 0
              ? 'Not configured'
              : `${holidayCount} ${holidayCount === 1 ? 'holiday' : 'holidays'}`
          }
          footerDetail={termLabel}
        />
        {/* presentRate, not averageAttendancePct. The old figure was the mean
            of per-student percentages, which weights a child with four marks
            the same as one with forty-six — and the footer under it said
            "Present ÷ school days", which is what it was NOT doing. This one is
            the real ratio over the student-days marked, and the footer names
            its own denominator. */}
        <StatCard
          description="Attendance"
          value={
            summary.presentRate != null
              ? `${summary.presentRate.toFixed(1)}%`
              : '—'
          }
          icon={Percent}
          footerTitle={
            summary.markedStudentDays > 0
              ? `Across ${summary.markedStudentDays.toLocaleString('en-SG')} student-days marked`
              : 'Nothing marked yet'
          }
          footerDetail={
            summary.unmarkedStudentDays > 0
              ? `${summary.unmarkedStudentDays.toLocaleString('en-SG')} still to mark`
              : 'Fully marked'
          }
        />
        <StatCard
          description="Perfect attendance"
          value={summary.perfectAttendanceCount.toLocaleString('en-SG')}
          icon={CalendarCheck}
          footerTitle={
            summary.perfectAttendanceCount === 0 ? 'None yet' : 'Zero absences'
          }
          footerDetail={`of ${activeCount} students`}
        />
      </div>
    </div>
  );
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: LucideIcon;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
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
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
