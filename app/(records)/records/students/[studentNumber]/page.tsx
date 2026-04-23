import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, CalendarCheck, GraduationCap, Layers, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  findStudentByNumber,
  getAcademicHistory,
  getAttendanceHistory,
  getPlacementHistory,
  type AcademicHistoryRow,
  type AttendanceHistoryRow,
  type PlacementRow,
} from '@/lib/sis/records-history';
import { getSessionUser } from '@/lib/supabase/server';

function displayName(s: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string {
  const parts = [s.lastName, s.firstName, s.middleName].filter(Boolean);
  return parts.length ? parts.join(', ') : '(no name on file)';
}

function fmtPercentage(num: number | null, den: number | null): string {
  if (!num || !den || den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export default async function RecordsStudentCrossYearPage({
  params,
}: {
  params: Promise<{ studentNumber: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const { studentNumber } = await params;

  const student = await findStudentByNumber(studentNumber);
  if (!student) notFound();

  const [placements, academics, attendance] = await Promise.all([
    getPlacementHistory(student.studentId),
    getAcademicHistory(student.studentId),
    getAttendanceHistory(student.studentId),
  ]);

  const ayCount = new Set(placements.map((p) => p.ayCode)).size;
  const activePlacement = placements.find((p) => p.enrollmentStatus === 'active');

  return (
    <PageShell>
      <Link
        href="/records/students"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Students
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Permanent record
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {displayName(student)}
          </h1>
          <Badge
            variant="outline"
            className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            #{student.studentNumber}
          </Badge>
        </div>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Cross-year view keyed on <code className="font-mono">studentNumber</code> (Hard Rule #4).{' '}
          {ayCount > 0 ? (
            <>
              Enrolled across <strong>{ayCount}</strong> academic year{ayCount === 1 ? '' : 's'}.
              {activePlacement && (
                <>
                  {' '}Currently in{' '}
                  <strong>
                    {activePlacement.levelCode} {activePlacement.sectionName}
                  </strong>
                  .
                </>
              )}
            </>
          ) : (
            <>No enrolment history yet.</>
          )}
        </p>
      </header>

      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <Stat label="Academic years" value={ayCount} icon={Layers} footnote="Years on roster" />
          <Stat
            label="Total placements"
            value={placements.length}
            icon={Users}
            footnote="Section enrolments"
          />
          <Stat
            label="Terms graded"
            value={academics.reduce((n, ay) => n + ay.terms.length, 0)}
            icon={GraduationCap}
            footnote="Cumulative across years"
          />
        </div>
      </section>

      <PlacementSection rows={placements} />
      <AcademicSection rows={academics} />
      <AttendanceSection rows={attendance} />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <GraduationCap className="size-3" strokeWidth={2.25} />
        <span>Permanent record</span>
        <span className="text-border">·</span>
        <span>studentNumber {student.studentNumber}</span>
        <span className="text-border">·</span>
        <span>Append-only</span>
      </div>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
}) {
  return (
    <div
      data-slot="card"
      className="@container/card flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm"
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-6">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</p>
          <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
            {value.toLocaleString('en-SG')}
          </p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="px-6 text-xs text-muted-foreground">{footnote}</p>
    </div>
  );
}

function PlacementSection({ rows }: { rows: PlacementRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Class placement history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Placements across every AY
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No placements on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3">AY</th>
                  <th className="py-2 pr-3">Level</th>
                  <th className="py-2 pr-3">Section</th>
                  <th className="py-2 pr-3 text-right">Index</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Enrolled</th>
                  <th className="py-2">Withdrawn</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.ayCode}-${r.sectionName}-${r.indexNumber}`} className="border-b border-hairline last:border-0">
                    <td className="py-2 pr-3 font-mono tabular-nums">{r.ayCode}</td>
                    <td className="py-2 pr-3">{r.levelCode}</td>
                    <td className="py-2 pr-3">{r.sectionName}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">#{r.indexNumber}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={r.enrollmentStatus} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {r.enrollmentDate ?? '—'}
                    </td>
                    <td className="py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {r.withdrawalDate ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PlacementRow['enrollmentStatus'] }) {
  if (status === 'active') {
    return <Badge className="border-transparent bg-brand-mint text-foreground">Active</Badge>;
  }
  if (status === 'late_enrollee') {
    return (
      <Badge variant="outline" className="border-brand-amber/50 text-brand-amber">
        Late
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
      Withdrawn
    </Badge>
  );
}

function AcademicSection({ rows }: { rows: AcademicHistoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Academic history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Grades per term × subject
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No graded terms yet.</p>
        ) : (
          rows.map((ay) => (
            <div key={ay.ayCode} className="space-y-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {ay.ayCode} · {ay.ayLabel}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="py-2 pr-3">Subject</th>
                      {ay.terms.map((t) => (
                        <th key={t.termNumber} className="py-2 pr-3 text-right">
                          T{t.termNumber}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Collect the union of subjects across all terms in this AY.
                      const subjMap = new Map<string, string>();
                      for (const t of ay.terms) {
                        for (const s of t.subjects) {
                          if (!subjMap.has(s.subjectCode)) {
                            subjMap.set(s.subjectCode, s.subjectName);
                          }
                        }
                      }
                      const subjects = [...subjMap.entries()].sort((a, b) =>
                        a[1].localeCompare(b[1]),
                      );
                      return subjects.map(([code, name]) => (
                        <tr key={code} className="border-b border-hairline last:border-0">
                          <td className="py-2 pr-3 font-medium text-foreground">{name}</td>
                          {ay.terms.map((t) => {
                            const cell = t.subjects.find((s) => s.subjectCode === code);
                            return (
                              <td
                                key={t.termNumber}
                                className="py-2 pr-3 text-right font-mono tabular-nums"
                              >
                                {cell?.quarterlyGrade != null
                                  ? cell.quarterlyGrade.toFixed(0)
                                  : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceSection({ rows }: { rows: AttendanceHistoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Attendance history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          <span className="inline-flex items-center gap-2">
            <CalendarCheck className="size-4 text-primary" />
            Per-term summary
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance records yet.</p>
        ) : (
          rows.map((ay) => (
            <div key={ay.ayCode} className="space-y-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {ay.ayCode} · {ay.ayLabel}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="py-2 pr-3">Term</th>
                      <th className="py-2 pr-3 text-right">School days</th>
                      <th className="py-2 pr-3 text-right">Present</th>
                      <th className="py-2 pr-3 text-right">Late</th>
                      <th className="py-2 text-right">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ay.terms.map((t) => (
                      <tr key={t.termNumber} className="border-b border-hairline last:border-0">
                        <td className="py-2 pr-3 font-medium text-foreground">T{t.termNumber}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.schoolDays ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.daysPresent ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.daysLate ?? '—'}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {fmtPercentage(t.daysPresent, t.schoolDays)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
