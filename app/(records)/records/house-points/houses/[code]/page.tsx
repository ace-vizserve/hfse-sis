import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  Medal,
  Trophy,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  HouseEventsTable,
  HouseMembersTable,
  HouseStudentsTable,
} from '@/components/house-points/house-breakdown-tables';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { houseTileClass, listHouses } from '@/lib/sis/houses';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

// One house's year as a dashboard (analytical archetype, 20-dashboards.md):
// who it is and where it stands, its figures, four charts of where the points
// came from, then the drill-down tables and its members. Reached from a
// house's card on /records/house-points.
//
// Same guard as the other house-points pages (the `/records` ROUTE_ACCESS
// row). Read-only: no write controls, so admissions sees what everyone does.
//
// `code` is the house's stable code (H1–H4, never renamed); the URL carries
// it lower-case, so it is normalised before the lookup.
//
// Houses are IDENTITY colours: every chart mark for a house wears that
// house's token and sits beside its name (legend chip or title).

const EMPTY: HouseBreakdown = {
  total: 0,
  yearTotals: {},
  eventTotals: [],
  events: [],
  students: [],
  awards: [],
};

const HOUSE_TOKENS = new Set(['house-1', 'house-2', 'house-3', 'house-4']);

/** A house's chart fill — its own token, or muted ink for an unknown one. */
function houseFill(colourToken: string): string {
  return HOUSE_TOKENS.has(colourToken)
    ? `var(--color-${colourToken})`
    : 'var(--color-ink-5)';
}

