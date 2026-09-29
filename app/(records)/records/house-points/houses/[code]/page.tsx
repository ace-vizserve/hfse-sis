import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  ChartBar,
  Medal,
  Swords,
  Trophy,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { MetricCard } from '@/components/dashboard/metric-card';
import { HouseBreakdownTabs } from '@/components/house-points/house-breakdown-tables';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { ordinal } from '@/lib/house-points/defaults';
import {
  houseMembers,
  type HouseBreakdown,
} from '@/lib/house-points/house-breakdown';
import {
  loadEnrolledRoster,
  loadHouseBreakdown,
  type RosterStudent,
} from '@/lib/house-points/queries';
import { formatPoints, rankStandings } from '@/lib/house-points/standings';
import { houseChartColor, houseTileClass, listHouses } from '@/lib/sis/houses';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

// One house's year as a dashboard (analytical archetype, 20-dashboards.md),
// built from the same pieces as the Records and Admissions dashboards:
// DashboardHero, a 4-up MetricCard row, chart cards in the admissions card
// chrome (eyebrow · serif title · icon tile), then ONE tabbed card holding the
// By event / By student / Members tables. Reached from a house's card on
// /records/house-points.
//
// Same guard as the other house-points pages (the `/records` ROUTE_ACCESS
// row). Read-only: no write controls, so admissions sees what everyone does.
//
// `code` is the house's stable code (H1–H4, never renamed); the URL carries
// it lower-case, so it is normalised before the lookup.
//
// Houses are IDENTITY colours: every chart mark for a house wears that
// house's colour (`houseChartColor` — the raw `--av-house-N` token; see its
// comment for why the Tailwind colour variable draws black) and is named
// beside it, by legend chip, card title or tooltip.

const EMPTY: HouseBreakdown = {
  total: 0,
  yearTotals: {},
  eventTotals: [],
  events: [],
  students: [],
  awards: [],
};

/** The comparison-bar chart's own default height, which ChartSkeleton reserves. */
const CHART_HEIGHT = 260;

function houseLegend(colourToken: string): ChartLegendChipColor {
  switch (colourToken) {
    case 'house-1':
    case 'house-2':
    case 'house-3':
    case 'house-4':
      return colourToken;
    default:
      return 'neutral';
  }
}

/** Chart category labels have a fixed column; long names are cut, the tooltip keeps the whole. */
function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "LAST, First Middle" → "First LAST" for a compact bar label. */
function shortName(name: string): string {
  const [last, first] = name.split(', ');
  return first ? `${first.split(' ')[0]} ${last}` : name;
}

/** A ranked horizontal list grows with its rows, never below the standard height. */
function barHeight(rows: number): number {
  return Math.max(CHART_HEIGHT, rows * 30 + 16);
}

