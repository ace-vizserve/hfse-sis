import Link from 'next/link';
import {
  AlarmClock,
  ArrowUpRight,
  Layers,
  Lock,
  LockOpen,
  Plus,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { getRoleFromClaims } from '@/lib/auth/roles';
import { getViewContext } from '@/lib/auth/view-context';
import { getTeacherList } from '@/lib/auth/staff-list';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { isAdviserRole, isSubjectRole } from '@/lib/schemas/teacher-assignment';
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
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
import { GradingDataTable, type GradingSheetRow } from './grading-data-table';
import { BulkCreateSheetsButton } from '@/components/markbook/bulk-create-sheets-button';

type LevelLite = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};
type SubjectLite = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};
/**
 * The sheet's own subject_configs row. A config is per-(subject, academic
 * year), so this is where the name the school used THIS year lives (migration
 * 137) — every grading sheet already points at one via subject_config_id, so
 * reaching it costs nothing.
 */
type SubjectConfigLite = { display_name: string | null };
type SectionLite = {
  id: string;
  name: string;
  level: LevelLite | LevelLite[] | null;
};
type TermLite = { id: string; term_number: number; label: string };

type SheetRow = {
  id: string;
  is_locked: boolean;
  teacher_name: string | null;
  term: TermLite | TermLite[] | null;
  subject: SubjectLite | SubjectLite[] | null;
  subject_config: SubjectConfigLite | SubjectConfigLite[] | null;
  section: SectionLite | SectionLite[] | null;
};

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

// Midnight-aligned day delta between today and an ISO date.
// Positive = iso is in the future; negative = past; zero = today.
function daysUntilIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return 0;
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function formatRelativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days < 14) return `in ${days}d`;
  const weeks = Math.round(days / 7);
  return `in ${weeks}w`;
}

