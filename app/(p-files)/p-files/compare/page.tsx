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
  getPFilesCompareKpis,
  type PFilesCompareKpis,
} from '@/lib/p-files/compare';
import { createClient, getSessionUser } from '@/lib/supabase/server';

const ALLOWED_ROLES = new Set(['p-file', 'school_admin', 'superadmin']);

export default async function PFilesComparePage({
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

  const compareData = input ? await getPFilesCompareKpis(input) : null;

  const metrics: CompareGridMetric<PFilesCompareKpis>[] = [
    {
      key: 'revisionsInRange',
      label: 'Revisions in range',
      format: 'number',
      getValue: (d) => d.revisionsInRange,
    },
    {
      key: 'expiringSoon30',
      label: 'Expiring ≤30d',
      format: 'number',
      getValue: (d) => d.expiringSoon30,
      direction: 'lowerIsBetter',
    },
    {
      key: 'expiringSoon',
      label: 'Expiring ≤60d',
      format: 'number',
      getValue: (d) => d.expiringSoon,
      direction: 'lowerIsBetter',
    },
    {
      key: 'totalDocuments',
      label: 'Total documents',
      format: 'number',
      getValue: (d) => d.totalDocuments,
    },
  ];

  return (
    <PageShell>
      <Link
        href="/p-files"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to P-Files
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          P-Files · Compare
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Month-on-month, year-on-year.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Pick the months you want to line up, side by side — e.g. the same
          calendar month across years for an honest seasonal comparison. Each
          month draws from its own academic year automatically.
        </p>
      </header>

      <CompareToolbar kind="month" ayCodes={ayCodes} initial={input} />

      {!input ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          Pick one or more months above to see the comparison.
        </div>
      ) : compareData && compareData.cells.length > 0 ? (
        <CompareGrid
          title="KPI comparison"
          description={`${compareData.cells.length} month${compareData.cells.length === 1 ? '' : 's'} — ${compareData.cells.map((c) => c.cell.label).join(', ')}`}
          cells={compareData.cells}
          metrics={metrics}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          No data found for this selection. Verify the AYs and months are
          seeded.
        </div>
      )}
    </PageShell>
  );
}
