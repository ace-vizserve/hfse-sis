import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Eye,
  Printer,
  Share2,
  Users,
} from 'lucide-react';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonCards, SkeletonTable } from '@/components/ui/skeleton-layouts';
import { PublishWindowPanel } from '@/components/admin/publish-window-panel';
import { BulkPublishDialog } from '@/components/admin/bulk-publish-dialog';
import {
  AllPublicationsOverview,
  type PublicationOverviewRow,
} from '@/components/markbook/all-publications-overview';
import {
  ReportCardsRosterTable,
  type ReportCardsRosterRow,
} from './report-cards-roster-table';
import { SectionPicker } from './section-picker';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

type SectionWithLevel = {
  id: string;
  name: string;
  level: LevelLite | LevelLite[] | null;
};

type TermLite = {
  id: string;
  term_number: number;
  label: string;
  is_current: boolean;
};

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

// The two stat grids, written once so the Suspense fallbacks below cannot
// drift from the loaded grid. A fallback that lays its cards out differently
// from the real ones is the layout shift the skeleton exists to prevent.
const KPI_GRID_CLASS =
  'grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4';
const DETAIL_GRID_CLASS =
  'grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3';

// ROUTE_ACCESS gates the broad `/markbook` prefix to teachers too (they need
// it for their own grading sheets), so this page defends at the page level
// like every one of its siblings (insights / sections / audit-log /
// change-requests / grading-new). Before this guard a teacher reaching the
// URL directly rendered the publishing shell — section picker, publish
// panel, bulk-publish dialog.
//
// This was NOT a data leak: `report_card_publications` is RLS-gated to
// `is_registrar_or_above()` (migration 007), so the windows came back empty,
// and every mutation is requireRole-gated to this same role set
// (POST /api/report-card-publications). It was a broken, confusing surface
// for a role that can't use it, and a defense-in-depth gap if that RLS
// policy ever loosened. Role set matches /markbook/insights, the three
// Report Cards nav links, and the publish route.
const ALLOWED_ROLES = new Set([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

/**
 * The parent holds only the reads the shell itself cannot render without:
 * the session gate, the request's own inputs, the current academic year, its
 * sections and its terms. Those four feed the header — hero, AY badge,
 * bulk-publish dialog, section picker — which is the LCP element and
 * therefore stays outside every boundary.
 *
 * Everything below the header is *secondary*: it answers "how are we doing"
 * rather than "where am I", so it streams in behind a Suspense boundary.
 * The two branches are mutually exclusive siblings under `q.section_id`, not
 * a nest — each branch's remaining reads come from a single `Promise.all`,
 * so there is no second wave inside either one to nest against.
 */
export default async function ReportCardsListPage({
  searchParams,
}: {
  searchParams: Promise<{ section_id?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  // ⚠ `teacher` IS NOT ON THE LIST, and that is what makes this page purely an
  // oversight surface. A teaching admin who switches to Teacher is turned away
  // here — her teacher work is in Classroom and Evaluation — and the Markbook
  // sidebar's teacher tree does not offer this row.
  if (!sessionUser.role || !ALLOWED_ROLES.has(sessionUser.role)) {
    notFound();
  }

  const q = await searchParams;
  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  const { data: sections } = ay
    ? await supabase
        .from('sections')
        .select('id, name, level:levels(id, code, label, level_type)')
        .eq('academic_year_id', ay.id)
    : { data: [] };

  const sectionsList = (sections ?? []) as SectionWithLevel[];

  const pickerSections = sectionsList.map((s) => {
    const lvl = first(s.level as LevelLite | LevelLite[] | null);
    return { id: s.id, name: s.name, level_label: lvl?.label ?? 'Unknown' };
  });

  const { data: terms } = ay
    ? await supabase
        .from('terms')
        .select('id, term_number, label, is_current')
        .eq('academic_year_id', ay.id)
        .order('term_number')
    : { data: [] };
  const termList = (terms ?? []) as TermLite[];
  const currentTermId =
    termList.find((t) => t.is_current)?.id ?? termList[0]?.id ?? null;

  // Section-detail IDENTITY — which section is this page about. It names the
  // stat cards, the publish panel and the roster heading, so it is resolved
  // here rather than inside the streamed body.
  let selectedLabel: string | null = null;
  let selectedSectionName: string | null = null;
  let selectedLevelId: string | null = null;
  if (q.section_id) {
    const { data: sec } = await supabase
      .from('sections')
      .select('id, name, level:levels(id, label)')
      .eq('id', q.section_id)
      .single();
    if (sec) {
      const lvl = first(
        sec.level as
          | { id: string; label: string }
          | { id: string; label: string }[]
          | null
      );
      selectedLabel = `${lvl?.label ?? ''} ${sec.name}`.trim();
      selectedSectionName = sec.name;
      selectedLevelId = lvl?.id ?? null;
    }
  }

  return (
    <PageShell>
      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Administration · Report cards
          </p>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              Report cards.
            </h1>
            {ay && <Badge variant="outline">{ay.ay_code}</Badge>}
          </div>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Preview each student&apos;s report card before printing, and control
            when parents can view them. Pick a section to begin.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {pickerSections.length > 0 && termList.length > 0 && (
            <BulkPublishDialog
              sections={pickerSections}
              terms={termList}
              defaultTermId={currentTermId}
            />
          )}
          <SectionPicker sections={pickerSections} selectedId={q.section_id} />
        </div>
      </header>

      {/* No section picked — current-term KPIs + cross-section publications overview */}
      {!q.section_id && (
        <Suspense fallback={<PublicationsOverviewFallback />}>
          <PublicationsOverviewSection
            sections={sectionsList}
            termList={termList}
            currentTermId={currentTermId}
          />
        </Suspense>
      )}

      {/* Section picked — stats, publish windows, roster */}
      {q.section_id && (
        <Suspense
          fallback={<SectionReportCardsFallback termCount={termList.length} />}
        >
          <SectionReportCardsBody
            sectionId={q.section_id}
            selectedLabel={selectedLabel}
            selectedSectionName={selectedSectionName}
            selectedLevelId={selectedLevelId}
            termList={termList}
            canPublish
          />
        </Suspense>
      )}
    </PageShell>
  );
}

/**
 * Landing view (no section picked). Owns the one `Promise.all` behind the
 * current-term KPI strip and the cross-section overview table — a secondary
 * read: the header above it does not depend on a single row of it.
 *
 * It calls `createClient()` itself rather than taking the parent's client as
 * a prop. That is a `cookies()` read, not a repeated query, and it is what
 * lets this component be suspended independently of the shell.
 */
async function PublicationsOverviewSection({
  sections,
  termList,
  currentTermId,
}: {
  sections: SectionWithLevel[];
  termList: TermLite[];
  currentTermId: string | null;
}) {
  const supabase = await createClient();

  let overviewRows: PublicationOverviewRow[] = [];
  let totalSections = 0;
  let publishedNowCurrentTerm = 0;
  let scheduledCurrentTerm = 0;
  let sectionsPendingCurrentTerm = 0;
  let studentsReachedCurrentTerm = 0;

  const sectionIds = sections.map((s) => s.id);

  if (sectionIds.length > 0) {
    const [pubsRes, enrolmentsRes] = await Promise.all([
      supabase
        .from('report_card_publications')
        .select('id, section_id, term_id, publish_from, publish_until')
        .in('section_id', sectionIds),
      supabase
        .from('section_students')
        .select('section_id, enrollment_status')
        .in('section_id', sectionIds),
    ]);

    // Active-student counts per section.
    const countBySection = new Map<string, number>();
    for (const e of (enrolmentsRes.data ?? []) as Array<{
      section_id: string;
      enrollment_status: string;
    }>) {
      if (e.enrollment_status !== 'withdrawn') {
        countBySection.set(
          e.section_id,
          (countBySection.get(e.section_id) ?? 0) + 1
        );
      }
    }

    // Lookups for section + term metadata.
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const termById = new Map(termList.map((t) => [t.id, t]));

    // Server component runs per-request; current time is required to
    // bucket publications into active / scheduled / expired.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    overviewRows = (
      (pubsRes.data ?? []) as Array<{
        id: string;
        section_id: string;
        term_id: string;
        publish_from: string;
        publish_until: string;
      }>
    ).map((p) => {
      const sec = sectionById.get(p.section_id);
      const lvl = first(
        sec?.level as LevelLite | LevelLite[] | null | undefined
      );
      const term = termById.get(p.term_id);
      const from = new Date(p.publish_from).getTime();
      const until = new Date(p.publish_until).getTime();
      const status: PublicationOverviewRow['status'] =
        now < from ? 'scheduled' : now > until ? 'expired' : 'active';
      return {
        id: p.id,
        section_id: p.section_id,
        section_name: sec?.name ?? '(unknown)',
        level_label: lvl?.label ?? '',
        level_code: lvl?.code ?? '',
        term_id: p.term_id,
        term_number: term?.term_number ?? 0,
        term_label: term?.label ?? '',
        publish_from: p.publish_from,
        publish_until: p.publish_until,
        status,
        student_count: countBySection.get(p.section_id) ?? 0,
      };
    });

    // Current-term KPIs for the stat cards above the overview. Counts
    // are unique-per-section (one section can have multiple publication
    // attempts for the same term — we only count the section once).
    totalSections = sections.length;
    if (currentTermId) {
      const sectionsPublishedNow = new Set<string>();
      const sectionsScheduled = new Set<string>();
      const sectionsAnyForCurrentTerm = new Set<string>();
      let reach = 0;
      for (const row of overviewRows) {
        if (row.term_id !== currentTermId) continue;
        sectionsAnyForCurrentTerm.add(row.section_id);
        if (row.status === 'active') {
          if (!sectionsPublishedNow.has(row.section_id)) {
            reach += row.student_count;
            sectionsPublishedNow.add(row.section_id);
          }
        } else if (row.status === 'scheduled') {
          sectionsScheduled.add(row.section_id);
        }
      }
      publishedNowCurrentTerm = sectionsPublishedNow.size;
      scheduledCurrentTerm = sectionsScheduled.size;
      studentsReachedCurrentTerm = reach;
      sectionsPendingCurrentTerm =
        totalSections - sectionsAnyForCurrentTerm.size;
    }
  }

  return (
    <>
      {/* Current-term KPI strip — answers "where do we stand on
          this term's report cards right now?" without forcing the
          registrar to mentally aggregate the table below. Sections-
          counted-once: one section can have multiple publication
          attempts for the same term but only counts as 1 here.
          `termList` is empty whenever there is no current AY, so this
          guard also covers the no-AY case. */}
      {termList.length > 0 && (
        <div className="@container/main">
          <div className={KPI_GRID_CLASS}>
            <StatCard
              description="Visible to parents now"
              value={`${publishedNowCurrentTerm} / ${totalSections}`}
              icon={Eye}
              footerTitle={
                publishedNowCurrentTerm === 0
                  ? 'No section visible'
                  : `${publishedNowCurrentTerm} section${publishedNowCurrentTerm === 1 ? '' : 's'} live`
              }
              footerDetail={`${termList.find((t) => t.id === currentTermId)?.label ?? 'Current term'} only`}
            />
            <StatCard
              description="Students reached"
              value={studentsReachedCurrentTerm.toLocaleString('en-SG')}
              icon={Users}
              footerTitle={
                studentsReachedCurrentTerm === 0
                  ? 'No parents will see a card yet'
                  : 'Active publication windows'
              }
              footerDetail="Sum across visible sections"
            />
            <StatCard
              description="Scheduled"
              value={scheduledCurrentTerm.toLocaleString('en-SG')}
              icon={CalendarClock}
              footerTitle={
                scheduledCurrentTerm === 0
                  ? 'None upcoming'
                  : `${scheduledCurrentTerm} window${scheduledCurrentTerm === 1 ? '' : 's'} pending`
              }
              footerDetail="Will open when the start date arrives"
            />
            <StatCard
              description="Pending publish"
              value={sectionsPendingCurrentTerm.toLocaleString('en-SG')}
              icon={AlertCircle}
              footerTitle={
                sectionsPendingCurrentTerm === 0
                  ? 'Every section configured'
                  : `${sectionsPendingCurrentTerm} section${sectionsPendingCurrentTerm === 1 ? '' : 's'} need a window`
              }
              footerDetail="No publication for this term yet"
            />
          </div>
        </div>
      )}
      <AllPublicationsOverview
        publications={overviewRows}
        currentTermId={currentTermId}
      />
    </>
  );
}

/**
 * Section-detail body. Its two reads are COUPLED — the roster rows carry the
 * section's publication status onto every non-withdrawn student — so they
 * cannot be split across two boundaries, but they are independent of each
 * other, so they are issued as one `Promise.all` instead of the two serial
 * awaits this replaced.
 *
 * `PublishWindowPanel` needs no awaited data, but it sits between the stat
 * grid and the roster in the DOM. Hoisting it out would mean two boundaries
 * that each re-read the same two rows, so it rides along here.
 */
async function SectionReportCardsBody({
  sectionId,
  selectedLabel,
  selectedSectionName,
  selectedLevelId,
  termList,
  canPublish,
}: {
  sectionId: string;
  selectedLabel: string | null;
  selectedSectionName: string | null;
  selectedLevelId: string | null;
  termList: TermLite[];
  /**
   * False in the Teacher view — controlling when parents can see a card is an
   * oversight job (§3 ruling). Passed down rather than re-derived here so the
   * panel and the bulk dialog in the header cannot disagree about it.
   */
  canPublish: boolean;
}) {
  const supabase = await createClient();

  type Row = {
    id: string;
    index_number: number;
    enrollment_status: string;
    student:
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }[]
      | null;
  };

  // Publication stats (server-side compute — panel hydrates with its own fetch later).
  // Publications are per-section × term (not per-student), so we derive a single
  // section-level status and apply it to every non-withdrawn row.
  const [enrolmentsRes, pubsRes] = await Promise.all([
    supabase
      .from('section_students')
      .select(
        'id, index_number, enrollment_status, student:students(id, student_number, last_name, first_name, middle_name)'
      )
      .eq('section_id', sectionId)
      .order('index_number'),
    supabase
      .from('report_card_publications')
      .select('id, term_id, publish_from, publish_until')
      .eq('section_id', sectionId),
  ]);

  const enrolments = enrolmentsRes.data;
  const pubs = pubsRes.data;

  let publishedCount = 0;
  let scheduledCount = 0;
  // eslint-disable-next-line react-hooks/purity -- server component, fresh per request
  const now = Date.now();
  for (const p of pubs ?? []) {
    const from = new Date(p.publish_from).getTime();
    const until = new Date(p.publish_until).getTime();
    if (now < from) scheduledCount++;
    else if (now <= until) publishedCount++;
  }

  // Derive a single publication status for the section — if any window is
  // currently active the section is "published"; if any are scheduled it's
  // "scheduled"; if all have closed it's "closed"; otherwise "none".
  const sectionPublicationStatus: ReportCardsRosterRow['publication_status'] =
    publishedCount > 0
      ? 'published'
      : scheduledCount > 0
        ? 'scheduled'
        : (pubs ?? []).length > 0
          ? 'closed'
          : 'none';

  const rosterRows: ReportCardsRosterRow[] = ((enrolments ?? []) as Row[]).map(
    (e) => {
      const s = first(e.student);
      const withdrawn = e.enrollment_status === 'withdrawn';
      return {
        enrolment_id: e.id,
        index_number: e.index_number,
        student_id: s?.id ?? '',
        student_number: s?.student_number ?? '',
        name: s
          ? [s.last_name, s.first_name, s.middle_name]
              .filter(Boolean)
              .join(', ')
          : '(missing)',
        withdrawn,
        publication_status: withdrawn ? 'none' : sectionPublicationStatus,
      };
    }
  );
  const activeCount = rosterRows.filter((r) => !r.withdrawn).length;

  return (
    <>
      {/* Stats */}
      <div className="@container/main">
        <div className={DETAIL_GRID_CLASS}>
          <StatCard
            description={`${selectedLabel ?? 'Section'} · Active`}
            value={activeCount.toLocaleString('en-SG')}
            icon={Users}
            footerTitle="On the roster"
            footerDetail="Eligible for report cards"
          />
          <StatCard
            description="Terms published"
            value={`${publishedCount} / ${termList.length}`}
            icon={CheckCircle2}
            footerTitle={
              publishedCount === 0
                ? 'Nothing visible to parents'
                : `${publishedCount} visible now`
            }
            footerDetail="Within the publish window"
          />
          <StatCard
            description="Scheduled"
            value={scheduledCount.toLocaleString('en-SG')}
            icon={CalendarClock}
            footerTitle={
              scheduledCount === 0
                ? 'None upcoming'
                : 'Upcoming publish windows'
            }
            footerDetail="Not yet visible to parents"
          />
        </div>
      </div>

      {/* Publish window panel — oversight only, see `canPublish`. */}
      {canPublish && selectedLabel && termList.length > 0 && (
        <PublishWindowPanel
          sectionId={sectionId}
          sectionName={selectedSectionName ?? selectedLabel}
          levelId={selectedLevelId}
          terms={termList}
        />
      )}

      {/* Roster */}
      {selectedLabel && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {selectedLabel} · Roster
            </h2>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {rosterRows.length}{' '}
                {rosterRows.length === 1 ? 'student' : 'students'}
              </span>
              {rosterRows.length > 0 && (
                <Link
                  href={`/markbook/report-cards/section/${sectionId}/print`}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <Printer className="h-3 w-3" />
                  Print all
                </Link>
              )}
            </div>
          </div>
          <ReportCardsRosterTable data={rosterRows} />
        </section>
      )}
    </>
  );
}

/**
 * Landing fallback — four KPI cards over the overview table.
 *
 * `AllPublicationsOverview` is a `DataTable` with 7 visible columns
 * (`published_by` starts hidden) and a page size of 25; no column declares a
 * width, so none is invented here.
 */
function PublicationsOverviewFallback() {
  return (
    <>
      <div className="@container/main">
        <SkeletonCards count={4} grid={KPI_GRID_CLASS} />
      </div>
      {/* `pagination`: AllPublicationsOverview sets pageSize={25} and never
          hides the footer bar, so it renders whenever there is a row — and it
          lives inside the table's border, so leaving it out shifts everything
          below it when the data lands. */}
      <SkeletonTable columns={7} rows={10} pagination />
    </>
  );
}

/**
 * Section-detail fallback — three stat cards, the publish-window card, then
 * the roster table. `ReportCardsRosterTable` has 5 visible columns and no
 * pagination; 12 rows is a typical HFSE class.
 */
function SectionReportCardsFallback({ termCount }: { termCount: number }) {
  return (
    <>
      <div className="@container/main">
        <SkeletonCards count={3} grid={DETAIL_GRID_CLASS} />
      </div>
      {termCount > 0 && <PublishWindowPanelFallback termCount={termCount} />}
      <SkeletonTable columns={5} rows={12} />
    </>
  );
}

/**
 * The publish panel draws its own loading state once it mounts (it fetches
 * its windows client-side), so this mirrors that state rather than inventing
 * a second shape — same `Card`, same header, same one row per term.
 */
function PublishWindowPanelFallback({ termCount }: { termCount: number }) {
  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Parent access
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Publish windows
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Share2 className="size-5" />
          </div>
        </CardAction>
      </CardHeader>

      <p className="px-6 pt-4 text-sm leading-relaxed text-muted-foreground">
        Parents sign in to the parent portal and see a term&apos;s report card
        only while its window is active.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-7 gap-y-2 border-y border-border bg-muted/30 px-6 py-3">
        {['Active', 'Scheduled', 'Expired', 'Not set'].map((label) => (
          <span key={label} className="inline-flex items-baseline gap-1.5">
            <Skeleton className="h-5 w-5" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </span>
          </span>
        ))}
      </div>

      <ul className="divide-y divide-border">
        {Array.from({ length: termCount }).map((_, i) => (
          <li key={i} className="flex items-center justify-between px-6 py-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-8 w-24 rounded-md" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {description}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
