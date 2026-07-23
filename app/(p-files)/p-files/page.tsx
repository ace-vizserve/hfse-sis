import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  FileStack,
  FolderKanban,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';

import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PriorityPanel } from '@/components/dashboard/priority-panel';
import {
  DocumentCompletenessTable,
  type PFilesStatusFilter as StatusFilter,
} from '@/components/shared/document-completeness-table';
import { DocumentChaseQueueStrip } from '@/components/sis/document-chase-queue-strip';
import {
  CompletenessCsvButton,
  CompletionByLevelDrillCard,
  SlotStatusDrillCard,
} from '@/components/p-files/drills/chart-drill-cards';
import { PFilesDrillSheet } from '@/components/p-files/drills/pfiles-drill-sheet';
import { RevisionsOverTimeChart } from '@/components/p-files/revisions-over-time-chart';
import { SummaryCards } from '@/components/p-files/summary-cards';
import { ExpiringDocumentsPanel } from '@/components/sis/expiring-documents-panel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getCurrentAcademicYear,
  listAyCodes as listAcademicAyCodes,
} from '@/lib/academic-year';
import { pfilesInsights } from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  FLEXIBLE_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getCompletionByLevel,
  getPFilesKpisRange,
  getPFilesPriority,
  getRevisionVelocityRange,
  getRevisionsOverTime,
  getSlotStatusMix,
} from '@/lib/p-files/dashboard';
import { getDocumentDashboardData } from '@/lib/p-files/queries';
import { freshenAyDocuments } from '@/lib/p-files/freshen-document-statuses';
import { getExpiringDocuments } from '@/lib/sis/dashboard';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Canonical set of status-filter values the sidebar Quicklinks use as
// `?status=...`. P-Files only chases the renewal lens for enrolled
// students — initial-chase statuses (To follow, Rejected, Pending review)
// belong on Admissions, so 'expired' is the only focused-view target here.
const STATUS_FILTER_VALUES: readonly StatusFilter[] = ['all', 'expired'];

function parseStatusFilter(raw: string | undefined): StatusFilter | undefined {
  if (!raw) return undefined;
  return (STATUS_FILTER_VALUES as readonly string[]).includes(raw)
    ? (raw as StatusFilter)
    : undefined;
}

// Companion to ?status — sidebar Quicklinks for renewal-outreach use
// `?expiring=30|60|90` to narrow the roster to students with at least
// one Valid expiring slot whose expiry falls within the window.
type ExpiringWindow = 30 | 60 | 90;

function parseExpiringWindow(
  raw: string | undefined
): ExpiringWindow | undefined {
  if (raw === '30' || raw === '60' || raw === '90')
    return Number(raw) as ExpiringWindow;
  return undefined;
}

// Per-status focused-view metadata. When a sidebar Quicklink sets `?status=`
// to a non-`all` value, the page renders a stripped-down "operational list"
// layout — no KPIs, no charts, just the table + filters at the top — using
// these strings for the hero title/description.
const STATUS_VIEW_META: Record<
  Exclude<StatusFilter, 'all'>,
  { eyebrow: string; title: string; description: string }
> = {
  expired: {
    eyebrow: 'P-Files · Expired documents',
    title: 'Students with expired documents',
    description:
      'Passport, pass, or guardian docs whose expiry date has passed. Chase parents to re-upload current documents.',
  },
};

const EXPIRING_VIEW_META: Record<
  ExpiringWindow,
  { eyebrow: string; title: string; description: string }
> = {
  30: {
    eyebrow: 'P-Files · Expiring within 30 days',
    title: 'Documents expiring within 30 days',
    description:
      'Passport, pass, and guardian docs lapsing in the next 30 days. Use the bulk action to remind parents in one go.',
  },
  60: {
    eyebrow: 'P-Files · Expiring within 60 days',
    title: 'Documents expiring within 60 days',
    description:
      'Documents lapsing in the next 60 days. Send reminders ahead of expiry to give parents lead time.',
  },
  90: {
    eyebrow: 'P-Files · Expiring within 90 days',
    title: 'Documents expiring within 90 days',
    description:
      'Quarterly view of upcoming expirations. Useful for planning renewal outreach.',
  },
};

