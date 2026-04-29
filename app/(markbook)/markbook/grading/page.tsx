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
import { getRoleFromClaims } from '@/lib/auth/roles';
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
import { GradingDataTable, type GradingSheetRow } from './grading-data-table';
import { BulkCreateSheetsButton } from '@/components/markbook/bulk-create-sheets-button';

type LevelLite = { id: string; code: string; label: string; level_type: 'primary' | 'secondary' };
type SubjectLite = { id: string; code: string; name: string; is_examinable: boolean };
type SectionLite = { id: string; name: string; level: LevelLite | LevelLite[] | null };
type TermLite = { id: string; term_number: number; label: string };

type SheetRow = {
  id: string;
  is_locked: boolean;
  teacher_name: string | null;
  term: TermLite | TermLite[] | null;
  subject: SubjectLite | SubjectLite[] | null;
  section: SectionLite | SectionLite[] | null;
};

const first = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

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

export default async function GradingListPage() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const userId = (claims?.sub as string | undefined) ?? null;
  const role = getRoleFromClaims(claims);
  const canCreate = role === 'registrar' || role === 'admin' || role === 'superadmin';

  // Current AY — needed before we can scope the sheets query, so awaited
  // up front rather than batched with the others.
  const { data: ayData } = await supabase
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();
  const currentAy = (ayData as { id: string; ay_code: string } | null) ?? null;

  // Three independent, RLS-scoped queries run in parallel.
  const advisorPromise = userId
    ? supabase
        .from('teacher_assignments')
        .select('section:sections(id, name, level:levels(label))')
        .eq('teacher_user_id', userId)
        .eq('role', 'form_adviser')
    : Promise.resolve({ data: [] as unknown });

  // Sheets are scoped to the current AY via `section.ay_code` — the
  // `!inner` modifier is required for PostgREST to honour the nested
  // filter (otherwise the join is LEFT and the filter is silently dropped).
  // Without this filter the table renders sheets across every AY.
  const sheetsPromise = currentAy
    ? supabase
        .from('grading_sheets')
        .select(
          `id, is_locked, teacher_name,
           term:terms(id, term_number, label),
           subject:subjects(id, code, name, is_examinable),
           section:sections!inner(id, name, ay_code, level:levels(id, code, label, level_type))`,
        )
        .eq('section.ay_code', currentAy.ay_code)
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
    (t) => t.grading_lock_date,
  );

  const sheets = sheetsRes.data;
  const sheetIds = (sheets ?? []).map((s: { id: string }) => s.id);

  // grade_entries for blanks_remaining — now scoped to visible sheets only.
  // Blank = null in any slot of ww/pt/qa (or letter_grade for non-examinable).
  // Excludes withdrawn and is_na (late enrollee) students from the count.
  const blanksRes = sheetIds.length > 0
    ? await supabase
        .from('grade_entries')
        .select(
          `grading_sheet_id, ww_scores, pt_scores, qa_score, letter_grade, is_na,
           section_student:section_students(enrollment_status),
           grading_sheet:grading_sheets(subject:subjects(is_examinable))`,
        )
        .in('grading_sheet_id', sheetIds)
    : { data: [] };
  const entriesForBlanks = blanksRes.data;

  type EntryForBlanks = {
    grading_sheet_id: string;
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
    qa_score: number | null;
    letter_grade: string | null;
    is_na: boolean;
    section_student:
      | { enrollment_status: string }
      | { enrollment_status: string }[]
      | null;
    grading_sheet:
      | { subject: { is_examinable: boolean } | { is_examinable: boolean }[] | null }
      | { subject: { is_examinable: boolean } | { is_examinable: boolean }[] | null }[]
      | null;
  };
  const blanksBySheet = new Map<string, { blanks: number; total: number }>();
  for (const e of (entriesForBlanks ?? []) as EntryForBlanks[]) {
    const ss = first(e.section_student);
    if (!ss || ss.enrollment_status === 'withdrawn') continue;
    if (e.is_na) continue;
    const gs = first(e.grading_sheet);
    const subject = first(gs?.subject ?? null);
    const examinable = subject?.is_examinable !== false;
    const bucket =
      blanksBySheet.get(e.grading_sheet_id) ?? { blanks: 0, total: 0 };
    bucket.total += 1;
    let blank = false;
    if (examinable) {
      const ww = (e.ww_scores ?? []) as (number | null)[];
      const pt = (e.pt_scores ?? []) as (number | null)[];
      if (ww.length === 0 || ww.some((s) => s == null)) blank = true;
      if (pt.length === 0 || pt.some((s) => s == null)) blank = true;
      if (e.qa_score == null) blank = true;
    } else {
      if (e.letter_grade == null) blank = true;
    }
    if (blank) bucket.blanks += 1;
    blanksBySheet.set(e.grading_sheet_id, bucket);
  }

  let advisorySections: Array<{ id: string; name: string; level_label: string | null }> = [];
  if (userId) {
    type AA = {
      section:
        | { id: string; name: string; level: { label: string } | { label: string }[] | null }
        | { id: string; name: string; level: { label: string } | { label: string }[] | null }[]
        | null;
    };
    const advisorAssignments = (advisorRes as { data: AA[] | null }).data;
    advisorySections = (advisorAssignments ?? [])
      .map((a) => first(a.section))
      .filter(
        (
          s,
        ): s is {
          id: string;
          name: string;
          level: { label: string } | { label: string }[] | null;
        } => !!s,
      )
      .map((s) => {
        const lvl = first(s.level);
        return { id: s.id, name: s.name, level_label: lvl?.label ?? null };
      });
  }

  const allRows = (sheets ?? []) as SheetRow[];

  // Flatten to GradingSheetRow[] for the data table.
  const tableRows: GradingSheetRow[] = allRows.map((s) => {
    const section = first(s.section);
    const level = first(section?.level ?? null);
    const subject = first(s.subject);
    const term = first(s.term);
    const bucket = blanksBySheet.get(s.id) ?? { blanks: 0, total: 0 };
    return {
      id: s.id,
      section: section?.name ?? '—',
      level: level?.label ?? 'Unknown',
      subject: subject?.name ?? '—',
      term: term?.label ?? '—',
      teacher: s.teacher_name ?? null,
      is_locked: s.is_locked,
      blanks_remaining: bucket.blanks,
      total_students: bucket.total,
    };
  });

  const totalCount = tableRows.length;
  const lockedCount = tableRows.filter((s) => s.is_locked).length;
  const openCount = totalCount - lockedCount;
  const lockedPct = totalCount > 0 ? Math.round((lockedCount / totalCount) * 100) : 0;
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
              <BulkCreateSheetsButton ayId={currentAy.id} ayCode={currentAy.ay_code} />
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
                <span className="opacity-70">
                  · {formatRelativeDays(days)}
                </span>
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
            footerTitle={totalCount > 0 ? `${lockedPct}% of sheets` : 'No sheets yet'}
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
              Write the adviser paragraph that appears on T1&ndash;T3 report cards. Now lives in
              the Evaluation module.
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
        <GradingDataTable data={tableRows} />
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
