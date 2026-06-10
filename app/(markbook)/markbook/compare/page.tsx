import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  CompareGrid,
  type CompareGridMetric,
} from '@/components/dashboard/compare-grid';
import { CompareToolbar } from '@/components/dashboard/compare-toolbar';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { listAyCodes } from '@/lib/academic-year';
import { parseCompareParams } from '@/lib/dashboard/compare';
import {
  getMarkbookCompareKpis,
  getSubjectPerformanceTrend,
  type MarkbookCompareKpis,
  type SubjectTrendPoint,
} from '@/lib/markbook/compare';
import { createClient, getSessionUser } from '@/lib/supabase/server';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

export default async function MarkbookComparePage({
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

  // Fetch KPIs first (builds the cells, which carry termId), then derive
  // the subject-performance trend from those same cells. Sequential because
  // the trend query depends on compareData.cells.
  let compareData: Awaited<ReturnType<typeof getMarkbookCompareKpis>> | null =
    null;
  let trendPoints: SubjectTrendPoint[] = [];
  if (input) {
    compareData = await getMarkbookCompareKpis(input);
    trendPoints = await getSubjectPerformanceTrend(compareData.cells);
  }

  const metrics: CompareGridMetric<MarkbookCompareKpis>[] = [
    {
      key: 'gradesEntered',
      label: 'Grade entries',
      format: 'number',
      getValue: (d) => d.gradesEntered,
    },
    {
      key: 'sheetsLocked',
      label: 'Sheets locked',
      format: 'number',
      getValue: (d) => d.sheetsLocked,
      direction: 'higherIsBetter',
    },
    {
      key: 'lockedPct',
      label: 'Lock %',
      format: 'percent',
      getValue: (d) => d.lockedPct,
      direction: 'higherIsBetter',
    },
    {
      key: 'changeRequestsPending',
      label: 'CRs pending',
      format: 'number',
      getValue: (d) => d.changeRequestsPending,
      direction: 'lowerIsBetter',
    },
    {
      key: 'avgDecisionHours',
      label: 'Avg decision (hrs)',
      format: 'days',
      getValue: (d) => d.avgDecisionHours,
      direction: 'lowerIsBetter',
    },
  ];

  return (
    <PageShell>
      <Link
        href="/markbook"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Markbook
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Markbook · Compare
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
        <>
          <SubjectPerformanceCharts
            cells={compareData.cells}
            trendPoints={trendPoints}
          />
          <CompareGrid
            title="KPI comparison"
            description={`${compareData.cells.length} cell${compareData.cells.length === 1 ? '' : 's'} — ${input.kind === 'term' ? input.ays.join(', ') + ' × ' + input.terms.map((t) => 'T' + t).join(', ') : ''}`}
            cells={compareData.cells}
            metrics={metrics}
          />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          No data found for this selection. Verify the AYs and terms are seeded.
        </div>
      )}
    </PageShell>
  );
}

/**
 * Renders one subject performance chart per AY.
 * One line per examinable subject; X axis = selected terms in order.
 * Hidden entirely when no trend data is available.
 */
function SubjectPerformanceCharts({
  cells,
  trendPoints,
}: {
  cells: Array<{
    cell: { ayCode: string; termId?: string; termNumber?: number };
  }>;
  trendPoints: SubjectTrendPoint[];
}) {
  if (trendPoints.length === 0) return null;

  // Group trend points by AY
  const byAy = new Map<string, SubjectTrendPoint[]>();
  for (const pt of trendPoints) {
    if (!byAy.has(pt.ayCode)) byAy.set(pt.ayCode, []);
    byAy.get(pt.ayCode)!.push(pt);
  }

  // Period order: T1 < T2 < T3 < T4
  const allPeriods = [
    ...new Set(
      cells
        .map((c) => (c.cell.termNumber ? `T${c.cell.termNumber}` : null))
        .filter((p): p is string => p !== null)
    ),
  ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  const ayEntries = Array.from(byAy.entries());

  return (
    <div
      className={`grid grid-cols-1 gap-6 ${ayEntries.length > 1 ? 'md:grid-cols-2' : ''}`}
    >
      {ayEntries.map(([ayCode, points]) => {
        const subjects = [...new Set(points.map((p) => p.subjectName))].sort();
        if (subjects.length === 0) return null;

        const chartData = allPeriods.map((period) => {
          const row: Record<string, string | number | null> = { x: period };
          for (const subject of subjects) {
            const pt = points.find(
              (p) => p.periodLabel === period && p.subjectName === subject
            );
            row[subject] = pt?.avgGrade ?? null;
          }
          return row;
        });

        const series = subjects.map((s) => ({ key: s, label: s }));

        return (
          <Card key={ayCode} className="@container/card">
            <CardHeader className="space-y-1">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Average quarterly grade
              </CardDescription>
              <CardTitle className="font-serif text-[18px] font-semibold tracking-tight text-foreground">
                Subject Performance — {ayCode}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MultiSeriesTrendChart
                series={series}
                data={chartData}
                yFormat="number"
                yDomain={[0, 100]}
                height={240}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
