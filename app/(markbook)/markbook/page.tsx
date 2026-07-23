import {
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  FileText,
  History,
  Lock,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';

import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PriorityPanel } from '@/components/dashboard/priority-panel';
import { ChangeRequestPanel } from '@/components/markbook/change-request-panel';
import {
  GradeDistributionDrillCard,
  PublicationCoverageDrillCard,
} from '@/components/markbook/drills/chart-drill-cards';
import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
import { SheetReadinessCard } from '@/components/markbook/drills/sheet-readiness-card';
import { TeacherEntryVelocityCard } from '@/components/markbook/drills/teacher-entry-velocity-card';
import { RecentMarkbookActivity } from '@/components/markbook/recent-markbook-activity';
import { Button } from '@/components/ui/button';
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
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { getRoleFromClaims } from '@/lib/auth/roles';
import { isUserAssignedApprover } from '@/lib/sis/approvers/queries';
import {
  formatRangeLabel,
  resolveRange,
  TERM_SCOPED_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getChangeRequestSummary,
  getGradeDistribution,
  getGradeEntryVelocityRange,
  getMarkbookKpisRange,
  getMarkbookRegistrarPriority,
  getMarkbookTeacherPriority,
  getPublicationCoverage,
  getRecentMarkbookActivity,
} from '@/lib/markbook/dashboard';
import { buildAllRowSets, getTeacherEntryVelocity } from '@/lib/markbook/drill';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';

type Tool = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: LucideIcon;
};

const ADMIN_TOOLS: Tool[] = [
  {
    icon: Users,
    eyebrow: 'Rosters',
    title: 'Browse sections',
    description:
      'Read-only roster launcher into per-section grading sheets, attendance, and report cards. Section + adviser config lives in SIS Admin (KD #48).',
    href: '/markbook/sections',
    cta: 'Open roster',
  },
  {
    icon: History,
    eyebrow: 'Compliance',
    title: 'Audit Log',
    description:
      'A history of every grade change made after a sheet is locked, including which fields changed and the approval reference.',
    href: '/markbook/audit-log',
    cta: 'Open audit log',
  },
];

