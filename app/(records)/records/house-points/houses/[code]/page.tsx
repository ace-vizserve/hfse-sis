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
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  AwardMixDrillChart,
  EventBarsDrillChart,
  HouseShareDrillChart,
  StudentBarsDrillChart,
} from '@/components/house-points/drills/chart-drill-cards';
import {
  HouseEntriesDrillSheet,
  HouseEventsDrillSheet,
  HouseStudentsDrillSheet,
} from '@/components/house-points/drills/house-drill-sheets';
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
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { ordinal } from '@/lib/house-points/defaults';
import {
  scoringEvents,
  scoringStudents,
  uniqueCategories,
} from '@/lib/house-points/drill';
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
// Three KPI cards and all four charts open the shared DrillDownSheet, wired as
// the Admissions dashboard does (MetricCard `drillSheet`, chart
// `onSegmentClick`); see components/house-points/drills/. Their rows are this
// breakdown's own, so no drill route is involved.
//
// Same guard as the other house-points pages (the `/records` ROUTE_ACCESS
// row). The one write here is the Members tab's add / remove, shown to
// ENROLMENT_PLACEMENT_WRITERS (the gate on a student's house everywhere);
// everything else is read-only.
//
// `code` is the house's stable code (H1–H4, never renamed); the URL carries
// it lower-case, so it is normalised before the lookup.
//
// Houses are IDENTITY colours: every chart mark for a house wears that
// house's colour (`houseChartColor` — the raw `--av-house-N` token; see its
// comment for why the Tailwind colour variable draws black) and is named
// beside it, by column heading, card title or hover hint.

const EMPTY: HouseBreakdown = {
  total: 0,
  yearTotals: {},
  eventTotals: [],
  events: [],
  students: [],
  awards: [],
  entries: [],
};

/** The award donut keeps at most this many slices; past it, the tail is "Other". */
const MAX_AWARD_SLICES = 6;

/** A ranked bar chart's height for `n` bars — the Markbook Insights sizing. */
function rankedBarsHeight(n: number): number {
  return Math.max(200, n * 42 + 40);
}