export default async function PFilesDashboard({
  searchParams,
}: {
  searchParams: Promise<
    DashboardSearchParams & { status?: string; expiring?: string }
  >;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'p_file_officer' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }
  // KD #2 + KD #31: p-file/superadmin = officer (writes); school_admin/admin =
  // oversight (read-only monitoring lens). The two roles share KPIs +
  // completion charts + revision trends, but the chase queue, priority
  // panel, and chase narrative are officer-only — admins can't act on
  // them and the framing ("you owe these reminders") doesn't fit.
  const isOfficer =
    sessionUser.role === 'p_file_officer' || sessionUser.role === 'superadmin';

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <NoCurrentAyCard />
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const ayParam =
    typeof resolvedSearch.ay === 'string' ? resolvedSearch.ay : undefined;
  const statusParam =
    typeof resolvedSearch.status === 'string'
      ? resolvedSearch.status
      : undefined;
  const expiringParam =
    typeof resolvedSearch.expiring === 'string'
      ? resolvedSearch.expiring
      : undefined;
  const ayCodes = await listAcademicAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;
  const initialStatusFilter = parseStatusFilter(statusParam);
  const expiringWindow = parseExpiringWindow(expiringParam);

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(
    resolvedSearch,
    windows,
    selectedAy,
    undefined,
    {
      defaultPreset: 'thisMonth',
    }
  );

  // Auto-flip runs in parallel with subsequent fetches instead of blocking
  // serially. Cached 60s, tag-invalidated by sis:${ayCode}, so most
  // navigations are a no-op anyway. We await later to guarantee the
  // audit-log entries land before render returns.
  const freshenPromise = freshenAyDocuments(selectedAy);

  // ──────────────────────────────────────────────────────────────────
  // Focused-view branch — when a sidebar Quicklink set ?status=missing |
  // expired | uploaded | complete, render a stripped-down operational
  // list (just hero + AY/range toolbar + the filtered table + trust
  // strip). KPIs, charts, chase strip, and heatmap are dropped because
  // they always show AY-wide data and would mislead users who expected
  // a focused list view.
  // ──────────────────────────────────────────────────────────────────
  if (
    (initialStatusFilter && initialStatusFilter !== 'all') ||
    expiringWindow
  ) {
    const meta = expiringWindow
      ? EXPIRING_VIEW_META[expiringWindow]
      : STATUS_VIEW_META[initialStatusFilter as Exclude<StatusFilter, 'all'>];
    // freshen runs in parallel with the focused-view dashboard fetch.
    const [{ students, summary }] = await Promise.all([
      getDocumentDashboardData(selectedAy),
      freshenPromise,
    ]);

    let visibleStudents = students;
    if (expiringWindow) {
      // Force-dynamic server component (cookies + searchParams); fresh
      // Date.now() per request is intentional — the page is never cached
      // on the client, so render-time impurity is fine here.
      // eslint-disable-next-line react-hooks/purity
      const todayMs = Date.now();
      const horizonMs = todayMs + expiringWindow * 86_400_000;
      visibleStudents = students.filter((s) =>
        s.slots.some((slot) => {
          if (slot.status !== 'valid' || !slot.expiryDate) return false;
          const t = new Date(slot.expiryDate).getTime();
          return t >= todayMs && t <= horizonMs;
        })
      );
    }

    const filterLabel = expiringWindow
      ? `expiring ≤${expiringWindow}d`
      : (initialStatusFilter ?? 'all');
    // Bulk notify is an officer write action — oversight roles see the same
    // focused list but without the bulk-remind footer.
    const enableBulk =
      isOfficer && (!!expiringWindow || initialStatusFilter === 'expired');

    return (
      <PageShell>
        <DashboardHero
          eyebrow={meta.eyebrow}
          title={meta.title}
          description={meta.description}
          badges={[
            { label: selectedAy },
            {
              label: isCurrentAy ? 'Current' : 'Historical',
              tone: isCurrentAy ? 'mint' : 'muted',
            },
          ]}
        />

        <ComparisonToolbar
          ayCode={selectedAy}
          ayCodes={ayCodes}
          range={{ from: rangeInput.from, to: rangeInput.to }}
          comparison={
            rangeInput.cmpFrom && rangeInput.cmpTo
              ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
              : null
          }
          termWindows={windows.term}
          ayWindows={windows.ay}
          presets={FLEXIBLE_PRESETS}
          trustStrip={
            <p className="text-[11px] text-muted-foreground">
              Date range filters the{' '}
              <strong className="font-semibold text-foreground">
                Revisions
              </strong>{' '}
              KPI + chart only — slot status, expiring, and total counts are
              AY-wide.
            </p>
          }
        />

        {/* Escape hatch back to the full dashboard. The AY param is preserved
            so the user doesn't lose their AY selection. */}
        <Link
          href={`/p-files?ay=${encodeURIComponent(selectedAy)}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>

        <CompletenessCsvButton ayCode={selectedAy} />
        <DocumentCompletenessTable
          module="p-files"
          key={`${selectedAy}:${filterLabel}`}
          students={visibleStudents}
          ayCode={isCurrentAy ? undefined : selectedAy}
          initialStatusFilter={initialStatusFilter}
          bulkRemindEnabled={enableBulk}
          bulkRemindWindowDays={expiringWindow}
        />

        <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <FolderKanban className="size-3" strokeWidth={2.25} />
          <span>{selectedAy}</span>
          <span className="text-border">·</span>
          <span>
            {visibleStudents.length.toLocaleString('en-SG')} of{' '}
            {summary.totalStudents.toLocaleString('en-SG')} students
          </span>
          <span className="text-border">·</span>
          <span>Filter: {filterLabel}</span>
        </div>
      </PageShell>
    );
  }

  const [
    { students, summary },
    byLevel,
    expiring,
    revisions,
    kpisResult,
    velocity,
    slotMix,
    priority,
  ] = await Promise.all([
    getDocumentDashboardData(selectedAy),
    getCompletionByLevel(selectedAy),
    getExpiringDocuments(selectedAy, 60, 6),
    getRevisionsOverTime(selectedAy, 12),
    getPFilesKpisRange(rangeInput),
    getRevisionVelocityRange(rangeInput),
    getSlotStatusMix(selectedAy),
    // Priority panel is officer-only; skip the fetch entirely for oversight
    // roles so the dashboard renders one fewer trip on every load.
    isOfficer
      ? getPFilesPriority({ ayCode: selectedAy })
      : Promise.resolve(null),
  ]);

  // Freshen runs in parallel with the data fetches above; awaited here so
  // audit-log entries land before render returns.
  await freshenPromise;

  const comparisonLabel = kpisResult.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  const insights = pfilesInsights({
    revisionsInRange: kpisResult.current.revisionsInRange,
    revisionsInRangePrior: kpisResult.comparison?.revisionsInRange,
    expiringSoon: kpisResult.current.expiringSoon,
    totalDocuments: kpisResult.current.totalDocuments,
    revisionsDelta: kpisResult.delta ?? undefined,
  });

  return (
    <PageShell>
      <DashboardHero
        eyebrow={
          isOfficer
            ? 'P-Files · Document tracking'
            : 'P-Files · Read-only oversight'
        }
        title={
          isOfficer
            ? 'Student document completeness'
            : 'Student documents — monitoring'
        }
        description={
          isOfficer
            ? kpisResult.current.expiringSoon30 > 0
              ? `${kpisResult.current.expiringSoon30} document${kpisResult.current.expiringSoon30 === 1 ? '' : 's'} expire within 30 days — send reminders before families let them lapse.`
              : kpisResult.current.expiringSoon > 0
                ? `${kpisResult.current.expiringSoon} document${kpisResult.current.expiringSoon === 1 ? '' : 's'} expire within 60 days. Nothing due in the next 30 — but renewal outreach now saves a chase later.`
                : 'All tracked documents are current. Keep an eye on the 60-day window as the term progresses.'
            : 'Read-only view of student document completeness. The P-File Officer owns chasing, validation, and renewal — this surface is for oversight.'
        }
        badges={[
          { label: selectedAy },
          {
            label: isCurrentAy ? 'Current' : 'Historical',
            tone: isCurrentAy ? 'mint' : 'muted',
          },
        ]}
      />

      <ComparisonToolbar
        ayCode={selectedAy}
        ayCodes={ayCodes}
        range={{ from: rangeInput.from, to: rangeInput.to }}
        comparison={
          rangeInput.cmpFrom && rangeInput.cmpTo
            ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
            : null
        }
        termWindows={windows.term}
        ayWindows={windows.ay}
        presets={FLEXIBLE_PRESETS}
        trustStrip={
          <p className="text-[11px] text-muted-foreground">
            Date range filters the{' '}
            <strong className="font-semibold text-foreground">Revisions</strong>{' '}
            KPI + chart only — slot status, expiring, and total counts are
            AY-wide.
          </p>
        }
      />

      {/* Officer-only operational top-of-fold (KD #57) — chase priority +
          chase queue strip. Oversight roles (school_admin/admin) skip these
          because they can't act on the rows, and the framing speaks in the
          officer's voice ("you owe these reminders"). */}
      {isOfficer && priority && <PriorityPanel payload={priority} />}
      {isOfficer && (
        <DocumentChaseQueueStrip ayCode={selectedAy} lens="p-files" />
      )}

      <InsightsPanel insights={insights} />

      {/* Officer-only renewal callout — fires only when documents are due
          within 30 days. The 60-day band is mentioned in the hero; this
          callout is the "act now" signal for the tightest window only. */}
      {isOfficer && kpisResult.current.expiringSoon30 > 0 && (
        <RecommendationCallout tone="act">
          Chase {kpisResult.current.expiringSoon30} document
          {kpisResult.current.expiringSoon30 === 1 ? '' : 's'} expiring within
          30 days — use the bulk remind below to contact families in one step.
        </RecommendationCallout>
      )}

      {/* Range-aware KPIs */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="Revisions (range)"
          value={kpisResult.current.revisionsInRange}
          icon={FileStack}
          intent="default"
          delta={kpisResult.delta ?? undefined}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
          sparkline={velocity.current.slice(-14)}
          drillSheet={() => (
            <PFilesDrillSheet
              target="revisions-on-day"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
        <MetricCard
          label="Expiring ≤30d"
          value={kpisResult.current.expiringSoon30}
          icon={CalendarClock}
          intent={kpisResult.current.expiringSoon30 > 0 ? 'warning' : 'good'}
          subtext="From today"
          drillSheet={() => (
            <PFilesDrillSheet
              target="expiring-soon"
              segment="30"
              ayCode={selectedAy}
            />
          )}
        />
        <MetricCard
          label="Expiring ≤60d"
          value={kpisResult.current.expiringSoon}
          icon={AlertTriangle}
          intent={kpisResult.current.expiringSoon > 0 ? 'warning' : 'good'}
          subtext="From today"
          drillSheet={() => (
            <PFilesDrillSheet
              target="expiring-soon"
              segment="60"
              ayCode={selectedAy}
            />
          )}
        />
        <MetricCard
          label="Total docs tracked"
          value={kpisResult.current.totalDocuments}
          icon={TrendingUp}
          intent="default"
          subtext="All slots · all levels"
          drillSheet={() => (
            <PFilesDrillSheet target="all-docs" ayCode={selectedAy} />
          )}
        />
      </section>

      <SummaryCards summary={summary} />

      {/* Row 6 — wide revision trend (12-week reference) */}
      <section>
        <RevisionsOverTimeChart data={revisions} />
      </section>

      {/* Row 7 — completion by level (2/3) + slot status mix (1/3) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CompletionByLevelDrillCard data={byLevel} ayCode={selectedAy} />
        </div>
        <div className="lg:col-span-1">
          <SlotStatusDrillCard slotMix={slotMix} ayCode={selectedAy} />
        </div>
      </section>

      {/* Row 8 — expiring docs (full width). Phase 2B dropped the
          TopMissingDrillCard because "missing" is admissions-side initial
          chase; P-Files is renewal-only now. */}
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Expiring documents · next 60 days
          </CardDescription>
          <CardTitle className="font-serif text-xl">
            {expiring.length > 0
              ? `${expiring.length} student${expiring.length === 1 ? '' : 's'} need renewal outreach`
              : 'Nothing expiring in the next 60 days'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ExpiringDocumentsPanel
            rows={expiring}
            ayCode={selectedAy}
            windowDays={60}
            studentHrefBase="/p-files"
            viewAllHref={`/p-files?ay=${selectedAy}`}
          />
        </CardContent>
      </Card>

      <CompletenessCsvButton ayCode={selectedAy} />
      {/* `key` forces a fresh mount when the sidebar Quicklink flips
          `?status=...` so the table's local statusFilter state actually
          re-initialises from the new initialStatusFilter prop. Without
          the key, useState only consumes the prop on first mount and
          ignores subsequent URL changes. */}
      <DocumentCompletenessTable
        module="p-files"
        key={`${selectedAy}:${initialStatusFilter ?? 'all'}`}
        students={students}
        ayCode={isCurrentAy ? undefined : selectedAy}
        initialStatusFilter={initialStatusFilter}
      />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <FolderKanban className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{summary.totalStudents.toLocaleString('en-SG')} students</span>
        <span className="text-border">·</span>
        <span>Refreshes every 10 minutes</span>
      </div>
    </PageShell>
  );
}