// Architectural note (KD #57 two-view split): teacher-vs-registrar branches
// currently render via inline conditionals (`canSeeAdmin && ...`,
// `isTeacher && ...`). The full split into
// `components/markbook/markbook-{teacher,registrar}-view.tsx` is queued as
// architectural debt — pure code organisation, no behaviour change. Deferred
// because the inline pattern is functionally correct and the split is
// regression-risky for zero user-facing benefit. Revisit when this file
// crosses ~800 lines or a third role enters the mix.
export default async function MarkbookHome({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const email = (claims?.email as string | undefined) ?? undefined;
  const role = getRoleFromClaims(claims);

  const canSeeAdmin =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';
  const canSeeGrading =
    role === 'teacher' ||
    role === 'academic_coordinator' ||
    role === 'superadmin';
  const canSeeReportCards =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayId = currentAy?.id ?? null;
  const ayCode = currentAy?.ay_code ?? '';

  const [windows, ayCodes] = await Promise.all([
    ayCode
      ? getDashboardWindows(ayCode)
      : Promise.resolve({
          term: {
            thisTerm: null,
            lastTerm: null,
            byNumber: { 1: null, 2: null, 3: null, 4: null },
          },
          ay: { thisAY: null, lastAY: null },
          activeTermFallback: false,
        }),
    listAyCodes(service),
  ]);
  const rangeInput = resolveRange(resolvedSearchParams, windows, ayCode);

  const [
    kpisResult,
    velocity,
    gradeDist,
    changeRequests,
    pubCoverage,
    activity,
    currentTerm,
    drillRowSets,
    teacherVelocity,
  ] = await Promise.all([
    canSeeAdmin ? getMarkbookKpisRange(rangeInput) : Promise.resolve(null),
    canSeeAdmin
      ? getGradeEntryVelocityRange(rangeInput)
      : Promise.resolve(null),
    canSeeAdmin && ayId ? getGradeDistribution(ayId) : Promise.resolve(null),
    canSeeAdmin ? getChangeRequestSummary(ayCode, 30) : Promise.resolve(null),
    canSeeAdmin && ayId ? getPublicationCoverage(ayId) : Promise.resolve(null),
    canSeeAdmin ? getRecentMarkbookActivity(8) : Promise.resolve(null),
    ayId
      ? service
          .from('terms')
          .select('term_number, is_current, start_date, end_date')
          .eq('academic_year_id', ayId)
          .order('term_number', { ascending: true })
          .then((r) => {
            type TermRow = {
              term_number: number;
              is_current: boolean | null;
              start_date: string | null;
              end_date: string | null;
            };
            const rows = (r.data ?? []) as TermRow[];
            if (rows.length === 0) return null;
            const today = sgToday();
            const current = rows.find((t) => t.is_current === true);
            const containingToday = rows.find(
              (t) =>
                t.start_date &&
                t.end_date &&
                t.start_date <= today &&
                t.end_date >= today
            );
            const lastFinished = [...rows]
              .filter((t) => t.end_date && t.end_date < today)
              .sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0];
            const fallback = rows[rows.length - 1];
            return (
              current?.term_number ??
              containingToday?.term_number ??
              lastFinished?.term_number ??
              fallback?.term_number ??
              null
            );
          })
      : Promise.resolve(null),
    canSeeAdmin && ayCode
      ? buildAllRowSets({ ayCode, from: rangeInput.from, to: rangeInput.to })
      : Promise.resolve(null),
    // Teacher velocity is registrar+ only (gated by canSeeAdmin); the rollup
    // uses the same loadEntryRows cache as the entry-kind drills. Pass the
    // page range so the card is enteredAt-clamped to match its drill (the
    // 'teacher-entry-velocity' drill clamps the same way in lib/markbook/drill.ts).
    canSeeAdmin && ayCode
      ? getTeacherEntryVelocity(ayCode, {
          from: rangeInput.from,
          to: rangeInput.to,
        })
      : Promise.resolve(null),
  ]);

  const comparisonLabel = kpisResult?.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  // Role-aware PriorityPanel payload — teacher gets "your open subject sheets",
  // registrar gets "decisions queued + per-term unlocked sheets". Run in
  // parallel so navigation doesn't serialise two priority queries.
  const userId = (claims?.sub as string | undefined) ?? null;
  const isTeacher = role === 'teacher';
  const [teacherPriority, registrarPriority] = await Promise.all([
    isTeacher && userId && ayCode
      ? getMarkbookTeacherPriority({ ayCode, teacherUserId: userId })
      : Promise.resolve(null),
    canSeeAdmin && ayCode && kpisResult && userId
      ? (role === 'superadmin'
          ? Promise.resolve(true)
          : isUserAssignedApprover(userId, 'markbook.change_request')
        ).then((canActOnChangeRequests) =>
          getMarkbookRegistrarPriority({
            ayCode,
            changeRequestsPending: kpisResult.current.changeRequestsPending,
            from: rangeInput.from,
            to: rangeInput.to,
            canActOnChangeRequests,
          })
        )
      : Promise.resolve(null),
  ]);

  // ── Role-aware lede: derived from live priority data, neutral when clear ──
  // Teacher: surface the open-sheets signal from their priority panel.
  // Registrar: surface pending change requests first, then open sheets.
  // Neutral fallback when all caught up or no priority data yet.
  const heroDescription: string = (() => {
    if (isTeacher) {
      const total = teacherPriority?.headline.value ?? 0;
      if (total > 0) {
        return `You have ${total} open grading ${total === 1 ? 'sheet' : 'sheets'} across your sections. Enter grades now to keep your records current.`;
      }
      return 'All your grading sheets are up to date. Check your sections below or review recent activity.';
    }
    if (canSeeAdmin && registrarPriority) {
      const pending = kpisResult?.current.changeRequestsPending ?? 0;
      const openSheets = registrarPriority.headline.value ?? 0;
      if (pending > 0) {
        return `${pending} grade change ${pending === 1 ? 'request needs' : 'requests need'} your decision. Grading sheets, publications, and recent activity are below.`;
      }
      if (openSheets > 0) {
        return `${openSheets} grading ${openSheets === 1 ? 'sheet is' : 'sheets are'} still open. Lock them once teachers are done to close out the term.`;
      }
      return 'No outstanding actions right now. Grading sheets, publications, and recent activity are below.';
    }
    return 'Grading sheets, change requests, publications, and recent module activity.';
  })();

  return (
    <PageShell>
      <DashboardHero
        eyebrow="Markbook · Dashboard"
        title={`Welcome back${email ? `, ${email.split('@')[0]}` : ''}`}
        description={heroDescription}
        badges={
          currentAy
            ? [{ label: currentAy.ay_code }, { label: 'Current', tone: 'mint' }]
            : []
        }
      />

      {teacherPriority && <PriorityPanel payload={teacherPriority} />}

      {/* Teacher callout: nudge to act when open sheets exist. Omitted when
          all caught up so it never fires as a false alarm. */}
      {isTeacher &&
        teacherPriority &&
        (teacherPriority.headline.value ?? 0) > 0 && (
          <RecommendationCallout tone="watch">
            Your open sheets need grades before the term locks. Head to grading
            to fill them in.
          </RecommendationCallout>
        )}

      {canSeeAdmin && ayCode && windows.activeTermFallback && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
          Active term hasn&apos;t started yet. Showing the previous term&apos;s
          data as a default — pick a different range above to override.
        </div>
      )}

      {canSeeAdmin && ayCode && (
        <ComparisonToolbar
          ayCode={ayCode}
          ayCodes={ayCodes}
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
      )}

      {registrarPriority && <PriorityPanel payload={registrarPriority} />}

      {/* Registrar callout: one directive sentence from the top signal.
          'act' fires only when change requests are pending (approver-gated
          inside registrarPriority itself). 'watch' fires when sheets are
          open. Omitted when the panel is clear so it never adds noise. */}
      {canSeeAdmin &&
        registrarPriority &&
        (() => {
          const pending = kpisResult?.current.changeRequestsPending ?? 0;
          const openSheets = registrarPriority.headline.value ?? 0;
          if (pending > 0 && registrarPriority.iconKey === 'warning') {
            return (
              <RecommendationCallout tone="act">
                {pending === 1
                  ? 'A change request is waiting on your decision — approve or reject to unblock the teacher.'
                  : `${pending} change requests are waiting on your decision — approve or reject to unblock teachers.`}
              </RecommendationCallout>
            );
          }
          if (openSheets > 0 && registrarPriority.iconKey !== 'warning') {
            return (
              <RecommendationCallout tone="watch">
                {openSheets === 1
                  ? '1 grading sheet is still open. Lock it once the teacher is done to close out the term.'
                  : `${openSheets} grading sheets are still open. Lock them once teachers are done to close out the term.`}
              </RecommendationCallout>
            );
          }
          return null;
        })()}

      {/* Range-aware KPIs — new MetricCards driven by ComparisonToolbar */}
      {canSeeAdmin && kpisResult && ayCode && (
        <section className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Grades entered"
            value={kpisResult.current.gradesEntered}
            icon={ClipboardList}
            intent="default"
            delta={kpisResult.delta ?? undefined}
            deltaGoodWhen="up"
            comparisonLabel={comparisonLabel}
            sparkline={velocity?.current.slice(-14)}
            drillSheet={() => (
              <MarkbookDrillSheet
                target="grade-entries"
                ayCode={ayCode}
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
              />
            )}
          />
          <MetricCard
            label="Sheets locked (range)"
            value={kpisResult.current.sheetsLocked}
            icon={Lock}
            intent="good"
            comparisonLabel={`of ${kpisResult.current.sheetsTotal} sheets in this AY`}
            drillSheet={() => (
              <MarkbookDrillSheet
                target="sheets-locked"
                ayCode={ayCode}
                initialFrom={rangeInput.from}
                initialTo={rangeInput.to}
                initialSheets={drillRowSets?.sheets}
              />
            )}
          />
          <MetricCard
            label="Change requests pending"
            value={kpisResult.current.changeRequestsPending}
            icon={TrendingUp}
            intent={
              kpisResult.current.changeRequestsPending > 0 ? 'warning' : 'good'
            }
            subtext="Open across all terms"
            drillSheet={() => (
              // Live, un-windowed count → the drill must list ALL pending in
              // the AY. Omit from/to so the drill route falls back to the
              // AY-wide row set, then segment="pending" filters status. (Do
              // NOT pass initialChangeRequests — those are range-clamped by
              // buildAllRowSets and would under-list.)
              <MarkbookDrillSheet
                target="change-requests"
                segment="pending"
                ayCode={ayCode}
              />
            )}
          />
        </section>
      )}

      {/* Grade entry velocity — the one legit activity trend (full width) */}
      {canSeeAdmin && velocity && velocity.current.length > 1 && (
        <section>
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Grade entry velocity
              </CardDescription>
              <CardTitle className="font-serif text-xl">
                Entries per day
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                label="Entries"
                current={velocity.current}
                comparison={velocity.comparison}
              />
            </CardContent>
          </Card>
        </section>
      )}

      {/* Grade distribution + publication coverage */}
      {canSeeAdmin && ayCode && (gradeDist || pubCoverage) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {gradeDist && (
            <GradeDistributionDrillCard
              data={gradeDist}
              termLabel={
                currentTerm != null ? `Term ${currentTerm}` : 'Current term'
              }
              ayCode={ayCode}
              rangeFrom={rangeInput.from}
              rangeTo={rangeInput.to}
            />
          )}
          {pubCoverage && (
            <PublicationCoverageDrillCard
              data={pubCoverage}
              ayCode={ayCode}
              initialSheets={drillRowSets?.sheets}
            />
          )}
        </section>
      )}

      {/* Change requests (per-status + avg-decision) + per-section sheet readiness */}
      {canSeeAdmin && ayCode && (changeRequests || drillRowSets) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {changeRequests && <ChangeRequestPanel summary={changeRequests} />}
          {drillRowSets && (
            <SheetReadinessCard sheets={drillRowSets.sheets} ayCode={ayCode} />
          )}
        </section>
      )}

      {canSeeAdmin && ayCode && teacherVelocity && (
        <section>
          <TeacherEntryVelocityCard data={teacherVelocity} ayCode={ayCode} />
        </section>
      )}

      {canSeeAdmin && activity && <RecentMarkbookActivity rows={activity} />}

      {canSeeAdmin && (
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Admin
            </p>
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Manage rosters, sync &amp; audit
            </h2>
          </div>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
              {ADMIN_TOOLS.map((t) => (
                <QuickLinkCard
                  key={t.href}
                  icon={t.icon}
                  eyebrow={t.eyebrow}
                  title={t.title}
                  description={t.description}
                  href={t.href}
                  cta={t.cta}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {(canSeeGrading || canSeeReportCards) && (
        <div>
          <p className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Jump back in
          </p>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
              {canSeeGrading && (
                <QuickLinkCard
                  icon={ClipboardList}
                  eyebrow="Grading"
                  title="Grading Sheets"
                  description="Enter and review quarterly grades for your sections."
                  href="/markbook/grading"
                  cta="Open grading"
                  primary={!canSeeAdmin}
                />
              )}
              {canSeeReportCards && (
                <QuickLinkCard
                  icon={FileText}
                  eyebrow="Report Cards"
                  title="Report Cards"
                  description="Preview, print, and publish report cards for the current academic year."
                  href="/markbook/report-cards"
                  cta="Browse report cards"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <BarChart3 className="size-3" strokeWidth={2.25} />
        <span>{currentAy?.ay_code ?? '—'}</span>
        <span className="text-border">·</span>
        <span>Secure sign-in</span>
      </div>
    </PageShell>
  );
}

function QuickLinkCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  href,
  cta,
  primary = false,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <Card
      className={
        '@container/card group relative transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md' +
        (primary ? ' ring-1 ring-primary/20' : '')
      }
    >
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold leading-snug tracking-tight text-foreground @[260px]/card:text-[22px]">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-4 text-sm">
        <p className="leading-relaxed text-muted-foreground">{description}</p>
        <Button asChild size="sm">
          <Link href={href}>
            {cta}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
