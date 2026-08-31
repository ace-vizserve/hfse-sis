import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { getTeacherList } from '@/lib/auth/staff-list';
import { sgToday } from '@/lib/dates';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

import { NewSheetForm } from './new-sheet-form';

// Only academic_coordinator + superadmin can create new grading sheets — matches the
// sidebar registry in lib/auth/roles.ts and the API gate at
// /api/grading-sheets POST. proxy.ts admits teacher + school_admin onto
// /markbook/* for read access, so we must defend at the page level too.
const ALLOWED_ROLES = new Set(['academic_coordinator', 'superadmin']);

export default async function NewGradingSheetPage() {
  const sessionUser = await getSessionUser();
  if (
    !sessionUser ||
    !sessionUser.role ||
    !ALLOWED_ROLES.has(sessionUser.role)
  ) {
    notFound();
  }

  const supabase = await createClient();

  const { data: ay, error: ayErr } = await supabase
    .from('academic_years')
    .select('id, ay_code')
    .eq('is_current', true)
    .maybeSingle();

  if (ayErr) {
    console.error('[new-sheet] failed to load current AY:', ayErr.message);
    return <NoAYError reason="lookup" />;
  }
  if (!ay) {
    return <NoAYError reason="missing" />;
  }
  const ayId = ay.id as string;

  // Migration 080 dropped subject_configs.level_id, so "which subjects are
  // offered at a level" (Pattern A) and "what are this subject's WW/PT/QA
  // maxes" (Pattern B) are now two separate queries. NewSheetForm's subject
  // picker still needs a per-(subject × level) row shape to filter the
  // subject list by the selected section's level, so the two are joined
  // below into the same Config[] shape the form already expects — no
  // change needed to new-sheet-form.tsx.
  const [
    termsRes,
    sectionsRes,
    subjectsRes,
    offeringsRes,
    subjectConfigsRes,
    teachers,
  ] = await Promise.all([
    supabase
      .from('terms')
      .select('id, term_number, label, is_current, start_date, end_date')
      .eq('academic_year_id', ayId)
      .order('term_number'),
    supabase
      .from('sections')
      .select('id, name, level:levels(id, code, label, level_type)')
      .eq('academic_year_id', ayId)
      .order('name'),
    supabase
      .from('subjects')
      .select('id, code, name, is_examinable')
      .order('name'),
    supabase
      .from('subject_level_offerings')
      .select('subject_id, level_id')
      .eq('academic_year_id', ayId),
    supabase
      .from('subject_configs')
      // display_name is what the school calls this subject in the year being
      // set up (migration 137) — already the right row, already the right
      // year, so the picker just has to read it.
      .select('subject_id, display_name, ww_max_slots, pt_max_slots, qa_max')
      .eq('academic_year_id', ayId),
    getTeacherList(),
  ]);

  for (const [key, res] of [
    ['terms', termsRes],
    ['sections', sectionsRes],
    ['subjects', subjectsRes],
    ['offerings', offeringsRes],
    ['subjectConfigs', subjectConfigsRes],
  ] as const) {
    if (res.error) {
      console.error(`[new-sheet] ${key} query failed:`, res.error.message);
    }
  }

  type OfferingRow = { subject_id: string; level_id: string };
  type SubjectConfigRow = {
    subject_id: string;
    /** This year's name for the subject, or null if it was never renamed. */
    display_name: string | null;
    ww_max_slots: number;
    pt_max_slots: number;
    qa_max: number;
  };
  const configBySubjectId = new Map(
    ((subjectConfigsRes.data ?? []) as SubjectConfigRow[]).map((c) => [
      c.subject_id,
      c,
    ])
  );
  // Rebuild the (subject × level) rows the picker needs, cross-referencing
  // the level-membership table against the weight-config table by
  // subject_id — an offering with no matching config is skipped (no
  // slot/max data to seed the form with).
  const mergedConfigs = ((offeringsRes.data ?? []) as OfferingRow[])
    .map((o) => {
      const cfg = configBySubjectId.get(o.subject_id);
      if (!cfg) return null;
      return {
        subject_id: o.subject_id,
        level_id: o.level_id,
        ww_max_slots: cfg.ww_max_slots,
        pt_max_slots: cfg.pt_max_slots,
        qa_max: cfg.qa_max,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);

  // Pick the default term by today's date (matches getTermForDate semantics
  // from lib/sis/terms.ts), falling back to terms.is_current, then term 1.
  // is_current is a per-AY flag the seeder sets — can drift, so date wins.
  const today = sgToday();
  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    is_current: boolean;
    start_date: string | null;
    end_date: string | null;
  };
  const termRows = (termsRes.data ?? []) as TermRow[];
  const byDate = termRows.find(
    (t) =>
      t.start_date && t.end_date && t.start_date <= today && t.end_date >= today
  );
  const byFlag = termRows.find((t) => t.is_current);
  const defaultTermId = (byDate ?? byFlag ?? termRows[0])?.id ?? '';

  return (
    <PageShell>
      <Link
        href="/markbook/grading"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to grading sheets
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Grading · New sheet
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          New grading sheet.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Creates one sheet for the selected{' '}
          <span className="font-medium text-foreground">
            subject × section × term
          </span>{' '}
          and seeds a blank grade entry for every active student.
        </p>
      </header>

      <NewSheetForm
        terms={termRows.map((t) => ({
          id: t.id,
          term_number: t.term_number,
          label: t.label,
          is_current: t.id === defaultTermId,
        }))}
        sections={
          (sectionsRes.data ?? []) as Parameters<
            typeof NewSheetForm
          >[0]['sections']
        }
        // The picker names subjects to a person setting up sheets for THIS
        // year, so each one arrives already called what the year calls it
        // (migration 137). `code` is untouched — it is the identity the form
        // and every static list key on.
        subjects={(
          (subjectsRes.data ?? []) as {
            id: string;
            code: string;
            name: string;
            is_examinable: boolean;
          }[]
        ).map((s) => ({
          ...s,
          name: subjectDisplayName(s, configBySubjectId.get(s.id)),
        }))}
        configs={mergedConfigs}
        teachers={teachers}
        defaultTermId={defaultTermId}
      />
    </PageShell>
  );
}

function NoAYError({ reason }: { reason: 'lookup' | 'missing' }) {
  const message =
    reason === 'missing'
      ? 'No active academic year is set. Open SIS Admin · Settings to switch the operational AY before creating grading sheets.'
      : 'Could not load the active academic year. Check the server logs and refresh.';
  return (
    <PageShell>
      <Link
        href="/markbook/grading"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to grading sheets
      </Link>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Grading · New sheet
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Can&apos;t create a sheet right now.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          {message}
        </p>
      </header>
    </PageShell>
  );
}
