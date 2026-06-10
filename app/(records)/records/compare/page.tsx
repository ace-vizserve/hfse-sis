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
  getRecordsCompareKpis,
  type RecordsCompareKpis,
} from '@/lib/sis/records-compare';
import { createClient, getSessionUser } from '@/lib/supabase/server';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

export default async function RecordsComparePage({
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

  const compareData = input ? await getRecordsCompareKpis(input) : null;

  const metrics: CompareGridMetric<RecordsCompareKpis>[] = [
    {
      key: 'activeEnrolled',
      label: 'Active enrolled',
      format: 'number',
      getValue: (d) => d.activeEnrolled,
    },
    {
      key: 'enrollmentsInRange',
      label: 'Enrollments in range',
      format: 'number',
      getValue: (d) => d.enrollmentsInRange,
      direction: 'higherIsBetter',
    },
    {
      key: 'lateEnroleesInRange',
      label: 'Late enrolees',
      format: 'number',
      getValue: (d) => d.lateEnroleesInRange,
    },
    {
      key: 'withdrawalsInRange',
      label: 'Withdrawals in range',
      format: 'number',
      getValue: (d) => d.withdrawalsInRange,
      direction: 'lowerIsBetter',
    },
    {
      key: 'expiringSoon',
      label: 'Expiring soon',
      format: 'number',
      getValue: (d) => d.expiringSoon,
      direction: 'lowerIsBetter',
    },
  ];

  return (
    <PageShell>
      <Link
        href="/records"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Records
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Compare
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
