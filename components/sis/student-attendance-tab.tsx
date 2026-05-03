import Link from 'next/link';
import { ArrowUpRight, CalendarCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createServiceClient } from '@/lib/supabase/service';
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from '@/lib/schemas/attendance';
import {
  getCompassionateUsage,
  getDailyForStudent,
  getMonthlyBreakdown,
} from '@/lib/attendance/queries';

// Status tone — gradient bg per the project's "we don't do flats" rule
// (and Aurora Vault tokens only per Hard Rule #7). White text reads on
// every variant.
const STATUS_TONE: Record<AttendanceStatus, string> = {
  P: 'border-transparent bg-gradient-to-br from-brand-mint to-brand-sky text-white shadow-sm',
  L: 'border-transparent bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-sm',
  EX: 'border-transparent bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-sm',
  A: 'border-transparent bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-sm',
  NC: 'border-transparent bg-gradient-to-br from-ink-4 to-ink-3 text-white shadow-sm',
};

// Renders the chronological attendance log for one student in the current AY.
// Read-only — editing flows through /attendance/[sectionId]. Cross-AY lookup
// goes via studentNumber (Hard Rule #4).
export async function StudentAttendanceTab({
  studentNumber,
  fullName,
}: {
  studentNumber: string | null;
  fullName: string;
}) {
  if (!studentNumber) {
    return (
      <EmptyState
        title="No student number on file"
        body="This admissions record does not have a studentNumber yet, so there's no way to link it to daily attendance. Assign a studentNumber in the Profile tab once one is issued."
      />
    );
  }

  const service = createServiceClient();

  // Find the current-AY section_students row for this studentNumber.
  const { data: currentAy } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  if (!currentAy) {
    return (
      <EmptyState
        title="No current academic year"
        body="An academic year must be marked current before attendance can be shown. Ask an admin to visit AY Setup."
      />
    );
  }

  const { data: studentRow } = await service
    .from('students')
    .select('id')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (!studentRow) {
    return (
      <EmptyState
        title="Student not synced"
        body={`No grading-side student record exists for ${studentNumber} yet. Run the admissions sync from the Markbook module before daily attendance can surface here.`}
      />
    );
  }

  const { data: ssRows } = await service
    .from('section_students')
    .select(
      'id, section_id, sections!inner(id, name, academic_year_id, level:levels(code, label))',
    )
    .eq('student_id', studentRow.id)
    .eq('sections.academic_year_id', currentAy.id);

  type SsRow = {
    id: string;
    section_id: string;
    sections: {
      id: string;
      name: string;
      academic_year_id: string;
      level: { code: string; label: string } | Array<{ code: string; label: string }> | null;
    } | Array<{
      id: string;
      name: string;
      academic_year_id: string;
      level: { code: string; label: string } | Array<{ code: string; label: string }> | null;
    }>;
  };
  const enrolments = ((ssRows ?? []) as SsRow[]).map((r) => {
    const s = Array.isArray(r.sections) ? r.sections[0] : r.sections;
    const lvl = s && (Array.isArray(s.level) ? s.level[0] : s.level);
    return {
      sectionStudentId: r.id,
      sectionId: r.section_id,
      sectionName: s?.name ?? '(unknown)',
      levelCode: lvl?.code ?? '',
      levelLabel: lvl?.label ?? '',
    };
  });

  if (enrolments.length === 0) {
    return (
      <EmptyState
        title={`Not enrolled in ${currentAy.ay_code}`}
        body="This student isn't on any section roster for the current academic year, so there are no daily attendance records yet."
      />
    );
  }

  // If multiple enrolments somehow (edge case — shouldn't happen for primary
  // homeroom attendance), show all.
  const sections = await Promise.all(
    enrolments.map(async (e) => {
      const [daily, monthly] = await Promise.all([
        getDailyForStudent(e.sectionStudentId),
        getMonthlyBreakdown(e.sectionStudentId),
      ]);
      const summary = summarise(daily);
      const grouped = groupByMonth(daily);
      return { ...e, daily, monthly, summary, grouped };
    }),
  );

  // Compassionate-leave quota — AY-wide, per student (not per enrolment).
  const quota = await getCompassionateUsage(studentRow.id, currentAy.id);

  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <Card key={s.sectionStudentId}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                {currentAy.ay_code} · Homeroom
              </CardDescription>
              <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
                {s.sectionName}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                {s.levelCode && `${s.levelCode} · `}
                {s.levelLabel}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/attendance/${s.sectionId}?date=${todayIso()}`}>
                Mark attendance
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <SummaryChip label="Present" value={s.summary.present} tone="P" />
              <SummaryChip label="Late" value={s.summary.late} tone="L" />
              <SummaryChip label="Excused" value={s.summary.excused} tone="EX" />
              <SummaryChip label="Absent" value={s.summary.absent} tone="A" />
              <span className="rounded-full border border-transparent bg-gradient-to-b from-brand-indigo to-brand-indigo-deep px-2.5 py-1 font-mono tabular-nums text-white shadow-sm">
                {s.summary.pct != null ? `${s.summary.pct.toFixed(1)}%` : '—'}
              </span>
              <span
                className={
                  'rounded-full border border-transparent px-2.5 py-1 font-mono tabular-nums text-white shadow-sm ' +
                  (quota.remaining <= 0
                    ? 'bg-gradient-to-br from-destructive to-destructive/80'
                    : quota.remaining <= 1
                      ? 'bg-gradient-to-br from-brand-amber to-brand-amber/80'
                      : 'bg-gradient-to-br from-brand-mint to-brand-sky')
                }
                title={`Urgent / compassionate leave used ${quota.used} of ${quota.allowance}; ${quota.remaining} remaining this AY`}
              >
                Comp. leave {quota.used}/{quota.allowance}
              </span>
            </div>

            {s.monthly.length > 0 && <MonthlyBreakdownTable rows={s.monthly} />}

            {s.daily.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No daily attendance logged yet for {fullName}.
              </div>
            ) : (
              <div className="space-y-4">
                {s.grouped.map(([monthLabel, entries]) => (
                  <div key={monthLabel} className="space-y-2">
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {monthLabel}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {entries.map((e) => (
                        <span
                          key={e.id}
                          title={`${ATTENDANCE_STATUS_LABELS[e.status]} · ${e.date}`}
                          className={
                            'inline-flex min-w-[52px] items-center justify-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] font-semibold ' +
                            STATUS_TONE[e.status]
                          }
                        >
                          <span className="tabular-nums">{e.date.slice(-2)}</span>
                          <span>·</span>
                          <span>{e.status}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MonthlyBreakdownTable({
  rows,
}: {
  rows: Array<{
    month: string;
    label: string;
    schoolDays: number;
    present: number;
    late: number;
    excused: number;
    absent: number;
    pct: number | null;
  }>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-muted/40 font-mono uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-2 py-2 text-right">School days</th>
            <th className="px-2 py-2 text-right">Present</th>
            <th className="px-2 py-2 text-right">Late</th>
            <th className="px-2 py-2 text-right">Excused</th>
            <th className="px-2 py-2 text-right">Absent</th>
            <th className="px-3 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-t border-border">
              <td className="px-3 py-1.5 font-medium text-foreground">{r.label}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.schoolDays}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.present}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.late}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.excused}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.absent}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                {r.pct != null ? `${r.pct.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <CalendarCheck className="size-5" />
        </div>
        <div className="font-serif text-lg font-semibold text-foreground">{title}</div>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: AttendanceStatus;
}) {
  return (
    <Badge
      variant="outline"
      className={'gap-1.5 border px-2.5 py-1 font-mono text-[11px] tabular-nums ' + STATUS_TONE[tone]}
    >
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </Badge>
  );
}

function summarise(rows: Array<{ status: AttendanceStatus }>) {
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  let schoolDays = 0;
  for (const r of rows) {
    if (r.status === 'NC') continue;
    schoolDays += 1;
    if (r.status === 'P') present += 1;
    else if (r.status === 'L') {
      present += 1;
      late += 1;
    } else if (r.status === 'EX') {
      present += 1;
      excused += 1;
    } else if (r.status === 'A') {
      absent += 1;
    }
  }
  const pct = schoolDays > 0 ? (present / schoolDays) * 100 : null;
  return { present, late, excused, absent, schoolDays, pct };
}

function groupByMonth(
  rows: Array<{ id: string; date: string; status: AttendanceStatus }>,
): Array<[string, Array<{ id: string; date: string; status: AttendanceStatus }>]> {
  // Rows arrive sorted date desc by the query — keep that order inside groups.
  const map = new Map<string, Array<{ id: string; date: string; status: AttendanceStatus }>>();
  for (const r of rows) {
    const key = r.date.slice(0, 7); // yyyy-MM
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const entries = Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  return entries.map(([ym, list]) => {
    const [y, m] = ym.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return [
      d.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }),
      list,
    ];
  });
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
