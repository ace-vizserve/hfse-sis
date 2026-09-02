import { School, Users } from 'lucide-react';

import { UpcomingCoverPanel } from '@/components/relief/upcoming-cover';
import { DeclarationsWaitingPanel } from '@/components/attendance/declarations-waiting-panel';
import { countInboxActionable } from '@/lib/approvals/inbox';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/declarations/approval';
import { loadUpcomingCoverForUser } from '@/lib/relief/upcoming';
import { showWrongViewNotice } from '@/components/auth/wrong-view-notice';
import { SwitchViewButton } from '@/components/view-switch/switch-view-button';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import { getViewContext } from '@/lib/auth/view-context';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { isAdviserRole } from '@/lib/schemas/teacher-assignment';
import { sgToday } from '@/lib/dates';
import { loadFormAdvisersBySection } from '@/lib/sis/staff';
import { Badge } from '@/components/ui/badge';
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
import { AttendanceSectionsDataTable } from '@/components/attendance/sections-data-table';
import type { AttendanceSectionRow } from '@/components/attendance/sections-data-table';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

export default async function AttendanceSectionsListPage() {
  const session = await getViewContext();
  const role = session?.role ?? null;
  // ✅ THIS PAGE NOW SCOPES ON THE LENS (role-switcher Phase 3c), and that
  // closes the gap the wrong-view notice was built to apologise for. Until
  // this change a teaching admin in the Teacher view was a `school_admin`
  // here, so `isTeacherOnly` was false and she was shown every section in the
  // school — each row linking to a register her lensed
  // `/attendance/[sectionId]` then refused. The notice still exists for the
  // routes nothing on screen narrows (a bookmark, a link in an old email), but
  // it is no longer the thing standing between a listed row and a 404.
  //
  // ONE FLAG, FIVE DECISIONS, deliberately kept as one: the adviser-only
  // section query, the heading, the empty state, the KPI label and
  // `showAdviser` all mean "am I looking at this as a class teacher". Splitting
  // them would let the list narrow while the heading still said "Pick a
  // section."
  //
  // `role` (the account) survives here as the floor `isTeacherOnly` falls back
  // to when no lens is set, and for nothing else — the declarations count below
  // reads `session.role` straight off the context rather than this binding. It
  // stays on the account either way: "how many filings are waiting on YOU to
  // decide" is an approval-inbox question, and the queue at
  // /attendance/declarations would disagree with a lensed number.
  //
  // The comment that used to sit here claimed the row destination came from
  // "the shared classroom scope resolver" so it could not drift from
  // Classroom. It did not: `resolveClassroomScope` was imported and never
  // called, and `isTeacherOnly` below decides everything. The import and the
  // claim are both gone — a wrong comment about where a decision lives costs
  // more than no comment at all.
  const isTeacherOnly = (session?.activeRole ?? role) === 'teacher';
  // Is this narrowing the result of a VIEW the person chose, rather than of
  // the account they hold? Drives one extra line on the empty state — without
  // it a teaching admin who advises no class reads "the registrar has not
  // assigned you", which is true but unhelpful when she is the office.
  const narrowedByView = session ? showWrongViewNotice(session) : false;

  const supabase = await createClient();

  // ── WAVE 1: the two panels and the year, none of which knows the others ──
  // The upcoming-cover panel and the declarations badge are keyed on the
  // session alone, and the current academic year on nothing at all. They were
  // three consecutive `await`s.
  const [upcomingCover, declarationsWaiting, { data: ay }] = await Promise.all([
    // Cover booked for this teacher that has not started yet (migration 123).
    // Caller's client on purpose: the row-read policy is deliberately
    // unwindowed.
    isTeacherOnly && session
      ? loadUpcomingCoverForUser(supabase, session.id)
      : Promise.resolve([]),
    // Declarations waiting on this person. Never throws — one panel must not
    // be able to take the section picker down with it, and zero is honest: the
    // queue at /attendance/declarations is the authority either way.
    session
      ? countInboxActionable(createServiceClient(), {
          flow: DECLARATION_APPROVAL_FLOW,
          userId: session.id,
          role: session.role,
        }).catch((e) => {
          console.error(
            '[attendance] declarations count failed:',
            e instanceof Error ? e.message : String(e)
          );
          return 0;
        })
      : Promise.resolve(0),
    supabase
      .from('academic_years')
      .select('id, ay_code, label')
      .eq('is_current', true)
      .single(),
  ]);

  // Scope by academic_year_id — terms.is_current can be true across
  // multiple AYs (the wipe-AY2026/27 script preserved terms rows along
  // with their is_current flag, so an unscoped query returns the wrong
  // AY's term). Pair with today's-date fallback so the badge stays
  // honest even if no term has is_current set.
  const today = sgToday();
  type TermRow = {
    id: string;
    label: string;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
  };
  // ── WAVE 2: three questions of the academic year ──────────────────────
  // The term list, the teacher's advised-section scope and the section list
  // are all keyed on `ay` and on nothing produced by each other. The scope
  // arm is two deep INTERNALLY (assignments, then narrow them to this year)
  // and that pair is a real dependency, left as it is.
  //
  // ── Form-adviser scoping (PRESERVED) ────────────────────────────────────
  // Teachers see only sections where they have a form_adviser assignment.
  // Registrar+ see all sections in the current AY.
  const [{ data: currentTerm }, allowedSectionIds, { data: sections }] =
    await Promise.all([
      ay
        ? supabase
            .from('terms')
            .select('id, label, start_date, end_date, is_current')
            .eq('academic_year_id', ay.id)
            .order('term_number', { ascending: true })
        : Promise.resolve({ data: [] as TermRow[] }),
      isTeacherOnly && session?.id && ay
        ? (async (): Promise<Set<string> | null> => {
            // Held OR covered — a substitute needs the class they are taking
            // the register for to appear in this list at all.
            //
            // The shared loader has no AY filter, so the AY narrowing the old
            // inline query did with `sections.academic_year_id` is applied
            // here instead. It matters: without it a prior year's adviser row
            // would put a section on this list that the current-AY query
            // beside it never returns, and the count and the table would
            // disagree.
            const service = createServiceClient();
            const assignments = await loadEffectiveAssignmentsForUser(
              service,
              session.id
            );
            const advisedIds = assignments
              // isAdviserRole — a co-adviser's classes belong in their list too.
              .filter((a) => isAdviserRole(a.role))
              .map((a) => a.section_id);
            const { data: thisYear } = advisedIds.length
              ? await service
                  .from('sections')
                  .select('id')
                  .eq('academic_year_id', ay.id)
                  .in('id', advisedIds)
              : { data: [] };
            return new Set(
              ((thisYear ?? []) as Array<{ id: string }>).map((s) => s.id)
            );
          })()
        : Promise.resolve(null),
      ay
        ? supabase
            .from('sections')
            .select('id, name, level:levels(id, code, label, level_type)')
            .eq('academic_year_id', ay.id)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              name: string;
              level: LevelLite | LevelLite[] | null;
            }>,
          }),
    ]);

  const termRows = (currentTerm ?? []) as TermRow[];
  const activeTerm =
    termRows.find(
      (t) =>
        t.start_date &&
        t.end_date &&
        t.start_date <= today &&
        t.end_date >= today
    ) ??
    termRows.find((t) => t.is_current) ??
    null;

  const getLevel = (l: LevelLite | LevelLite[] | null): LevelLite | null =>
    Array.isArray(l) ? (l[0] ?? null) : l;

  // Apply form-adviser filter then build rows + unique levels for the table.
  const filteredSections = (sections ?? []).filter(
    (s) => !allowedSectionIds || allowedSectionIds.has(s.id)
  );

  // ── WAVE 3: the two per-row lookups ───────────────────────────────────
  // Roster counts and the adviser names both fall out of the section list and
  // neither reads the other. `ids` stays the UNFILTERED section list, exactly
  // as before — the count map is keyed by id and the filter is applied when
  // the rows are built.
  const ids = (sections ?? []).map((s) => s.id);
  const [{ data: enrolments }, adviserMap] = await Promise.all([
    ids.length > 0
      ? supabase
          .from('section_students')
          .select('section_id, enrollment_status')
          .in('section_id', ids)
      : Promise.resolve({
          data: [] as Array<{
            section_id: string;
            enrollment_status: string | null;
          }>,
        }),
    // Load advisers only for registrar+ views (for teachers the adviser is
    // always themselves — surfacing it would be redundant noise).
    !isTeacherOnly && ay
      ? loadFormAdvisersBySection(
          filteredSections.map((s) => s.id),
          ay.ay_code
        )
      : Promise.resolve({} as Record<string, { userId: string; name: string }>),
  ]);

  const counts: Record<string, number> = {};
  for (const row of enrolments ?? []) {
    if (row.enrollment_status !== 'withdrawn') {
      counts[row.section_id] = (counts[row.section_id] ?? 0) + 1;
    }
  }

  const rows: AttendanceSectionRow[] = filteredSections.map((s) => {
    const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
    return {
      id: s.id,
      name: s.name,
      levelLabel: lvl?.label ?? 'Unknown',
      active: counts[s.id] ?? 0,
      fcaName: adviserMap[s.id]?.name ?? null,
    };
  });

  // Unique levels list for the facet filter (deduplicated by label).
  const seenLabels = new Set<string>();
  const levels: { id: string; code: string; label: string }[] = [];
  for (const s of filteredSections) {
    const lvl = getLevel(s.level as LevelLite | LevelLite[] | null);
    if (lvl && !seenLabels.has(lvl.label)) {
      seenLabels.add(lvl.label);
      levels.push({ id: lvl.id, code: lvl.code, label: lvl.label });
    }
  }

  const totalSections = rows.length;
  const totalActive = rows.reduce((n, r) => n + r.active, 0);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Attendance · Daily entry
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {isTeacherOnly ? 'Your sections.' : 'Pick a section.'}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {/* "form-advise" was an invented verb. The app's own vocabulary is
                "form adviser" — it is a column header on the table below. */}
            {isTeacherOnly
              ? 'The sections you are the form adviser for. Click through to mark daily attendance for the chosen date.'
              : 'Every section in the current academic year. Click through to mark or review daily attendance.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ay && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {ay.ay_code}
            </Badge>
          )}
          {activeTerm && (
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {activeTerm.label}
            </Badge>
          )}
        </div>
      </header>

      {/* Cover booked for this teacher that has not started. Not a link and
          never the word "covering" — see components/relief/upcoming-cover.tsx. */}
      <UpcomingCoverPanel covers={upcomingCover} className="mt-6" />

      {/* Also mounted here, and not only on the module index: a teacher who
          advises nothing is REDIRECTED to this page, and a named approver on a
          teacher account (an officer in charge, say) is exactly that person —
          they would otherwise never see the panel at all. */}
      <DeclarationsWaitingPanel count={declarationsWaiting} className="mt-6" />

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
          <SummaryCard
            description={isTeacherOnly ? 'Your sections' : 'Total sections'}
            value={totalSections}
            icon={School}
            footerTitle={`${levels.length} ${levels.length === 1 ? 'level' : 'levels'}`}
            footerDetail={ay?.label ?? 'No current AY'}
          />
          <SummaryCard
            description="Students covered"
            value={totalActive}
            icon={Users}
            footerTitle="Currently enrolled"
            footerDetail="Across the sections above"
          />
        </div>
      </div>

      {rows.length === 0 && (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="font-serif text-lg font-semibold text-foreground">
              {isTeacherOnly ? 'No sections assigned' : 'No sections yet'}
            </div>
            <div className="text-sm text-muted-foreground">
              {/* Three states, not two. The middle one is new and exists
                  because this page now narrows on the VIEW: a school admin who
                  advises no class sees an empty list here the moment she
                  switches to Teacher, and "the registrar has not assigned you"
                  reads as nonsense to the person who IS the office.
                  ⚠ The role name is built from ROLE_LABEL rather than written
                  as "Teacher", because the lens is whatever `activeRole` says —
                  hard-coding it would be a caption that lies the moment a
                  second lens exists. */}
              {isTeacherOnly && narrowedByView
                ? `You're viewing as ${ROLE_LABEL[session!.activeRole!]}, which shows only the classes you are the form adviser for.`
                : isTeacherOnly
                  ? 'The registrar has not assigned you as a form adviser for any section yet.'
                  : 'Run the seed SQL or ask the registrar to create sections for the current AY.'}
            </div>
            {/* Paired with the switch, like every other lens refusal in the
                app. Telling somebody which setting narrowed the page and then
                leaving them to find the switcher is half a message — and this
                button comes back to this same page afterwards. */}
            {isTeacherOnly && narrowedByView && session?.role && (
              <SwitchViewButton
                target={session.role}
                activeRole={session.activeRole}
              />
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <AttendanceSectionsDataTable
          rows={rows}
          levels={levels}
          today={today}
          showAdviser={!isTeacherOnly}
        />
      )}
    </PageShell>
  );
}

function SummaryCard({
  description,
  value,
  icon: Icon,
  footerTitle,
  footerDetail,
}: {
  description: string;
  value: number;
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
          {value.toLocaleString('en-SG')}
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
