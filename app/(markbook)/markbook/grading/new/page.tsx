import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { getTeacherList } from '@/lib/auth/staff-list';
import { sgToday } from '@/lib/dates';
import { createClient, getSessionUser } from '@/lib/supabase/server';

import { NewSheetForm } from './new-sheet-form';

// Only registrar + superadmin can create new grading sheets — matches the
// sidebar registry in lib/auth/roles.ts and the API gate at
// /api/grading-sheets POST. proxy.ts admits teacher + school_admin onto
// /markbook/* for read access, so we must defend at the page level too.
const ALLOWED_ROLES = new Set(['registrar', 'superadmin']);

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

  const [termsRes, sectionsRes, subjectsRes, configsRes, teachers] =
    await Promise.all([
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
        .from('subject_configs')
        .select('subject_id, level_id, ww_max_slots, pt_max_slots, qa_max')
        .eq('academic_year_id', ayId),
      getTeacherList(),
    ]);

  for (const [key, res] of [
    ['terms', termsRes],
    ['sections', sectionsRes],
    ['subjects', subjectsRes],
    ['configs', configsRes],
  ] as const) {
    if (res.error) {
      console.error(`[new-sheet] ${key} query failed:`, res.error.message);
    }
  }

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
        subjects={subjectsRes.data ?? []}
        configs={configsRes.data ?? []}
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
