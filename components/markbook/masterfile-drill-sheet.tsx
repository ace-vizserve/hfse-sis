'use client';

import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  EnrollmentStatusBadge,
  type EnrollmentStatus,
} from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  buildMasterfileDrillRows,
  type MasterfileDrillStatus,
  type MasterfileDrillTarget,
} from '@/lib/markbook/masterfile-drill';
import type { MasterfileDashboardFilters } from '@/lib/markbook/masterfile-dashboard';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Academic Summary drill sheet. CLIENT-SIDE: derives the matching student/sheet
// rows from the already-loaded payload via buildMasterfileDrillRows — no fetch.
// Bounded lists (per-class ≤50, per-level a few hundred) so a plain scrollable
// <Table> is enough; no virtualization.

const STATUS_TO_ENROLLMENT: Record<MasterfileDrillStatus, EnrollmentStatus> = {
  Active: 'active',
  'Late enrollee': 'late_enrollee',
  Withdrawn: 'withdrawn',
};

export function MasterfileDrillSheet({
  payload,
  filters,
  target,
  open,
  onOpenChange,
}: {
  payload: MasterfilePayload;
  filters: MasterfileDashboardFilters;
  target: MasterfileDrillTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const result = useMemo(() => {
    if (!target) return null;
    return buildMasterfileDrillRows(payload, filters, target);
  }, [payload, filters, target]);

  const rows = result?.rows ?? [];
  const rowUnit = result?.rowUnit ?? 'students';
  const unitLabel = rowUnit === 'sheets' ? 'sheets' : 'students';
  // Self-labeling count: "N students" / "N sheets" so the sheet's total never
  // looks like it should equal the card's cell / write-up-slot count.
  const countLabel = `${rows.length} ${rows.length === 1 ? unitLabel.slice(0, -1) : unitLabel}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="space-y-2 border-b border-hairline px-6 pb-4 pt-6 text-left">
          <div className="flex items-center gap-2">
            <SheetTitle>{result?.title ?? 'Details'}</SheetTitle>
            <Badge variant="secondary" className="tabular-nums">
              {countLabel}
            </Badge>
          </div>
          <SheetDescription>
            {rows.length === 0
              ? 'Nothing matches this selection in the current scope.'
              : result?.description
                ? rowUnit === 'sheets'
                  ? result.description
                  : `${result.description} Click a name to open the student’s full record.`
                : 'Click a name to open the student’s full record.'}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Nothing to show
              </p>
              <p className="max-w-[20rem] text-xs text-muted-foreground">
                Everything in this scope is accounted for.
              </p>
            </div>
          ) : (
            <Table noWrapper>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {rowUnit === 'students' && (
                    <TableHead className="w-12 pl-6">#</TableHead>
                  )}
                  <TableHead
                    className={rowUnit === 'students' ? undefined : 'pl-6'}
                  >
                    Student
                  </TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">
                    {result?.statLabel ?? 'Detail'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow
                    key={`${row.studentNumber ?? row.studentName}-${i}`}
                  >
                    {rowUnit === 'students' && (
                      <TableCell className="w-12 pl-6">
                        <span className="font-mono text-sm tabular-nums text-muted-foreground">
                          {row.indexNumber ?? '—'}
                        </span>
                      </TableCell>
                    )}
                    <TableCell
                      className={rowUnit === 'students' ? undefined : 'pl-6'}
                    >
                      {row.studentNumber ? (
                        <IdentifierLink
                          href={`/records/students/${encodeURIComponent(row.studentNumber)}`}
                        >
                          {row.studentName}
                        </IdentifierLink>
                      ) : (
                        <span className="font-medium text-foreground">
                          {row.studentName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.sectionName}
                    </TableCell>
                    <TableCell>
                      <EnrollmentStatusBadge
                        status={STATUS_TO_ENROLLMENT[row.status]}
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {row.stat}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
