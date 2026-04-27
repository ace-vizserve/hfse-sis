import * as React from 'react';
import { Download } from 'lucide-react';

import { PageShell } from '@/components/ui/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CohortKey, CohortScope } from '@/lib/sis/cohorts';

// ─── Cohort page shell ──────────────────────────────────────────────────────
//
// Shared chrome for every cohort page (3 cohorts × 2 scopes = 6 surfaces).
// Renders the canonical PageShell + serif title + count Badge + description,
// optional filter-chip strip slot above the table, and a CSV download button
// pinned to the header. Per-cohort `<*-cohort-table>` is passed in as
// `children` from the calling page RSC (Wave 2).
//
// Server component — no event handlers; clientside controls (filter chips,
// search, density) live inside the table component.

export type CohortPageShellProps = {
  cohort: CohortKey;
  title: string;
  description: string;
  count: number;
  ayCode: string;
  scope: CohortScope;
  /** Optional filter chip strip — typically a `<CohortFilterChips>`-style
   *  client component that lives next to the per-cohort table. Renders right
   *  above the children block. */
  filterChips?: React.ReactNode;
  children: React.ReactNode;
};

function buildCsvHref(cohort: CohortKey, ayCode: string, scope: CohortScope): string {
  const params = new URLSearchParams();
  params.set('ay', ayCode);
  params.set('scope', scope);
  params.set('format', 'csv');
  return `/api/sis/cohorts/${cohort}?${params.toString()}`;
}

export function CohortPageShell({
  cohort,
  title,
  description,
  count,
  ayCode,
  scope,
  filterChips,
  children,
}: CohortPageShellProps) {
  const csvHref = buildCsvHref(cohort, ayCode, scope);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `cohort-${cohort}-${scope}-${ayCode}-${today}.csv`;

  return (
    <PageShell>
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {scope === 'enrolled' ? 'Records · Cohort' : 'Admissions · Cohort'} · {ayCode}
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <Badge variant="outline">
              {count.toLocaleString('en-SG')} {count === 1 ? 'student' : 'students'}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={csvHref} download={filename}>
              <Download className="size-3.5" />
              Download CSV
            </a>
          </Button>
        </div>
      </header>

      {/* Filter chip strip (optional) */}
      {filterChips ? (
        <div className="flex flex-wrap items-center gap-2">{filterChips}</div>
      ) : null}

      {/* Table — passed in by the calling page */}
      <div>{children}</div>
    </PageShell>
  );
}