/** Bar-chart category labels have a fixed column; long names are cut, the tooltip keeps the whole. */
function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "Courage, Energy, Drive and Leadership" — the house's core values as prose. */
function listValues(values: string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/** "LAST, First Middle" → "First LAST" for a compact chart label. */
function shortName(name: string): string {
  const [last, first] = name.split(', ');
  return first ? `${first.split(' ')[0]} ${last}` : name;
}

/** "Gold ×3" — the award's name with how many this house holds. */
function awardSliceName(label: string, count: number): string {
  return `${label} ×${count.toLocaleString('en-SG')}`;
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
  const canManage = (ENROLMENT_PLACEMENT_WRITERS as readonly string[]).includes(
    sessionUser.role ?? ''
  );

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
  const scoredEvents = scoringEvents(breakdown.events);
  const eventsScored = scoredEvents.length;
  const studentsScoring = scoringStudents(breakdown.students);
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
  // House pie: each house's share of the year's points, in the standings'
  // order, every slice in its own house's colour.
  const houseShare = standings.map((s) => ({
    name: s.house.name,
    value: Math.max(0, s.total),
  }));
  const houseShareColors = standings.map((s) =>
    houseChartColor(s.house.colourToken)
  );
  const shareHouses = standings.map((s) => ({
    id: s.house.id,
    code: s.house.code,
    name: s.house.name,
  }));
  // Events this house entered, most points first (the breakdown's order), so
  // the ones it scored nothing in fall to the end.
  // Each bar carries its event / student id, so a click opens that one's
  // awards; the shortened labels are numbered if two collide.
  const eventCategories = uniqueCategories(
    breakdown.events.map((e) => shorten(e.name, 24))
  );
  const byEvent = breakdown.events.map((e, i) => ({
    category: eventCategories[i],
    current: e.points,
    id: e.id,
    label: e.name,
  }));
  // Donut: each award's share of the points. Past six slices the smallest
  // fold into one "Other" slice, so the ring never needs a seventh colour.
  const awardsByPoints = [...breakdown.awards].sort(
    (a, b) => b.points - a.points
  );
  const awardHead =
    awardsByPoints.length > MAX_AWARD_SLICES
      ? awardsByPoints.slice(0, MAX_AWARD_SLICES - 1)
      : awardsByPoints;
  const awardTail = awardsByPoints.slice(awardHead.length);
  const awardMix = [
    ...awardHead.map((a) => ({
      name: awardSliceName(a.label, a.count),
      value: a.points,
      awards: [a.label],
    })),
    ...(awardTail.length > 0
      ? [
          {
            name: awardSliceName(
              'Other',
              awardTail.reduce((n, a) => n + a.count, 0)
            ),
            value: awardTail.reduce((n, a) => n + a.points, 0),
            awards: awardTail.map((a) => a.label),
          },
        ]
      : []),
  ];
  const topTen = studentsScoring.slice(0, 10);
  const studentCategories = uniqueCategories(
    topTen.map((s) => shorten(shortName(s.name), 24))
  );
  const topStudents = topTen.map((s, i) => ({
    category: studentCategories[i],
    current: s.points,
    id: s.studentId,
    label: s.name,
    studentNumber: s.studentNumber,
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
        title={house.title ? `${house.name} · ${house.title}` : house.name}
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
          // The house's core values lead (migration 111); its title ("The
          // Flame") sits in the page title above.
          (house.coreValues.length > 0
            ? `${listValues(house.coreValues)}. `
            : '') +
          (standing && placeLabel
            ? `${placeLabel} in ${selectedAy} — ${standing.gapLabel.charAt(0).toLowerCase()}${standing.gapLabel.slice(1)}. Where its points came from, event by event and student by student.`
            : `No house has points in ${selectedAy} yet. This page fills in as awards are picked on each event.`)
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
          drillSheet={() => (
            <HouseEntriesDrillSheet
              drill={{ target: 'entries' }}
              entries={breakdown.entries}
              houseName={house.name}
              eyebrow="Total points"
              title={`Every award ${house.name} earned`}
              description={`${formatPoints(breakdown.total)} points in ${selectedAy}, award by award.`}
              csvFilename={`${fileStem}-awards.csv`}
            />
          )}
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
          drillSheet={() => (
            <HouseEventsDrillSheet
              events={scoredEvents}
              eyebrow="Events scored in"
              title={`Events ${house.name} scored in`}
              description={`Every event in ${selectedAy} where ${house.name} earned at least one point.`}
              csvFilename={`${fileStem}-events-scored.csv`}
            />
          )}
        />
        <MetricCard
          label="Students who earned points"
          value={studentsScoring.length}
          icon={UserRound}
          tileClassName={tile}
          subtext={`Of ${members.length.toLocaleString('en-SG')} members · ${awardsWon.toLocaleString('en-SG')} awards won`}
          hint="Students with at least one point this year. Awards counts every award picked for the house's students, teams and house entries, Participation included."
          drillSheet={() => (
            <HouseStudentsDrillSheet
              students={studentsScoring}
              eyebrow="Students who earned points"
              title={`${house.name}'s students with points`}
              description="A team award counts in full for each member, so these points can add up to more than the house total."
              csvFilename={`${fileStem}-students-scored.csv`}
            />
          )}
        />
      </section>

      {/* ── Charts — the two shares side by side, then two ranked bar charts ── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          eyebrow="Against the other houses"
          title={
            placeLabel
              ? `${house.name} is ${placeLabel} this year`
              : "Every house's share of the points"
          }
          icon={Swords}
        >
          {anyPoints ? (
            <HouseShareDrillChart
              data={houseShare}
              colors={houseShareColors}
              houses={shareHouses}
              eventTotals={breakdown.eventTotals}
              ayCode={selectedAy}
              currentHouseId={house.id}
              fileStem={fileStem}
            />
          ) : (
            <ChartEmpty
              icon={Swords}
              title="No house has points yet"
              body="Each house's share of the year's points appears here once awards are picked on an event."
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
            <AwardMixDrillChart
              slices={awardMix}
              centerValue={awardsWon.toLocaleString('en-SG')}
              centerLabel="Awards"
              centerHint="Every award picked for this house's students, teams and house entries. The ring splits the house's points between them."
              entries={breakdown.entries}
              houseName={house.name}
              fileStem={fileStem}
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
            <EventBarsDrillChart
              bars={byEvent}
              height={rankedBarsHeight(byEvent.length)}
              color={fill}
              entries={breakdown.entries}
              houseName={house.name}
              fileStem={fileStem}
            />
          ) : (
            <ChartEmpty
              icon={CalendarCheck}
              title="No events entered yet"
              body="Events appear here, most points first, once the house takes part."
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
            <StudentBarsDrillChart
              bars={topStudents}
              height={rankedBarsHeight(topStudents.length)}
              color={fill}
              entries={breakdown.entries}
              houseName={house.name}
              fileStem={fileStem}
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
        manage={
          canManage && ayId ? { houseCode: house.code, roster, houses } : null
        }
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
