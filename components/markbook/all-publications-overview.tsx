'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Cross-section view of every publication window in the current AY.
// Renders on /markbook/report-cards when no section is picked, so registrars
// land on a "what's published right now" snapshot instead of an empty state.
//
// Per row = one (section × term) publication window. Status (active /
// scheduled / expired) is computed at request time. Clicking "Open" deep-
// links into that section's existing roster view.

export type PublicationOverviewRow = {
  id: string;
  section_id: string;
  section_name: string;
  level_label: string;
  level_code: string;
  term_id: string;
  term_number: number;
  term_label: string;
  publish_from: string;
  publish_until: string;
  status: 'active' | 'scheduled' | 'expired';
  student_count: number;
};

const STATUS_ORDER: Record<PublicationOverviewRow['status'], number> = {
  active: 0,
  scheduled: 1,
  expired: 2,
};

const DATE_FMT: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };

export function AllPublicationsOverview({
  publications,
  currentTermId,
}: {
  publications: PublicationOverviewRow[];
  /** When set + the table is on the "Current term" tab (default), only
   *  rows for that term render. Setting null disables the filter. */
  currentTermId?: string | null;
}) {
  // Term-scope tab — defaults to "current" so the registrar lands on
  // this term's publications. Falls back to "all" when no current term
  // is configured (legacy AY edge case) so the table stays useful.
  const [termScope, setTermScope] = React.useState<'current' | 'all'>(
    currentTermId ? 'current' : 'all',
  );

  if (publications.length === 0) {
    return (
      <Card className="items-center py-16 text-center">
        <CardContent className="flex flex-col items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileText className="size-5" />
          </div>
          <div className="space-y-1">
            <div className="font-serif text-xl font-semibold text-foreground">
              No publication windows yet
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Pick a section above and open a publication window to make report cards visible
              to parents. Active windows will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Apply term scope before sorting + counting so the badges + table
  // both reflect the visible set.
  const scoped =
    termScope === 'current' && currentTermId
      ? publications.filter((p) => p.term_id === currentTermId)
      : publications;

  // Sort: active first, then scheduled, then expired. Within group: by level
  // code, section name, term number — so the most relevant rows are on top
  // and registrars can scan a single section's term run downward.
  const sorted = scoped.slice().sort((a, b) => {
    if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (a.level_code !== b.level_code) return a.level_code.localeCompare(b.level_code);
    if (a.section_name !== b.section_name) return a.section_name.localeCompare(b.section_name);
    return a.term_number - b.term_number;
  });

  const activeCount = scoped.filter((p) => p.status === 'active').length;
  const scheduledCount = scoped.filter((p) => p.status === 'scheduled').length;
  const expiredCount = scoped.filter((p) => p.status === 'expired').length;

  // Tab counts (full-set numbers — show what's available across all
  // terms vs. what falls inside the current term).
  const currentTermCount = currentTermId
    ? publications.filter((p) => p.term_id === currentTermId).length
    : 0;
  const allTermsCount = publications.length;

  return (
    <Card className="@container/card gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Across all sections · Current AY
        </CardDescription>
        <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
          Published report cards
        </CardTitle>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {activeCount > 0 && <Badge variant="success">{activeCount} active</Badge>}
            {scheduledCount > 0 && <Badge variant="warning">{scheduledCount} scheduled</Badge>}
            {expiredCount > 0 && <Badge variant="muted">{expiredCount} expired</Badge>}
          </div>
          {currentTermId && (
            <Tabs
              value={termScope}
              onValueChange={(v) => setTermScope(v as 'current' | 'all')}
            >
              <TabsList>
                <TabsTrigger value="current">
                  Current term
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                    {currentTermCount}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="all">
                  All terms
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                    {allTermsCount}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[80px]">Level</TableHead>
              <TableHead>Section</TableHead>
              <TableHead className="w-[120px]">Term</TableHead>
              <TableHead className="w-[160px]">Window</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Students</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No publication windows for this term yet. Switch to{' '}
                  <button
                    type="button"
                    onClick={() => setTermScope('all')}
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    All terms
                  </button>{' '}
                  to see other terms&apos; windows.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((row) => (
              <TableRow key={row.id} className="group">
                <TableCell>
                  <Badge variant="outline">{row.level_code}</Badge>
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {row.section_name}
                </TableCell>
                <TableCell>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      T{row.term_number}
                    </span>
                    <span className="text-[13px] text-foreground">{row.term_label}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {formatDate(row.publish_from)} – {formatDate(row.publish_until)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.student_count}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/markbook/report-cards?section_id=${row.section_id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-transform hover:underline [&>svg]:hover:translate-x-0.5 [&>svg]:hover:-translate-y-0.5"
                  >
                    Open
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: PublicationOverviewRow['status'] }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'scheduled') return <Badge variant="warning">Scheduled</Badge>;
  return <Badge variant="muted">Expired</Badge>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', DATE_FMT);
}
