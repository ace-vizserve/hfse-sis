import Link from 'next/link';
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
import type { SectionAttendanceSummary } from '@/lib/attendance/section-summary';
import { cn } from '@/lib/utils';

// One attendance summary card, shared by the Classroom Attendance tab and the
// Markbook section page. It was two near-identical copies with a `Stat` helper
// each; they had already drifted (different headline sizes, different button
// variants) and the arithmetic fix below would have had to land twice.
//
// ── WHAT THIS CARD HAS TO SAY, AND WHY IT IS THREE THINGS ──────────────────
//
// A percentage on its own is not readable here. Mr Ace, 2026-09-09, looking at
// a class showing "100.0% average" over six days:
//
//   "it doesnt really give context ... we are not comparing the school days to
//    the number of student and how many total of present they should have"
//
// So the card answers three questions in order, and none of them substitutes
// for another:
//
//   1. HOW ARE THEY DOING     the rate, over the student-days actually marked
//   2. HOW MUCH DO WE KNOW    coverage — days marked out of the term's days
//   3. WHAT MAKES IT UP       on time / late / excused / absent, which SUM
//
// (2) is the part that was missing entirely, and it is why (1) could read 100%
// for a class nobody had marked. It renders only when there is a gap: a class
// that is fully marked has nothing to confess, and a permanent "0 outstanding"
// strip would be noise on every other card in the school.

export function SectionSummaryCard({
  summary,
  termLabel,
  href,
  linkLabel,
  headline = 'lg',
}: {
  summary: SectionAttendanceSummary;
  termLabel: string | null;
  href: string;
  linkLabel: string;
  /** `lg` on the dedicated Attendance tab, `sm` inside Markbook's stack. */
  headline?: 'lg' | 'sm';
}) {
  const {
    presentRate,
    schoolDays,
    daysMarked,
    unmarkedStudentDays,
    markedStudentDays,
    onTime,
    late,
    excused,
    absent,
    perfectAttendanceCount,
    studentCount,
  } = summary;

  const coveragePct =
    schoolDays > 0 ? Math.min(100, (daysMarked / schoolDays) * 100) : 0;
  const hasGap = unmarkedStudentDays > 0;

  return (
    <Card className="@container/card">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Attendance · {termLabel ?? 'Current term'}
          </CardDescription>
          <CardTitle
            className={cn(
              'font-serif font-semibold tracking-tight text-foreground',
              headline === 'lg' ? 'text-[24px]' : 'text-[20px]'
            )}
          >
            {presentRate != null
              ? `${presentRate.toFixed(1)}% present`
              : 'Nothing marked yet'}
          </CardTitle>
          {/* The qualifier is not decoration — it is what stops the number
              above being read as a claim about the whole term. A rate measured
              over ten student-days and a rate measured over six hundred look
              identical without it. */}
          <p className="text-[11px] text-muted-foreground">
            {presentRate != null ? (
              <>
                Across the {markedStudentDays.toLocaleString('en-SG')} student
                {markedStudentDays === 1 ? '-day' : '-days'} marked so far.
                Daily marking happens in the Attendance module.
              </>
            ) : (
              <>
                No marks recorded for this term yet. Daily marking happens in
                the Attendance module.
              </>
            )}
          </p>
        </div>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <CalendarCheck className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Coverage. Amber, because an unmarked day is something to go and do
            — not mint, which would read as "all clear", and not destructive,
            which would read as an error when it is usually just Tuesday. */}
        {hasGap && (
          <div className="rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-medium text-foreground">
                {daysMarked} of {schoolDays} school days marked
              </p>
              <p className="text-[11px] text-muted-foreground">
                {unmarkedStudentDays.toLocaleString('en-SG')} student
                {unmarkedStudentDays === 1 ? '-day' : '-days'} still to mark
              </p>
            </div>
            <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-brand-amber"
                style={{ width: `${coveragePct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Stat label="School days" value={schoolDays} />
          <Stat label="Marked" value={daysMarked} />
          {/* On time, not "present" — the rollup's `days_present` is P + L + EX,
              so printing it beside late and excused counted the same student-day
              two and three times over. These four sum to the marked total. */}
          <Stat label="On time" value={onTime} />
          <Stat label="Late" value={late} tone="warn" />
          <Stat label="Excused" value={excused} tone="info" />
          <Stat label="Absent" value={absent} tone="warn" />
          <Stat
            label="Perfect"
            value={perfectAttendanceCount}
            suffix={` / ${studentCount}`}
          />
          <div className="ml-auto">
            <Button asChild size="sm" className="gap-1.5">
              <Link href={href}>
                {linkLabel}
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
  suffix,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warn' | 'info';
  suffix?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-serif text-[20px] font-semibold tabular-nums',
          // Zero is the good outcome for late and absent, so colouring a zero
          // amber would put a warning tone on the healthiest possible reading.
          tone === 'warn' && value > 0
            ? 'text-brand-amber'
            : tone === 'info' && value > 0
              ? 'text-brand-sky'
              : 'text-foreground'
        )}
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
