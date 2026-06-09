import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  NotebookPen,
  SquarePen,
  TrendingUp,
  UserX,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PriorityPanel } from '@/components/dashboard/priority-panel';
import {
  SubmissionVelocityDrillCard,
  WriteupsBySectionCard,
} from '@/components/evaluation/drills/chart-drill-cards';
import { EvaluationDrillSheet } from '@/components/evaluation/drills/evaluation-drill-sheet';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { evaluationInsights } from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  TERM_SCOPED_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getEvaluationChaseKpis,
  getEvaluationKpisRange,
  getEvaluationRegistrarPriority,
  getEvaluationTeacherPriority,
  getSubmissionVelocityRange,
} from '@/lib/evaluation/dashboard';
import { buildAllRowSets } from '@/lib/evaluation/drill';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Evaluation module landing page. The real work happens on /evaluation/sections
// (Bite 4) — this page is a light orientation surface describing what the
// module does + jumping into the writeup roster.
// Architectural note (KD #57 two-view split): teacher-vs-registrar branches
// currently render via inline conditionals (`isTeacher`, `canToggle &&
// rangeInput`). The full split into
// `components/evaluation/evaluation-{teacher,registrar}-view.tsx` is queued
// as architectural debt — pure code organisation, no behaviour change.
// Deferred because the inline pattern is functionally correct and the split
// is regression-risky for zero user-facing benefit. Revisit when this file
// crosses ~600 lines or a third role enters the mix.
export default async function EvaluationHub({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const resolvedSearch = await searchParams;

  const canToggle =
    sessionUser.role === 'registrar' ||
    sessionUser.role === 'school_admin' ||
    sessionUser.role === 'superadmin';

  // Current AY → its T1-T3 terms + window state. Cheap query + used only
  // by the toggle strip on this page.
  const supabase = await createClient();
  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const { data: termRows } = ay
    ? await supabase
        .from('terms')
        .select('id, label, term_number, is_current, virtue_theme')
        .eq('academic_year_id', ay.id)
        .neq('term_number', 4)
        .order('term_number', { ascending: true })
    : { data: [] };
  type TermLite = {
    id: string;
    label: string;
    term_number: number;
    is_current: boolean;
    virtue_theme: string | null;
  };
  const terms = (termRows ?? []) as TermLite[];

  // Dashboard band — current AY only.
  const ayCode = ay?.ay_code ?? '';

  const windows = ayCode
    ? await getDashboardWindows(ayCode)
    : {
        term: {
          thisTerm: null,
          lastTerm: null,
          byNumber: { 1: null, 2: null, 3: null, 4: null },
        },
        ay: { thisAY: null, lastAY: null },
        activeTermFallback: false,
      };
  const rangeInput = ayCode
    ? resolveRange(resolvedSearch, windows, ayCode)
    : null;
  // Chase metrics are live-state + current-term-scoped + oversight-only — no
  // date window, so they don't depend on rangeInput. T4 → not available → "—".
  const [kpisResult, velocity, drillRowSets, chaseKpis] = rangeInput
    ? await Promise.all([
        getEvaluationKpisRange(rangeInput),
        getSubmissionVelocityRange(rangeInput),
        buildAllRowSets({ ayCode, from: rangeInput.from, to: rangeInput.to }),
        canToggle ? getEvaluationChaseKpis(ayCode) : Promise.resolve(null),
      ])
    : [null, null, null, null];
  const comparisonLabel = kpisResult?.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  // Role-aware PriorityPanel payload — teacher gets pending writeups across
  // their advisory sections; registrar gets pending writeups school-wide.
  // Run in parallel — neither depends on the other.
  const isTeacher = sessionUser.role === 'teacher';
  const [teacherPriority, registrarPriority] = await Promise.all([
    isTeacher && ayCode
      ? getEvaluationTeacherPriority({ ayCode, teacherUserId: sessionUser.id })
      : Promise.resolve(null),
    canToggle && ayCode
      ? getEvaluationRegistrarPriority({ ayCode })
      : Promise.resolve(null),
  ]);

  const insights = kpisResult
    ? evaluationInsights({
        submissionPct: kpisResult.current.submissionPct,
        submitted: kpisResult.current.submitted,
        expected: kpisResult.current.expected,
        outstandingWriteups: chaseKpis?.available
          ? chaseKpis.outstandingWriteups
          : undefined,
        advisersBehind: chaseKpis?.available
          ? chaseKpis.advisersBehind
          : undefined,
      })
    : [];

  // Soft-warn when any T1–T3 term in the current AY lacks a virtue theme.
  // Per KD #28, NULL virtue locks teacher textareas; registrars can still
  // write but face the same content gap on the report card. Surface the gap
  // on the hub so neither role discovers it on a closed dialog.
  const termsMissingVirtue = terms.filter((t) => !t.virtue_theme);

  return (
    <PageShell>
      <DashboardHero
        eyebrow="Student Evaluation · Hub"
        title="Form class adviser write-ups"
        description="Form-class-adviser write-ups and virtue themes — one term at a time. Sole source for T1–T3 report card comments. T4 is FCA-inactive."
        badges={ayCode ? [{ label: ayCode }] : []}
      />

      {termsMissingVirtue.length > 0 && (
        <Alert variant="warning">
          <AlertIcon>
            <AlertTriangle className="size-4" />
          </AlertIcon>
          <AlertTitle>
            Virtue theme not set for {termsMissingVirtue.length} term
            {termsMissingVirtue.length === 1 ? '' : 's'}
          </AlertTitle>
          <AlertDescription>
            {termsMissingVirtue.map((t) => t.label).join(' · ')} — write-up
            textareas stay locked for teachers until a virtue theme is
            configured.{' '}
            {canToggle ? (
              <Link
                href="/evaluation/virtue-themes"
                className="font-medium underline underline-offset-2"
              >
                Set virtue themes →
              </Link>
            ) : (
              <span>
                Ask the registrar to set the virtue theme in Evaluation → Virtue
                themes.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {teacherPriority && <PriorityPanel payload={teacherPriority} />}
      {registrarPriority && <PriorityPanel payload={registrarPriority} />}

      {canToggle && rangeInput && kpisResult && velocity && (
        <>
          {windows.activeTermFallback && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
              Active term hasn&apos;t started yet. Showing the previous
              term&apos;s data as a default — pick a different range above to
              override.
            </div>
          )}

          <ComparisonToolbar
            ayCode={ayCode}
            ayCodes={[ayCode]}
            range={{ from: rangeInput.from, to: rangeInput.to }}
            comparison={
              rangeInput.cmpFrom && rangeInput.cmpTo
                ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
                : null
            }
            termWindows={windows.term}
            ayWindows={windows.ay}
            showAySwitcher={false}
            presets={TERM_SCOPED_PRESETS}
          />

          {insights.length > 0 && <InsightsPanel insights={insights} />}

          <section className="grid gap-4 xl:grid-cols-4">
            <MetricCard
              label="Submission %"
              value={kpisResult.current.submissionPct}
              format="percent"
              icon={TrendingUp}
              intent={
                kpisResult.current.submissionPct >= 80 ? 'good' : 'warning'
              }
              delta={kpisResult.delta ?? undefined}
              deltaGoodWhen="up"
              comparisonLabel={comparisonLabel}
              sparkline={velocity.current.slice(-14)}
              drillSheet={() => (
                <EvaluationDrillSheet
                  target="submission-status"
                  ayCode={ayCode}
                  initialFrom={rangeInput.from}
                  initialTo={rangeInput.to}
                  initialWriteups={drillRowSets?.writeups}
                />
              )}
            />
            <MetricCard
              label="Submitted"
              value={kpisResult.current.submitted}
              icon={CheckCircle2}
              intent="default"
              subtext={`of ${kpisResult.current.expected} expected`}
              drillSheet={() => (
                <EvaluationDrillSheet
                  target="submitted"
                  ayCode={ayCode}
                  initialFrom={rangeInput.from}
                  initialTo={rangeInput.to}
                  initialWriteups={drillRowSets?.writeups}
                />
              )}
            />
            <MetricCard
              label="Outstanding write-ups"
              value={chaseKpis?.available ? chaseKpis.outstandingWriteups : '—'}
              icon={UserX}
              intent={
                !chaseKpis?.available
                  ? 'default'
                  : chaseKpis.outstandingWriteups > 0
                    ? 'warning'
                    : 'good'
              }
              subtext={
                !chaseKpis?.available
                  ? 'No write-up term right now (T4 has no FCA comment)'
                  : chaseKpis.outstandingWriteups > 0
                    ? 'Students still missing a submitted write-up this term'
                    : 'All caught up this term'
              }
              drillSheet={
                chaseKpis?.available
                  ? () => (
                      <EvaluationDrillSheet
                        target="outstanding-writeups"
                        ayCode={ayCode}
                      />
                    )
                  : undefined
              }
            />
            <MetricCard
              label="Advisers behind"
              value={chaseKpis?.available ? chaseKpis.advisersBehind : '—'}
              icon={Users}
              intent={
                !chaseKpis?.available
                  ? 'default'
                  : chaseKpis.advisersBehind > 0
                    ? 'warning'
                    : 'good'
              }
              subtext={
                !chaseKpis?.available
                  ? 'No write-up term right now (T4 has no FCA comment)'
                  : chaseKpis.advisersBehind > 0
                    ? chaseKpis.hasUnassignedSection
                      ? 'Form advisers with ≥1 outstanding · includes unassigned sections'
                      : 'Form advisers with ≥1 outstanding write-up this term'
                    : 'Every adviser is caught up this term'
              }
              drillSheet={
                chaseKpis?.available
                  ? () => (
                      <EvaluationDrillSheet
                        target="advisers-behind"
                        ayCode={ayCode}
                      />
                    )
                  : undefined
              }
            />
          </section>

          {velocity.current.length > 1 && (
            <SubmissionVelocityDrillCard
              current={velocity.current}
              comparison={velocity.comparison}
              ayCode={ayCode}
              rangeFrom={rangeInput.from}
              rangeTo={rangeInput.to}
              initialWriteups={drillRowSets?.writeups}
            />
          )}

          {drillRowSets && drillRowSets.bySection.length > 0 && (
            <WriteupsBySectionCard
              data={drillRowSets.bySection}
              ayCode={ayCode}
              rangeFrom={rangeInput.from}
              rangeTo={rangeInput.to}
              initialBySection={drillRowSets.bySection}
              initialWriteups={drillRowSets.writeups}
            />
          )}
        </>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <HubCard
          href="/evaluation/sections"
          icon={SquarePen}
          eyebrow="Write-ups"
          title={isTeacher ? 'My sections' : 'Section roster'}
          description={
            isTeacher
              ? "Write or revise the adviser paragraph for each student in your section. Guided by the term's virtue theme. Autosaves per keystroke; Submit marks a write-up finalised."
              : "Browse every section's adviser writeups school-wide. Filter by term, virtue theme, or completion state. Read-only oversight unless you're the assigned form adviser."
          }
          cta="Open roster"
        />
        <HubCard
          href="/evaluation/virtue-themes"
          icon={NotebookPen}
          eyebrow="Configuration"
          title="Virtue themes"
          description="Set the virtue theme per term. The theme appears as a prompt to advisers and as the parenthetical on printed report cards."
          cta="Edit virtue themes"
        />
        <HubCard
          href="/sis/calendar"
          icon={CalendarDays}
          eyebrow="Scheduling"
          title="PTC schedule"
          description="Parent-teacher-conference dates from the school calendar — the deadline driver for each write-up cycle."
          cta="Open calendar"
        />
      </section>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ClipboardCheck className="size-3" strokeWidth={2.25} />
        <span>
          KD #49 — Evaluation owns the FCA write-up · PTC dates pulled from the
          school calendar (KD #76)
        </span>
      </div>
    </PageShell>
  );
}

function HubCard({
  href,
  icon: Icon,
  eyebrow,
  title,
  description,
  cta,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <Link href={href}>
      <Card className="@container/card h-full transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {eyebrow}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {title}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </CardContent>
        <CardFooter>
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            {cta}
            <ArrowUpRight className="size-3.5" />
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}