export default async function GradingListPage({
  searchParams,
}: {
  searchParams?: Promise<{
    // The grading DataTable's namespaced url-state search key (KD #84) — read so
    // a shared/bookmarked link seeds the search box on the server render too.
    // Section deep-links now drive the client-side `grading.section` facet
    // (KD #84) rather than a server-side scope, so there's no `?section=` here.
    'grading.q'?: string;
  }>;
}) {
  const supabase = await createClient();
  const sp = searchParams ? await searchParams : undefined;
  const initialSearch = sp?.['grading.q'] ?? undefined;

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const userId = (claims?.sub as string | undefined) ?? null;
  const role = getRoleFromClaims(claims);

  // ── THE LENS AND THE ACADEMIC YEAR, ONE WAVE ──────────────────────────
  // Neither reads the other, and `getViewContext()` costs a real
  // `teacher_assignments` select for every non-teacher account — awaiting it on
  // its own line blocked the AY query behind it for nothing. The AY genuinely
  // has to resolve before the sheets query below can be scoped, so it stays
  // ahead of that wave; it just no longer waits on the lens first.
  //
  // The lens takes the account role as its floor (role-switcher Phase 3c).
  const [viewer, { data: ayData }] = await Promise.all([
    getViewContext(),
    supabase
      .from('academic_years')
      .select('id, ay_code')
      .eq('is_current', true)
      .maybeSingle(),
  ]);
  const view = viewer?.activeRole ?? role;
  const currentAy = (ayData as { id: string; ay_code: string } | null) ?? null;

  // ⚠ ON THE LENS. `canCreate` draws the two oversight controls on this page —
  // "New grading sheet" and the multi-select "Lock selected" — and the §3
  // ruling is that in the Teacher view controls that exist only for oversight
  // roles are hidden. Leaving it on the account role while "My sheets" below
  // follows the view would give a teaching admin a teacher's table under an
  // approver's toolbar, which is the half-lensed screen this phase removes.
  //
  // Both routes behind those controls still gate on the REAL role, so this can
  // only ever hide a button she is still allowed to press after switching back
  // — never offer one that would 403.
  const canCreate =
    view === 'academic_coordinator' ||
    view === 'school_admin' ||
    view === 'superadmin';

  // Three independent, RLS-scoped queries run in parallel.
  const advisorPromise = userId
    ? supabase
        .from('teacher_assignments')
        .select('section:sections(id, name, level:levels(label))')
        .eq('teacher_user_id', userId)
        .eq('role', 'form_adviser')
    : Promise.resolve({ data: [] as unknown });

  // Which slots the VIEWER is currently covering for an absent colleague.
  //
  // Deliberately separate from the assignment query below, which builds the
  // Teacher and Form Adviser COLUMNS. Those columns must keep naming the
  // regular teacher for the whole of a cover, so they are left alone; this is
  // only used to decide whether a row belongs under "My sheets", which is a
  // question about who may work on it. One query answering both is how the
  // wrong name ends up in a column.
  const coveredSlots = userId
    ? await loadEffectiveAssignmentsForUser(supabase, userId).then((rows) =>
        rows.filter((r) => r.via === 'relief')
      )
    : [];
  // Both role families. This decides what lands under "My sheets", which is a
  // question about who may work on a sheet — and migration 124's
  // `is_teacher_for_sheet` / `is_adviser_for_section` both admit the co roles.
  const coveredSectionSubject = new Set(
    coveredSlots
      .filter((a) => isSubjectRole(a.role) && a.subject_id)
      .map((a) => `${a.section_id}|${a.subject_id}`)
  );
  const coveredAdviserSections = new Set(
    coveredSlots.filter((a) => isAdviserRole(a.role)).map((a) => a.section_id)
  );

  // Sheets are scoped to the current AY via `section.academic_year_id`
  // (the sections table FKs the AY by UUID, not `ay_code`). The `!inner`
  // modifier is required for PostgREST to honour the nested filter —
  // otherwise the join is LEFT and the filter is silently dropped.
  // Without this filter the table renders sheets across every AY.
  const sheetsPromise = currentAy
    ? supabase
        .from('grading_sheets')
        .select(
          `id, is_locked, teacher_name,
           term:terms(id, term_number, label),
           subject:subjects(id, code, name, is_examinable),
           subject_config:subject_configs(display_name),
           section:sections!inner(id, name, academic_year_id, level:levels(id, code, label, level_type))`
        )
        .eq('section.academic_year_id', currentAy.id)
    : Promise.resolve({ data: [] as Array<{ id: string }> });

  const termLocksPromise = currentAy
    ? supabase
        .from('terms')
        .select('id, term_number, label, grading_lock_date, is_current')
        .eq('academic_year_id', currentAy.id)
        .order('term_number')
    : Promise.resolve({ data: [] });

  const [sheetsRes, advisorRes, termLocksRes] = await Promise.all([
    sheetsPromise,
    advisorPromise,
    termLocksPromise,
  ]);
  type TermLockRow = {
    id: string;
    term_number: number;
    label: string;
    grading_lock_date: string | null;
    is_current: boolean;
  };
  const termLocks = ((termLocksRes.data ?? []) as TermLockRow[]).filter(
    (t) => t.grading_lock_date
  );

  const sheets = sheetsRes.data;
  const sheetIds = (sheets ?? []).map((s: { id: string }) => s.id);

  // Pull every entry for the visible sheets — same field set the per-sheet
  // page uses for its Graded stat. `isExaminable` is read off each sheet's
  // own subject (already loaded above) rather than embedded per-entry.
  //
  // TWO SEPARATE CEILINGS, and this code used to answer only one of them.
  // Chunking the `.in()` filter keeps the request URL under the gateway's
  // ~14.3 KB cap (lib/supabase/paginate.ts measured the exact figure). It does
  // nothing at all about PostgREST's 1,000-row RESPONSE cap, which is a row
  // count and not a byte budget — so the comment that used to sit here,
  // "~4000 rows per request, still under cap because grade_entries rows are
  // skinny", was reasoning about the wrong limit and the page was silently
  // short. Measured in production 2026-08-30: AY2026 has 260 sheets, and the
  // first chunk of 50 returned 1,029 rows against the 1,000 cap — so 29 entries
  // were being dropped, with no error, every time this page rendered, and the
  // Graded percentage on those sheets read low. Now chunked AND paged, the same
  // pairing lib/markbook/dashboard.ts uses over this identical shape.
  type GradedEntry = {
    grading_sheet_id: string;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean;
    section_student:
      | { enrollment_status: string }
      | { enrollment_status: string }[]
      | null;
  };
  // 50 sheet uuids is ~1.9 KB of filter, a quarter of the safe URL budget, so
  // the chunk size is left exactly as it was — the defect was never the chunk
  // width. The catch stays INSIDE the chunk so one failing chunk costs only its
  // own sheets' Graded figures, which is what the previous `continue` did.
  const CHUNK = 50;
  const gradedEntries: GradedEntry[] = await fetchInChunks<GradedEntry>(
    sheetIds,
    async (slice) => {
      try {
        return await fetchAllPages<GradedEntry>((from, to) =>
          supabase
            .from('grade_entries')
            .select(
              `grading_sheet_id, quarterly_grade, letter_grade, is_na,
               section_student:section_students(enrollment_status)`
            )
            .in('grading_sheet_id', slice)
            // Offset paging over an unordered result set is not stable —
            // Postgres is free to hand back a different physical order per
            // request, which lets a row appear on two pages or on none. The
            // primary key is the cheapest deterministic sort available.
            .order('id')
            .range(from, to)
        );
      } catch (err) {
        console.error(
          '[grading list] entries fetch failed:',
          err instanceof Error ? err.message : err
        );
        return [];
      }
    },
    CHUNK
  );

  // Group entries by sheet id so each sheet runs the literal per-sheet
  // gradedPct block against its own rows.
  const entriesBySheet = new Map<string, GradedEntry[]>();
  for (const e of gradedEntries) {
    const list = entriesBySheet.get(e.grading_sheet_id) ?? [];
    list.push(e);
    entriesBySheet.set(e.grading_sheet_id, list);
  }

  // Per-sheet "graded" count — uses the SAME predicate as the sheet-detail page
  // (app/(markbook)/markbook/grading/[id]/page.tsx): a student is graded when
  // quarterly_grade, a UG/E letter_grade override, OR is_na is set — for BOTH
  // subject types, so this list's count matches the detail page. For a
  // non-examinable subject the normal grade is a WW/PT/QA score → a derived
  // A/B/C/IP from quarterly_grade (letter_grade only holds UG/E per KD #104),
  // so the old letter_grade-only check missed normally-graded students.
  const slotsBySheet = new Map<string, { graded: number; total: number }>();
  for (const s of (sheets ?? []) as SheetRow[]) {
    const entries = entriesBySheet.get(s.id) ?? [];
    const activeRows = entries.filter((e) => {
      const ss = first(e.section_student);
      return ss?.enrollment_status !== 'withdrawn';
    });
    const totalStudents = activeRows.length;
    const gradedCount = activeRows.filter(
      (e) => e.quarterly_grade !== null || e.letter_grade !== null || e.is_na
    ).length;
    slotsBySheet.set(s.id, { graded: gradedCount, total: totalStudents });
  }

  let advisorySections: Array<{
    id: string;
    name: string;
    level_label: string | null;
  }> = [];
  if (userId) {
    type AA = {
      section:
        | {
            id: string;
            name: string;
            level: { label: string } | { label: string }[] | null;
          }
        | {
            id: string;
            name: string;
            level: { label: string } | { label: string }[] | null;
          }[]
        | null;
    };
    const advisorAssignments = (advisorRes as { data: AA[] | null }).data;
    advisorySections = (advisorAssignments ?? [])
      .map((a) => first(a.section))
      .filter(
        (
          s
        ): s is {
          id: string;
          name: string;
          level: { label: string } | { label: string }[] | null;
        } => !!s
      )
      .map((s) => {
        const lvl = first(s.level);
        return { id: s.id, name: s.name, level_label: lvl?.label ?? null };
      });
  }

  // All current-AY sheets. Section deep-links now drive the client-side
  // `grading.section` facet (KD #84) instead of a server-side scope, so the
  // page (rows + stat cards) is AY-wide and the table filters in the browser.
  const allRows = (sheets ?? []) as SheetRow[];

  // Resolve teacher assignments for the visible sections via
  // `teacher_assignments` (KD #3 — canonical source for SIS-Admin's
  // "Manage teachers" tab). Two lookups built from one query:
  //   - subjectTeacherBySectionSubject  — drives the Teacher column +
  //     dropdown + the row's `subject_teacher_id` (used by "My sheets")
  //   - formAdviserBySection            — drives the Form Adviser
  //     dropdown + the row's `form_adviser_id` (used by "My sheets")
  //
  // `grading_sheets.teacher_name` (legacy text field) stays as a
  // graceful fallback when no subject_teacher assignment exists.
  const visibleSectionIds = Array.from(
    new Set(
      allRows.map((s) => first(s.section)?.id).filter((v): v is string => !!v)
    )
  );
  const subjectTeacherBySectionSubject = new Map<
    string,
    { userId: string; name: string }
  >(); // key = `${sectionId}|${subjectId}`
  const formAdviserBySection = new Map<
    string,
    { userId: string; name: string }
  >();
  const subjectTeacherUserIds = new Set<string>();
  const formAdviserUserIds = new Set<string>();

  // Hoisted so it can serve both the teacherById lookup inside the block
  // and the dropdown options below — one auth-admin call, not two.
  let teacherList: Awaited<ReturnType<typeof getTeacherList>> = [];

  if (visibleSectionIds.length > 0) {
    const service = createServiceClient();
    const [{ data: assignments }, resolvedTeachers] = await Promise.all([
      service
        .from('teacher_assignments')
        .select('section_id, subject_id, teacher_user_id, role')
        .in('role', ['subject_teacher', 'form_adviser'])
        .in('section_id', visibleSectionIds),
      getTeacherList(),
    ]);
    teacherList = resolvedTeachers;
    const teacherById = new Map(teacherList.map((t) => [t.id, t]));

    for (const a of (assignments ?? []) as Array<{
      section_id: string;
      subject_id: string | null;
      teacher_user_id: string;
      role: 'subject_teacher' | 'form_adviser';
    }>) {
      const t = teacherById.get(a.teacher_user_id);
      if (!t) continue;
      if (a.role === 'subject_teacher' && a.subject_id) {
        const key = `${a.section_id}|${a.subject_id}`;
        // First-write-wins for multi-teacher (section, subject) pairs —
        // comma-joining is too dense for a list cell.
        if (!subjectTeacherBySectionSubject.has(key)) {
          subjectTeacherBySectionSubject.set(key, {
            userId: t.id,
            name: t.name,
          });
          subjectTeacherUserIds.add(t.id);
        }
      } else if (a.role === 'form_adviser') {
        // form_adviser is per-section (subject_id is null on this role).
        if (!formAdviserBySection.has(a.section_id)) {
          formAdviserBySection.set(a.section_id, {
            userId: t.id,
            name: t.name,
          });
          formAdviserUserIds.add(t.id);
        }
      }
    }
  }

  // Dropdown options reuse the already-fetched teacherList — no second call.
  const teacherOptions = teacherList
    .filter((t) => subjectTeacherUserIds.has(t.id))
    .map((t) => t.name);
  const formAdviserOptions = teacherList
    .filter((t) => formAdviserUserIds.has(t.id))
    .map((t) => t.name);

  // Flatten to GradingSheetRow[] for the data table.
  const tableRows: GradingSheetRow[] = allRows.map((s) => {
    const section = first(s.section);
    const level = first(section?.level ?? null);
    const subject = first(s.subject);
    const term = first(s.term);
    const bucket = slotsBySheet.get(s.id) ?? { graded: 0, total: 0 };
    const gradedPct =
      bucket.total > 0 ? Math.round((bucket.graded / bucket.total) * 100) : 0;
    const subjectTeacher =
      section?.id && subject?.id
        ? (subjectTeacherBySectionSubject.get(`${section.id}|${subject.id}`) ??
          null)
        : null;
    const formAdviser = section?.id
      ? (formAdviserBySection.get(section.id) ?? null)
      : null;
    return {
      id: s.id,
      section: section?.name ?? '—',
      level: level?.label ?? 'Unknown',
      school_level: level?.level_type ?? 'primary',
      subject: subject
        ? subjectDisplayName(subject, first(s.subject_config))
        : '—',
      is_examinable: subject?.is_examinable !== false,
      term: term?.label ?? '—',
      teacher: subjectTeacher?.name ?? s.teacher_name ?? null,
      subject_teacher_id: subjectTeacher?.userId ?? null,
      form_adviser: formAdviser?.name ?? null,
      form_adviser_id: formAdviser?.userId ?? null,
      // True when the VIEWER is standing in on this slot. Feeds "My sheets"
      // only — the two name columns above still show the regular teacher.
      covering:
        (section?.id != null &&
          subject?.id != null &&
          coveredSectionSubject.has(`${section.id}|${subject.id}`)) ||
        (section?.id != null && coveredAdviserSections.has(section.id)),
      is_locked: s.is_locked,
      graded_count: bucket.graded,
      total_students: bucket.total,
      graded_pct: gradedPct,
    };
  });

  const totalCount = tableRows.length;
  const lockedCount = tableRows.filter((s) => s.is_locked).length;
  const openCount = totalCount - lockedCount;
  const lockedPct =
    totalCount > 0 ? Math.round((lockedCount / totalCount) * 100) : 0;
  const distinctLevels = new Set(tableRows.map((r) => r.level)).size;

  return (
    <PageShell>
      {/* Hero header */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Grading
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Grading sheets.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            One sheet per subject × section × term. Click a row to enter scores.
          </p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            {currentAy && (
              <BulkCreateSheetsButton
                ayId={currentAy.id}
                ayCode={currentAy.ay_code}
              />
            )}
            <Button asChild>
              <Link href="/markbook/grading/new">
                <Plus className="h-4 w-4" />
                New grading sheet
              </Link>
            </Button>
          </div>
        )}
      </header>

      {/* Grading lock-date advisory strip (per-term). Informational only —
          the actual per-sheet lock is `grading_sheets.is_locked`. */}
      {termLocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.14em]">
            <AlarmClock className="size-3" />
            Grading locks
          </span>
          {termLocks.map((t) => {
            const lockIso = t.grading_lock_date as string;
            const days = daysUntilIso(lockIso);
            const tone =
              days < 0
                ? 'bg-destructive/15 text-destructive'
                : days <= 7
                  ? 'bg-amber-500/20 text-amber-900 dark:text-amber-100'
                  : 'bg-muted text-foreground';
            return (
              <span
                key={t.id}
                className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono font-semibold ${tone}`}
                title={`${t.label} lock target: ${lockIso}`}
              >
                <span className="opacity-80">{t.label}</span>
                <span className="tabular-nums">
                  {new Date(lockIso).toLocaleDateString('en-SG', {
                    day: '2-digit',
                    month: 'short',
                  })}
                </span>
                <span className="opacity-70">· {formatRelativeDays(days)}</span>
                {t.is_current && (
                  <span className="rounded-sm bg-primary/20 px-1 text-[9px] uppercase text-primary">
                    current
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Stat cards */}
      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <StatCard
            description="Total sheets"
            value={totalCount}
            icon={Layers}
            footerTitle={`${distinctLevels} ${distinctLevels === 1 ? 'level' : 'levels'}`}
            footerDetail="Across every term in the current AY"
          />
          <StatCard
            description="Open"
            value={openCount}
            icon={LockOpen}
            footerTitle="Teachers can edit"
            footerDetail="Draft or in progress"
          />
          <StatCard
            description="Locked"
            value={lockedCount}
            icon={Lock}
            footerTitle={
              totalCount > 0 ? `${lockedPct}% of sheets` : 'No sheets yet'
            }
            footerDetail="Post-lock edits require approval"
          />
        </div>
      </div>

      {/* Advisory shortcut */}
      {advisorySections.length > 0 && (
        <Card className="@container/card">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Form Class Adviser
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Sections you advise
            </CardTitle>
            <CardAction>
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Sparkles className="size-5" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Write the adviser paragraph that appears on T1&ndash;T3 report
              cards. Now lives in the Evaluation module.
            </p>
            <div className="flex flex-wrap gap-2">
              {advisorySections.map((s) => (
                <Button key={s.id} asChild variant="outline" size="sm">
                  <Link href={`/evaluation/sections/${s.id}`}>
                    {s.level_label ? `${s.level_label} · ` : ''}
                    {s.name} · Write-ups
                    <ArrowUpRight />
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state or data table */}
      {totalCount === 0 ? (
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="font-serif text-lg font-semibold text-foreground">
              No grading sheets yet
            </div>
            <div className="text-sm text-muted-foreground">
              {canCreate
                ? 'Create the first sheet for a subject × section × term.'
                : 'Ask the registrar to create a sheet for your class.'}
            </div>
            {canCreate && (
              <Button asChild>
                <Link href="/markbook/grading/new">
                  <Plus className="h-4 w-4" />
                  New grading sheet
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <GradingDataTable
          data={tableRows}
          initialSearch={initialSearch}
          teacherOptions={teacherOptions}
          formAdviserOptions={formAdviserOptions}
          // "My sheets" is teacher-scoped — registrars + admins manage
          // every section, so the toggle has no useful narrowing for
          // them. Pass null to hide it.
          //
          // ⚠ ON THE LENS (role-switcher Phase 3c). This page already computes
          // the covered-slot and adviser sets from this viewer's own assignment
          // rows a hundred lines up, for every role — it was only the account
          // role at this one line that threw the answer away, so a teaching
          // admin got the school-wide table with no way to narrow it to the
          // sheets she personally teaches. Client-side filter over rows the
          // server already returned, so nothing about what she may read moves.
          currentUserId={view === 'teacher' ? userId : null}
          // Multi-select + "Lock selected" — same role set as the single
          // lock route (registrar / school_admin / superadmin).
          canLock={canCreate}
        />
      )}
    </PageShell>
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
