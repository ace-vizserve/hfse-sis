import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  Heart,
  Umbrella,
  UserSquare2,
} from 'lucide-react';

import { CompassionateAllowanceInline } from '@/components/sis/compassionate-allowance-inline';
import { StudentAttendanceTab } from '@/components/sis/student-attendance-tab';
import { VacationAllowanceInline } from '@/components/sis/vacation-allowance-inline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getCompassionateUsage,
  getVacationLeaveUsage,
} from '@/lib/attendance/queries';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { cn } from '@/lib/utils';

// Per-student attendance detail page (registrar+).
//
// Hosts the canonical edit surface for the per-student compassionate-leave
// quota AND the daily attendance grid + monthly breakdown. Reachable by:
//   - Records detail page → "Open daily detail →"
//   - Records detail page → QuickActionsStrip "Attendance" CTA
//   - Attendance dashboard's Compassionate Quota drill → per-row View
//
// Cross-section view by design: a student belongs to exactly one section per
// AY, so this page surfaces that section's daily ledger + the AY-wide quota
// usage. Teachers don't get this surface — they manage attendance per-section
// via /attendance/[sectionId].
export default async function AttendanceStudentDetailPage({
  params,
}: {
  params: Promise<{ studentNumber: string }>;
}) {
  const { studentNumber: rawStudentNumber } = await params;
  const studentNumber = decodeURIComponent(rawStudentNumber).trim();

  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (
    session.role !== 'academic_coordinator' &&
    session.role !== 'school_admin' &&
    session.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();

  const { data: student } = await service
    .from('students')
    .select(
      'id, student_number, last_name, first_name, middle_name, urgent_compassionate_allowance, vacation_leave_allowance_per_term'
    )
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (!student) notFound();
  const studentRow = student as {
    id: string;
    student_number: string;
    last_name: string | null;
    first_name: string | null;
    middle_name: string | null;
    urgent_compassionate_allowance: number | null;
    vacation_leave_allowance_per_term: number | null;
  };

  const schoolConfig = await getSchoolConfig();

  const fullName =
    [studentRow.last_name, studentRow.first_name, studentRow.middle_name]
      .filter(Boolean)
      .join(', ')
      .trim() || studentRow.student_number;
  const allowance = studentRow.urgent_compassionate_allowance ?? 5;
  const vlEffectiveAllowance =
    studentRow.vacation_leave_allowance_per_term ??
    schoolConfig.defaultVlAllowancePerTerm;

  // Resolve current AY id (for quota usage) + the matching admissions
  // enroleeNumber (for the allowance PATCH route, which keys by
  // enroleeNumber per KD #4 — studentNumber is the cross-AY anchor, but
  // admissions writes use the per-AY key).
  const { data: currentAy } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const ayCode = currentAy ? (currentAy as { ay_code: string }).ay_code : null;
  const ayId = currentAy ? (currentAy as { id: string }).id : null;

  let enroleeNumber: string | null = null;
  if (ayCode) {
    const admissions = createAdmissionsClient();
    const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
    const { data: appRow } = await admissions
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber')
      .eq('studentNumber', studentRow.student_number)
      .maybeSingle();
    enroleeNumber =
      (appRow as { enroleeNumber: string | null } | null)?.enroleeNumber ??
      null;
  }

  // Quota usage for the rich quota card. AY-wide compassionate `EX`
  // entries against the student's allowance — drives the progress bar
  // visualization + the at-risk badge tone.
  const usage = ayId
    ? await getCompassionateUsage(studentRow.id, ayId)
    : { allowance, used: 0, remaining: allowance };

  // Resolve current term in this AY for the per-term VL quota lookup
  // (KD #94 — VL is per-term, no carry-forward).
  let currentTermId: string | null = null;
  let currentTermLabel: string | null = null;
  if (ayId) {
    const { data: termRow } = await service
      .from('terms')
      .select('id, label')
      .eq('academic_year_id', ayId)
      .eq('is_current', true)
      .maybeSingle();
    if (termRow) {
      currentTermId = (termRow as { id: string }).id;
      currentTermLabel = (termRow as { label: string }).label;
    } else {
      // Fall back to T1 if no term is flagged current (early-AY state).
      const { data: t1 } = await service
        .from('terms')
        .select('id, label, term_number')
        .eq('academic_year_id', ayId)
        .order('term_number', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (t1) {
        currentTermId = (t1 as { id: string }).id;
        currentTermLabel = (t1 as { label: string }).label;
      }
    }
  }

  const vlUsage =
    ayId && currentTermId
      ? await getVacationLeaveUsage(studentRow.id, ayId, currentTermId)
      : {
          allowance: vlEffectiveAllowance,
          usedThisTerm: 0,
          remainingThisTerm: vlEffectiveAllowance,
          termId: '',
        };

  // Resolve the student's active section in the current AY so the hero
  // copy can link to the actual daily writer at /attendance/{sectionId}
  // instead of a placeholder. Withdrawn rows excluded; if the student is
  // in multiple active sections (rare edge case) we link to the first.
  let activeSectionId: string | null = null;
  let activeSectionName: string | null = null;
  if (ayId) {
    const { data: ssRows } = await service
      .from('section_students')
      .select('section_id, sections!inner(id, name, academic_year_id)')
      .eq('student_id', studentRow.id)
      .eq('sections.academic_year_id', ayId)
      .in('enrollment_status', ['active', 'late_enrollee']);
    type SsRow = {
      section_id: string;
      sections:
        | { id: string; name: string }
        | Array<{ id: string; name: string }>;
    };
    const first = (ssRows as SsRow[] | null)?.[0];
    if (first) {
      activeSectionId = first.section_id;
      const sec = Array.isArray(first.sections)
        ? first.sections[0]
        : first.sections;
      activeSectionName = sec?.name ?? null;
    }
  }

  const quotaPct =
    usage.allowance > 0 ? Math.round((usage.used / usage.allowance) * 100) : 0;
  const tone: 'mint' | 'warn' | 'over' =
    usage.used > usage.allowance
      ? 'over'
      : usage.remaining <= 1
        ? 'warn'
        : 'mint';
  const tilePalette = {
    mint: {
      tile: 'from-brand-mint to-brand-sky',
      bar: 'from-brand-mint to-brand-sky',
    },
    warn: {
      tile: 'from-brand-amber to-brand-amber/80',
      bar: 'from-brand-amber to-brand-amber/80',
    },
    over: {
      tile: 'from-destructive to-destructive/80',
      bar: 'from-destructive to-destructive/80',
    },
  } as const;

  // VL parallel: pct, tone, palette.
  const vlPct =
    vlUsage.allowance > 0
      ? Math.round((vlUsage.usedThisTerm / vlUsage.allowance) * 100)
      : 0;
  const vlTone: 'mint' | 'warn' | 'over' =
    vlUsage.usedThisTerm > vlUsage.allowance
      ? 'over'
      : vlUsage.remainingThisTerm <= 0
        ? 'warn'
        : 'mint';
  const vlTilePalette = {
    mint: {
      tile: 'from-brand-sky to-brand-indigo',
      bar: 'from-brand-sky to-brand-indigo',
    },
    warn: {
      tile: 'from-brand-amber to-brand-amber/80',
      bar: 'from-brand-amber to-brand-amber/80',
    },
    over: {
      tile: 'from-destructive to-destructive/80',
      bar: 'from-destructive to-destructive/80',
    },
  } as const;

  return (
    <PageShell>
      <Link
        href="/attendance"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Attendance dashboard
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Attendance · Student detail
          </p>
          <h1 className="font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[40px]">
            {fullName}.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Daily ledger and compassionate-leave quota for the current academic
            year. Daily writes still happen on the section&apos;s daily-entry
            surface{activeSectionId ? ' — ' : '. '}
            {activeSectionId ? (
              <Link
                href={`/attendance/${activeSectionId}`}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {activeSectionName ?? 'open daily entry'}
                <ArrowUpRight className="ml-0.5 inline size-3" />
              </Link>
            ) : (
              <span className="text-muted-foreground/80">
                no active section in {ayCode ?? 'this AY'}
              </span>
            )}
            . This surface is the per-student rollup + quota edit point.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" className="h-7 px-3">
              {studentRow.student_number}
            </Badge>
            {ayCode && (
              <Badge variant="default" className="h-7 px-3">
                {ayCode}
              </Badge>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/records/students/${encodeURIComponent(studentRow.student_number)}`}
            >
              <UserSquare2 className="size-3.5" />
              Open in Records
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
        </div>
      </header>

      {/* Leave quota cards — compassionate (AY-wide) + vacation (per-term).
          Side-by-side at md+, stacked on mobile. Each card carries its own
          progress bar + inline allowance editor. */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* Compassionate-leave quota — rich card with status-keyed visual */}
        <Card className="@container/card gap-0 overflow-hidden p-0">
          <CardHeader className="border-b border-border px-6 py-5">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Compassionate leave · {ayCode ?? 'No AY'}
            </CardDescription>
            <CardTitle className="flex flex-wrap items-baseline gap-3 font-serif text-[20px] font-semibold tracking-tight text-foreground">
              Quota usage
              {tone === 'over' && <Badge variant="blocked">Over quota</Badge>}
              {tone === 'warn' && (
                <Badge variant="warning">Approaching limit</Badge>
              )}
              {tone === 'mint' && <Badge variant="success">On track</Badge>}
            </CardTitle>
            <CardAction>
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
                  tilePalette[tone].tile
                )}
              >
                <Heart className="size-5" />
              </div>
            </CardAction>
          </CardHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-serif text-[44px] font-semibold leading-none tabular-nums text-foreground">
                  {usage.used}
                </span>
                <span className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
                  of {usage.allowance} used · {quotaPct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full bg-gradient-to-r transition-all',
                    tilePalette[tone].bar
                  )}
                  style={{ width: `${Math.min(quotaPct, 100)}%` }}
                />
              </div>
              <p className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                {usage.remaining < 0
                  ? `${Math.abs(usage.remaining)} day${Math.abs(usage.remaining) === 1 ? '' : 's'} over`
                  : `${usage.remaining} day${usage.remaining === 1 ? '' : 's'} remaining this AY`}
              </p>
            </div>
            <CompassionateAllowanceInline
              enroleeNumber={enroleeNumber ?? ''}
              initial={allowance}
              disabled={!enroleeNumber}
              disabledReason={
                !enroleeNumber
                  ? `No admissions record for ${studentRow.student_number} in ${ayCode ?? 'the current AY'}.`
                  : undefined
              }
            />
          </div>
          <CardContent className="border-t border-hairline bg-muted/20 px-6 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Counts EX entries marked as Compassionate, scoped to the whole
              academic year.
            </p>
          </CardContent>
        </Card>

        {/* Vacation-leave quota — per-term (KD #94) */}
        <Card className="@container/card gap-0 overflow-hidden p-0">
          <CardHeader className="border-b border-border px-6 py-5">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Vacation leave · {currentTermLabel ?? 'No active term'}
            </CardDescription>
            <CardTitle className="flex flex-wrap items-baseline gap-3 font-serif text-[20px] font-semibold tracking-tight text-foreground">
              Quota usage
              {vlTone === 'over' && <Badge variant="blocked">Over quota</Badge>}
              {vlTone === 'warn' && <Badge variant="warning">At limit</Badge>}
              {vlTone === 'mint' && <Badge variant="success">On track</Badge>}
            </CardTitle>
            <CardAction>
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
                  vlTilePalette[vlTone].tile
                )}
              >
                <Umbrella className="size-5" />
              </div>
            </CardAction>
          </CardHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-serif text-[44px] font-semibold leading-none tabular-nums text-foreground">
                  {vlUsage.usedThisTerm}
                </span>
                <span className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
                  of {vlUsage.allowance} used · {vlPct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full bg-gradient-to-r transition-all',
                    vlTilePalette[vlTone].bar
                  )}
                  style={{ width: `${Math.min(vlPct, 100)}%` }}
                />
              </div>
              <p className="font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                {vlUsage.usedThisTerm > vlUsage.allowance
                  ? `${vlUsage.usedThisTerm - vlUsage.allowance} day${vlUsage.usedThisTerm - vlUsage.allowance === 1 ? '' : 's'} over`
                  : `${vlUsage.remainingThisTerm} day${vlUsage.remainingThisTerm === 1 ? '' : 's'} remaining this term`}
              </p>
            </div>
            <VacationAllowanceInline
              enroleeNumber={enroleeNumber ?? ''}
              initial={studentRow.vacation_leave_allowance_per_term}
              schoolDefault={schoolConfig.defaultVlAllowancePerTerm}
              disabled={!enroleeNumber}
              disabledReason={
                !enroleeNumber
                  ? `No admissions record for ${studentRow.student_number} in ${ayCode ?? 'the current AY'}.`
                  : undefined
              }
            />
          </div>
          <CardContent className="border-t border-hairline bg-muted/20 px-6 py-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Counts EX entries marked as Vacation leave, scoped to{' '}
              {currentTermLabel ?? 'this term'}. Unused days do not carry
              forward.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily ledger + monthly breakdown — reuses the existing student
          attendance tab component. Internally fetches via studentNumber
          (Hard Rule #4) and renders empty states for not-synced /
          not-enrolled cases on its own. */}
      <StudentAttendanceTab
        studentNumber={studentRow.student_number}
        fullName={fullName}
      />

      {/* Trust strip */}
      <p className="border-t border-hairline pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Daily attendance · sole writer{' '}
        <code className="font-mono text-foreground">
          /attendance/[sectionId]
        </code>{' '}
        · audit prefix{' '}
        <code className="font-mono text-foreground">attendance.*</code>
      </p>
    </PageShell>
  );
}