function ChartCard({
  eyebrow,
  title,
  icon: Icon,
  tileClassName,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
  tileClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  // The admissions dashboard's chart-card chrome (applications-by-level-card).
  return (
    <Card className={cn('h-full min-w-0', className)}>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div
            className={cn(
              'flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
              tileClassName ?? 'from-brand-indigo to-brand-navy'
            )}
          >
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
      <Icon className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

export default async function HousePointsHousePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const [{ code }, { ay: ayParam }] = await Promise.all([params, searchParams]);
  const service = createServiceClient();
  const [houses, currentAy, ayCodes] = await Promise.all([
    listHouses(),
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);
  const wanted = code.trim().toUpperCase();
  const house = houses.find((h) => h.code.toUpperCase() === wanted);
  if (!house) notFound();

  if (!currentAy) {
    return (
      <PageShell>
        <NoCurrentAyCard />
      </PageShell>
    );
  }
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  const ayId = await getAyIdByCode(selectedAy);
  const [breakdown, roster] = ayId
    ? await Promise.all([
        loadHouseBreakdown(ayId, house.id, houses),
        loadEnrolledRoster(ayId),
      ])
    : [EMPTY, [] as RosterStudent[]];
  const members = houseMembers(roster, house.id);

  // ── Standing — the standings page's own ranking, so ties share a place. ──
  const standings = rankStandings(houses, breakdown.yearTotals);
  const standing = standings.find((s) => s.house.id === house.id);
  const anyPoints = standings.some((s) => s.total !== 0);
  const leader = standings[0];
  const runnerUp = standings.find((s) => s.house.id !== house.id);
  const isLeading = standing?.place === 1;
  const gap = isLeading
    ? breakdown.total - (runnerUp?.total ?? breakdown.total)
    : (leader?.total ?? 0) - breakdown.total;
  const placeLabel =
    standing && anyPoints
      ? `${ordinal(standing.place)} of ${houses.length}`
      : null;

  // ── Figures ─────────────────────────────────────────────────────────────
  const eventsScored = breakdown.events.filter((e) => e.points > 0).length;
  const studentsScoring = breakdown.students.filter((s) => s.points > 0);
  const awardsWon = breakdown.awards.reduce((n, a) => n + a.count, 0);

  // Where this house topped an event (ties count), of those anyone scored in.
  const contested = breakdown.eventTotals.filter((e) =>
    Object.values(e.totals).some((t) => t > 0)
  );
  const eventsWon = contested.filter((e) => {
    const mine = e.totals[house.id] ?? 0;
    return mine > 0 && mine === Math.max(...Object.values(e.totals));
  }).length;

  // ── Chart data (plain values — the charts are client components). ────────
  const fill = houseChartColor(house.colourToken);
  const byEvent = breakdown.events
    .filter((e) => e.points > 0)
    .map((e) => ({ category: shorten(e.name, 26), current: e.points }));
  const versusSeries = houses.map((h) => ({
    key: h.id,
    label: h.name,
    color: houseChartColor(h.colourToken),
    legendColor: houseLegend(h.colourToken),
  }));
  const versusData = contested.map((e) => {
    const row: Record<string, string | number> = { x: shorten(e.name, 16) };
    for (const h of houses) row[h.id] = e.totals[h.id] ?? 0;
    return row;
  });
  const awardMix = breakdown.awards.map((a) => ({
    category: shorten(`${a.label} ×${a.count.toLocaleString('en-SG')}`, 18),
    current: a.points,
  }));
  const topStudents = studentsScoring.slice(0, 10).map((s) => ({
    category: shorten(shortName(s.name), 24),
    current: s.points,
  }));

  const fileStem = `house-points-${house.code.toLowerCase()}-${selectedAy}`;
  const backHref = `/records/house-points?ay=${encodeURIComponent(selectedAy)}`;
  const tile = houseTileClass(house.colourToken);
  const eventWord = (n: number) => `event${n === 1 ? '' : 's'}`;

  return (
    <PageShell>
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        House points
      </Link>

      <DashboardHero
        eyebrow="Records · House points"
        title={house.name}
        titleMark={
          <div
            className={cn(
              'size-11 shrink-0 rounded-xl shadow-brand-tile md:size-12',
              tile
            )}
            aria-hidden
          />
        }
        description={
          standing && placeLabel
            ? `${placeLabel} in ${selectedAy} — ${standing.gapLabel.charAt(0).toLowerCase()}${standing.gapLabel.slice(1)}. Where its points came from, event by event and student by student.`
            : `No house has points in ${selectedAy} yet. This page fills in as awards are picked on each event.`
        }
        badges={[
          { label: selectedAy },
          {
            label: isCurrentAy ? 'Current' : 'Historical',
            tone: isCurrentAy ? 'mint' : 'muted',
          },
        ]}
        actions={
          <AySwitcher current={selectedAy} options={ayCodes} className="w-40" />
        }
      />

      {/* ── Figures — the Records / Admissions 4-up KPI row ──────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total points"
          value={formatPoints(breakdown.total)}
          icon={Trophy}
          tileClassName={tile}
          subtext={
            placeLabel ? `${placeLabel} houses` : `No points in ${selectedAy}`
          }
          hint="Every point this house earned this year — the same figure as on the standings."
        />
        <MetricCard
          label={isLeading ? 'Lead over the next house' : 'Behind the leader'}
          value={formatPoints(Math.max(0, gap))}
          icon={TrendingUp}
          tileClassName={tile}
          subtext={
            anyPoints ? (standing?.gapLabel ?? undefined) : 'No points yet'
          }
        />
        <MetricCard
          label="Events scored in"
          value={eventsScored}
          icon={CalendarCheck}
          tileClassName={tile}
          subtext={`Top house at ${eventsWon} of ${contested.length} ${eventWord(contested.length)}`}
          hint="Events where this house earned at least one point. Top house counts ties."
        />
        <MetricCard
          label="Students who earned points"
          value={studentsScoring.length}
          icon={UserRound}
          tileClassName={tile}
          subtext={`Of ${members.length.toLocaleString('en-SG')} members · ${awardsWon.toLocaleString('en-SG')} awards won`}
          hint="Students with at least one point this year. Awards counts every award picked for the house's students, teams and house entries, Participation included."
        />
      </section>

      {/* ── Charts — wide comparison + narrow breakdown, then two ranked lists ── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          eyebrow="Against the other houses"
          title={
            contested.length > 0
              ? `Top house at ${eventsWon} of ${contested.length} ${eventWord(contested.length)}`
              : 'Every house, event by event'
          }
          icon={Swords}
          className="lg:col-span-2"
        >
          {versusData.length > 0 ? (
            <GroupedBarChart
              series={versusSeries}
              data={versusData}
              yFormat="number"
              height={CHART_HEIGHT}
            />
          ) : (
            <ChartEmpty
              icon={Swords}
              title="No event has points yet"
              body="Each event appears here once awards are picked on it."
            />
          )}
        </ChartCard>

        <ChartCard
          eyebrow="Award mix"
          title="Points by award"
          icon={Medal}
          tileClassName={tile}
        >
          {awardMix.length > 0 ? (
            <ComparisonBarChart
              data={awardMix}
              orientation="horizontal"
              yFormat="number"
              color={fill}
              seriesLabel={house.name}
              categoryWidth={120}
              height={barHeight(awardMix.length)}
            />
          ) : (
            <ChartEmpty
              icon={Medal}
              title="No awards yet"
              body={`Awards appear once one is picked for ${house.name}.`}
            />
          )}
        </ChartCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          eyebrow="Points by event"
          title={`Where ${house.name}'s points came from`}
          icon={CalendarCheck}
          tileClassName={tile}
        >
          {byEvent.length > 0 ? (
            <ComparisonBarChart
              data={byEvent}
              orientation="horizontal"
              yFormat="number"
              color={fill}
              seriesLabel={house.name}
              categoryWidth={170}
              height={barHeight(byEvent.length)}
            />
          ) : (
            <ChartEmpty
              icon={CalendarCheck}
              title="No points from any event yet"
              body="Events appear here, most points first, once the house scores."
            />
          )}
        </ChartCard>

        <ChartCard
          eyebrow="Top contributors"
          title="Students with the most points"
          icon={UserRound}
          tileClassName={tile}
        >
          {topStudents.length > 0 ? (
            <ComparisonBarChart
              data={topStudents}
              orientation="horizontal"
              yFormat="number"
              color={fill}
              seriesLabel={house.name}
              categoryWidth={170}
              height={barHeight(topStudents.length)}
            />
          ) : (
            <ChartEmpty
              icon={UserRound}
              title="No student has earned points yet"
              body="The top ten appear here. A team result counts in full for each member."
            />
          )}
        </ChartCard>
      </section>

      {/* ── Drill-down — three tables, one card, one at a time ────────────── */}
      <HouseBreakdownTabs
        events={breakdown.events}
        students={breakdown.students}
        members={members}
        houseName={house.name}
        ayCode={selectedAy}
        fileStem={fileStem}
        totalLabel={formatPoints(breakdown.total)}
      />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ChartBar className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{house.name}</span>
        <span className="text-border">·</span>
        <span>
          {breakdown.eventTotals.length}{' '}
          {eventWord(breakdown.eventTotals.length)}
        </span>
      </div>
    </PageShell>
  );
}
