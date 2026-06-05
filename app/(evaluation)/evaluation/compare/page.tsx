import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  CompareGrid,
  type CompareGridMetric,
} from '@/components/dashboard/compare-grid';
import { CompareToolbar } from '@/components/dashboard/compare-toolbar';
import { PageShell } from '@/components/ui/page-shell';
import { listAyCodes } from '@/lib/academic-year';
import { parseCompareParams } from '@/lib/dashboard/compare';
import {
  getEvaluationCompareKpis,
  type EvaluationCompareKpis,
} from '@/lib/evaluation/compare';
import { createClient, getSessionUser } from '@/lib/supabase/server';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

export default async function EvaluationComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ays?: string; terms?: string; months?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.has(sessionUser.role)) {
    notFound();
  }

  const sp = await searchParams;
  const supabase = await createClient();
  const ayCodes = await listAyCodes(supabase);
  const input = parseCompareParams(sp);

  const compareData = input ? await getEvaluationCompareKpis(input) : null;

  const metrics: CompareGridMetric<EvaluationCompareKpis>[] = [
    {
      key: 'submissionPct',
      label: 'Submission %',
      format: 'percent',
      getValue: (d) => d.submissionPct,
      direction: 'higherIsBetter',
    },
    {
      key: 'submitted',
      label: 'Submitted',
      format: 'number',
      getValue: (d) => d.submitted,
      direction: 'higherIsBetter',
    },
    {
      key: 'expected',
      label: 'Expected',
      format: 'number',
      getValue: (d) => d.expected,
    },
  ];

  return (
    <PageShell>
      <Link
        href="/evaluation"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Evaluation
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Evaluation · Compare
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Term-on-term, year-on-year.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Pick the academic years and terms you want to line up, side by side.
          Numbers are equivalent slices — T1 of one AY against T1 of another —
          so you can spot real movement.
        </p>
      </header>

      <CompareToolbar kind="term" ayCodes={ayCodes} initial={input} />

      {!input ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          Pick at least one AY and one term above to see the comparison.
        </div>
      ) : compareData && compareData.cells.length > 0 ? (
        <CompareGrid
          title="KPI comparison"
          description={`${compareData.cells.length} cell${compareData.cells.length === 1 ? '' : 's'} — ${input.ays.join(', ')} × ${input.kind === 'term' ? input.terms.map((t) => `T${t}`).join(', ') : ''}`}
          cells={compareData.cells}
          metrics={metrics}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          No data found for this selection. Verify the AYs and terms are seeded.
        </div>
      )}
    </PageShell>
  );
}
