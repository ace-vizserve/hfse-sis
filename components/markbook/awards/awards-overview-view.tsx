import {
  Award,
  CalendarClock,
  Info,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { AwardThresholdStrip } from '@/components/markbook/awards/award-threshold-strip';
import {
  AwardsLevelTable,
  type AwardsLevelTableRow,
} from '@/components/markbook/awards/awards-level-table';
import { AwardsStudentTable } from '@/components/markbook/awards/awards-student-table';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  NEAR_BAND_POINTS,
  type AwardsOverview,
} from '@/lib/markbook/awards-overview-compute';

// School-wide Awards.
//
// A server component apart from the two tables, which are client islands on the
// shared <DataTable> shell so they carry sorting, filtering and a columns menu.
//
// ⚠ Read the header of lib/markbook/awards-overview-compute.ts before changing
// anything here. The whole page turns on one distinction: a settled AWARD needs
// all four terms, and until then every figure is a STANDING — where marks sit
// against the school's own cut-offs, deciding nothing. `settled` gates the
// wording throughout, and the chips are painted differently on purpose.

function StatTile({
  label,
  value,
  footer,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  footer: string;
  icon: LucideIcon;
  /** Only 'bad' tints the number — see the note on the Academic Summary tile. */
  tone?: 'bad';
}) {
  return (
    <Card className="@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle
          className={`font-serif text-[30px] font-semibold leading-none tabular-nums ${tone === 'bad' ? 'text-destructive' : 'text-foreground'}`}
        >
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">{footer}</p>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  cap,
  title,
  scope,
  icon: Icon,
  footer,
  children,
}: {
  cap: string;
  title: string;
  /** Restated on every card so a filtered figure is never read as the school's. */
  scope?: string | null;
  icon: LucideIcon;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {cap}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
          {scope ? (
            <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
              ({scope})
            </span>
          ) : null}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      {children}
      {footer ? (
        <div className="border-t border-border bg-muted/30 px-6 py-3 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

export function AwardsOverviewView({
  overview,
  levelHref,
}: {
  overview: AwardsOverview;
  levelHref: (levelId: string) => string;
}) {
  const { coverage, tiers, withinReach, thresholds, filters } = overview;
  const settled = coverage.complete;
  const scopeLabel = overview.scopeLabel;
  const showLadder = overview.levels.length > 1;

  // Resolved here rather than in the table: `levelHref` is a function, and a
  // server component can only hand a client component serializable props.
  const levelRows: AwardsLevelTableRow[] = overview.levels.map((level) => ({
    ...level,
    href: levelHref(level.levelId),
    settled,
  }));

  const termsPhrase =
    coverage.termsTotal > 0
      ? `${coverage.termsMarked} of ${coverage.termsTotal} terms marked`
      : 'No terms configured';

  return (
    <div className="flex flex-col gap-8">
      {/* What the page is reporting, and what it is not. This banner is the
          honesty guarantee: a reader who takes a standing for an award has been
          misled by this page, so it says which one they are looking at before
          any number appears. */}
      <div
        className={`flex items-start gap-4 rounded-xl border p-5 ${
          settled
            ? 'border-brand-mint bg-brand-mint/10'
            : 'border-brand-indigo-soft bg-accent'
        }`}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          {settled ? <Award className="size-4" /> : <Info className="size-4" />}
        </div>
        <div className="flex-1 space-y-1.5">
          <p className="font-serif text-base font-semibold text-foreground">
            {settled
              ? `${overview.categoryLabel} — final`
              : `${overview.categoryLabel} — standing so far`}
          </p>
          <p className="text-sm text-muted-foreground">
            {settled ? (
              <>
                Every term is marked, so these are the awards as they stand for{' '}
                {overview.ayCode}.
              </>
            ) : (
              <>
                Awards settle when all {coverage.termsTotal} terms are graded —{' '}
                {termsPhrase} so far. Until then these are readings of the marks
                recorded against the school&rsquo;s own thresholds, not awards.
                Nothing here is recorded against a student.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Headline */}
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {overview.categoryLabel}
          {scopeLabel ? ` · ${scopeLabel}` : ''}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Students with marks"
            value={coverage.studentsWithMarks.toLocaleString('en-SG')}
            footer={`Of ${coverage.studentsEnrolled.toLocaleString('en-SG')} enrolled · ${termsPhrase}`}
            icon={Users}
          />
          <StatTile
            label={settled ? 'Bronze or above' : 'Standing at Bronze or above'}
            value={String(overview.atBronzeOrAbove)}
            footer={
              coverage.studentsWithMarks > 0
                ? `${Math.round((overview.atBronzeOrAbove / coverage.studentsWithMarks) * 100)}% of those with marks`
                : 'Nothing marked yet'
            }
            icon={Award}
          />
          <StatTile
            label="Within reach"
            value={String(withinReach.total)}
            footer={`Within ${NEAR_BAND_POINTS.toFixed(1)} point of the next band up`}
            icon={TrendingUp}
            tone="bad"
          />
          <StatTile
            label={settled ? 'Awards' : 'Awards settle'}
            value={settled ? 'Final' : `Term ${coverage.termsTotal}`}
            footer={
              settled
                ? 'Every term graded'
                : 'Nothing on this page is final until then'
            }
            icon={CalendarClock}
          />
        </div>
      </section>

      {/* Where the cohort sits against the cut-offs */}
      <SectionCard
        cap={`${coverage.studentsWithMarks} students · ${termsPhrase}`}
        title="Where the school sits against the thresholds"
        scope={scopeLabel}
        icon={Award}
        footer={
          <>
            {withinReach.bronze} students are within{' '}
            {NEAR_BAND_POINTS.toFixed(1)} point of Bronze, {withinReach.silver}{' '}
            of Silver and {withinReach.gold} of Gold. The cut lines come from
            School config, where HFSE sets them — this page draws them, it does
            not choose them.
          </>
        }
      >
        <CardContent className="py-6">
          <AwardThresholdStrip
            tiers={tiers}
            thresholds={thresholds}
            withinReach={withinReach}
            title={scopeLabel ?? 'The whole school'}
            settled={settled}
          />
        </CardContent>
      </SectionCard>

      {/* The level ladder */}
      {showLadder && (
        <section className="flex flex-col gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {overview.levels[0]?.levelLabel ?? ''} →{' '}
              {overview.levels[overview.levels.length - 1]?.levelLabel ?? ''}
            </p>
            <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
              {settled ? 'Awards by grade level' : 'Standing by grade level'}
              {scopeLabel ? (
                <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                  ({scopeLabel})
                </span>
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">
              Listed in school order, not ranked — sort by Grade level to put it
              back. Select a grade level to narrow the whole page to it.
            </p>
          </div>
          <AwardsLevelTable rows={levelRows} />
          <p className="text-xs text-muted-foreground">
            “Within reach” counts students within {NEAR_BAND_POINTS.toFixed(1)}{' '}
            point of the next band up — they are named in the table below.
            Select a spread bar for the band-by-band breakdown.
          </p>
        </section>
      )}

      {/* Per student */}
      <section className="flex flex-col gap-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {coverage.studentsWithMarks} students · closest to moving up first
          </p>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {settled ? 'Awards by student' : 'Standing by student'}
            {scopeLabel ? (
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                ({scopeLabel})
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            Ordered by how close each student is to the next band, so the ones a
            fraction of a point away come first. A student already at Gold has
            nowhere to move and sorts last.
          </p>
        </div>
        <AwardsStudentTable
          rows={overview.students}
          settled={settled}
          categoryLabel={overview.categoryLabel}
        />
      </section>

      <p className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {overview.ayCode} · {termsPhrase} · Bronze ≥ {thresholds.bronzeMin} ·
        Silver ≥ {thresholds.silverMin} · Gold ≥ {thresholds.goldMin} ·
        Thresholds editable in SIS Admin → School config
        {filters.termNumber != null
          ? ' · A single term is not an award period'
          : ''}
      </p>
    </div>
  );
}
