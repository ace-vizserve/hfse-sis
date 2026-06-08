import { redirect } from 'next/navigation';

import { VirtueThemesEditor } from '@/components/evaluation/virtue-themes-editor';
import { PageShell } from '@/components/ui/page-shell';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/supabase/server';

export default async function VirtueThemesPage() {
  const session = await getSessionUser();
  if (!session) redirect('/login');
  if (
    session.role !== 'registrar' &&
    session.role !== 'school_admin' &&
    session.role !== 'superadmin'
  ) {
    redirect('/evaluation');
  }

  const service = createServiceClient();
  const ayCode = await requireCurrentAyCode(service);

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id, label')
    .eq('ay_code', ayCode)
    .maybeSingle();

  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    start_date: string | null;
    end_date: string | null;
    virtue_theme: string | null;
  };

  let terms: TermRow[] = [];
  if (ayRow) {
    const { data } = await service
      .from('terms')
      .select('id, term_number, label, start_date, end_date, virtue_theme')
      .eq('academic_year_id', (ayRow as { id: string }).id)
      .gte('term_number', 1)
      .lte('term_number', 3) // T1–T3 only — T4 has no FCA comment (KD #49)
      .order('term_number');
    terms = (data ?? []) as TermRow[];
  }

  return (
    <PageShell>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Evaluation · {ayCode}
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Virtue themes.
        </h1>
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
          The virtue theme for each term prints on the report card as the Form
          Class Adviser&rsquo;s Comments heading (&ldquo;HFSE Virtues:
          &hellip;&rdquo;) and frames the advisers&rsquo; write-ups. Terms
          1&ndash;3 only.
        </p>
      </header>

      {terms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No terms configured for this academic year yet.
        </div>
      ) : (
        <VirtueThemesEditor
          terms={terms.map((t) => ({
            id: t.id,
            label: t.label,
            termNumber: t.term_number,
            startDate: t.start_date,
            endDate: t.end_date,
            virtueTheme: t.virtue_theme ?? '',
          }))}
        />
      )}
    </PageShell>
  );
}