function houseLegend(colourToken: string): ChartLegendChipColor {
  return HOUSE_TOKENS.has(colourToken)
    ? (colourToken as ChartLegendChipColor)
    : 'neutral';
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

function barHeight(rows: number): number {
  return Math.max(120, rows * 30 + 16);
}

function ChartCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return (
    <p className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2
        id={id}
        className="font-serif text-xl font-semibold tracking-tight text-foreground"
      >
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
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
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

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

  // ── Figures ─────────────────────────────────────────────────────────────
  const eventsScored = breakdown.events.filter((e) => e.points > 0).length;
  const studentsScoring = breakdown.students.filter((s) => s.points > 0);
  const awardsWon = breakdown.awards.reduce((n, a) => n + a.count, 0);
  const mostHeld = breakdown.awards.reduce<
    (typeof breakdown.awards)[number] | null
  >((best, a) => (!best || a.count > best.count ? a : best), null);

  // Where this house topped an event (ties count), of those anyone scored in.
  const contested = breakdown.eventTotals.filter((e) =>
    Object.values(e.totals).some((t) => t > 0)
  );
  const eventsWon = contested.filter((e) => {
    const mine = e.totals[house.id] ?? 0;
    return mine > 0 && mine === Math.max(...Object.values(e.totals));
  }).length;

  // ── Chart data (plain values — the charts are client components). ────────
  const fill = houseFill(house.colourToken);
  const byEvent = breakdown.events
    .filter((e) => e.points > 0)
    .map((e) => ({ category: shorten(e.name, 26), current: e.points }));
  const versusSeries = houses.map((h) => ({
    key: h.id,
    label: h.name,
    color: houseFill(h.colourToken),
    legendColor: houseLegend(h.colourToken),
  }));
  const versusData = contested.map((e) => {
    const row: Record<string, string | number> = { x: shorten(e.name, 16) };
    for (const h of houses) row[h.id] = e.totals[h.id] ?? 0;
    return row;
  });
  const awardMix = breakdown.awards.map((a) => ({
    category: shorten(`${a.label} ×${a.count.toLocaleString('en-SG')}`, 26),
    current: a.points,
  }));
  const topStudents = studentsScoring.slice(0, 10).map((s) => ({
    category: shorten(shortName(s.name), 24),
    current: s.points,
  }));

  const fileStem = `house-points-${house.code.toLowerCase()}-${selectedAy}`;
  const backHref = `/records/house-points?ay=${encodeURIComponent(selectedAy)}`;
  const tile = houseTileClass(house.colourToken);

  return (
    <PageShell>
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        House points
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · House points · {selectedAy}
          </p>
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'size-11 shrink-0 rounded-xl shadow-brand-tile md:size-12',
                tile
              )}
              aria-hidden
            />
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {house.name}.
            </h1>
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {standing && anyPoints ? (
              <>
                <span className="font-medium text-foreground">
                  {ordinal(standing.place)} of {houses.length}
                </span>{' '}
                in {selectedAy} ({standing.gapLabel}). Where its points came
                from, event by event and student by student.
              </>
            ) : (
              <>
                No house has points in {selectedAy} yet. This page fills in as
                awards are picked on each event.
              </>
            )}
          </p>
        </div>
        <AySwitcher current={selectedAy} options={ayCodes} />
      </header>

      {/* ── Figures ─────────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Total points"
          value={formatPoints(breakdown.total)}
          icon={Trophy}
          tileClassName={tile}
          subtext={
            standing
              ? `${ordinal(standing.place)} of ${houses.length} houses`
              : undefined
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
          subtext={`Top house at ${eventsWon} of ${contested.length} event${contested.length === 1 ? '' : 's'}`}
          hint="Events where this house earned at least one point. Top house counts ties."
        />
        <MetricCard
          label="Students who earned points"
          value={studentsScoring.length}
          icon={UserRound}
          tileClassName={tile}
          subtext={`${breakdown.students.length.toLocaleString('en-SG')} took part in an event`}
        />
        <MetricCard
          label="Awards won"
          value={awardsWon}
          icon={Medal}
          tileClassName={tile}
          subtext={mostHeld ? `Most held: ${mostHeld.label}` : 'None yet'}
          hint="Every award picked for this house's students, teams and house entries, Participation included."
        />
        <MetricCard
          label="Members"
          value={members.length}
          icon={Users}
          tileClassName={tile}
          subtext={`Students enrolled in ${selectedAy}`}
        />
      </section>

      {/* ── Charts ──────────────────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          eyebrow="Points by event"
          title="Where the points came from"
          description={`${house.name}'s points at each event, most first.`}
        >
          {byEvent.length > 0 ? (
            <ComparisonBarChart
              data={byEvent}
              orientation="horizontal"
              yFormat="number"
              color={fill}
              seriesLabel="Points"
              categoryWidth={170}
              height={barHeight(byEvent.length)}
            />
          ) : (
            <ChartEmpty text="No points from any event yet." />
          )}
        </ChartCard>

        <ChartCard
          eyebrow="Against the other houses"
          title="Every house, event by event"
          description={
            contested.length > 0
              ? `${house.name} was top house at ${eventsWon} of ${contested.length} event${contested.length === 1 ? '' : 's'} with points.`
              : 'No event has points yet.'
          }
        >
          {versusData.length > 0 ? (
            <GroupedBarChart
              series={versusSeries}
              data={versusData}
              yFormat="number"
              height={280}
            />
          ) : (
            <ChartEmpty text="No event has points yet." />
          )}
        </ChartCard>

        <ChartCard
          eyebrow="Award mix"
          title="Awards held"
          description="Points each award brought, with how many times the house holds it."
        >
          {awardMix.length > 0 ? (
            <ComparisonBarChart
              data={awardMix}
              orientation="horizontal"
              yFormat="number"
              color={fill}
              seriesLabel="Points"
              categoryWidth={170}
              height={barHeight(awardMix.length)}
            />
          ) : (
            <ChartEmpty text="No awards yet this year." />
          )}
        </ChartCard>

        <ChartCard
          eyebrow="Top contributors"
          title="Students with the most points"
          description="The top ten. A team result counts in full for each member."
        >
          {topStudents.length > 0 ? (
            <ComparisonBarChart
              data={topStudents}
              orientation="horizontal"
              yFormat="number"
              color={fill}
              seriesLabel="Points"
              categoryWidth={170}
              height={barHeight(topStudents.length)}
            />
          ) : (
            <ChartEmpty text="No student has earned points yet." />
          )}
        </ChartCard>
      </section>

      {/* ── Drill-down ──────────────────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="by-event">
        <SectionHeading
          id="by-event"
          title="By event"
          description={`What ${house.name} won at each event, and the points it brought.`}
        />
        <HouseEventsTable
          events={breakdown.events}
          houseName={house.name}
          fileStem={fileStem}
        />
      </section>

      <section className="space-y-3" aria-labelledby="by-student">
        <SectionHeading
          id="by-student"
          title="By student"
          description={`Every ${house.name} student entered in an event this year.`}
        />
        <HouseStudentsTable
          students={breakdown.students}
          houseName={house.name}
          fileStem={fileStem}
        />
        <p className="text-xs text-muted-foreground">
          A team result shows under each of its members, but the house total
          counts it once, so these points can add up to more than{' '}
          {formatPoints(breakdown.total)}.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="members">
        <SectionHeading
          id="members"
          title="Members"
          description={`Every student enrolled in ${selectedAy} whose house is ${house.name}.`}
        />
        <HouseMembersTable
          members={members}
          houseName={house.name}
          ayCode={selectedAy}
          fileStem={fileStem}
        />
      </section>

      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {selectedAy} · {house.name} · {breakdown.eventTotals.length} event
        {breakdown.eventTotals.length === 1 ? '' : 's'}
      </p>
    </PageShell>
  );
}
