// Classroom class-page roster — a plain shadcn Table, not the <DataTable>
// shell. Phase 2 is deliberately minimal (no term axis, no per-term
// artifact lists yet — see the design doc's Phase 4); a section roster
// tops out at 50 students (Hard Rule #5), so a bare sortable/searchable
// table buys nothing here. Rows are already scoped to "on the roster"
// (active + late enrollee) by the caller — withdrawn students aren't
// part of the day-to-day class.
//
// 'use client' as of Phase 6: the display order now honours the caller's
// student-order preference (Settings tab, lib/classroom/use-student-order.ts
// — localStorage, no server round trip). `data` still arrives pre-sorted by
// index number from the server (so it's never empty/unsorted before
// hydration); this component only re-sorts client-side when the stored
// preference says "alphabetical."

'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { HouseChip } from '@/components/ui/house-chip';
import { StudentRecordLink } from '@/components/ui/student-record-link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { sortRosterByOrder } from '@/lib/classroom/student-order';
import { useStudentOrder } from '@/lib/classroom/use-student-order';

export type ClassroomRosterRow = {
  id: string;
  /** students.id — the report card is keyed by it, not by student_number. */
  student_id: string | null;
  index_number: number;
  student_number: string;
  student_name: string;
  enrollment_status: 'active' | 'late_enrollee';
  /** The student's house — spans P1-S4, so it cannot be inferred from the
   * section. Null when unassigned, which is a normal state. */
  house_name: string | null;
  house_colour_token: string | null;
};

export function ClassroomRosterTable({
  sectionId,
  data,
  showReportCard = false,
  showRecordLink,
}: {
  sectionId: string;
  data: ClassroomRosterRow[];
  /**
   * Adviser + oversight only — the caller decides via
   * `canReadReportCard(capability)`. This is the only route into a report card
   * for a form adviser: they have no Report Cards nav item, and the
   * report-cards index is coordinator-and-above.
   */
  showReportCard?: boolean;
  /**
   * Oversight only — the caller decides via `canOpenStudentRecord(capability)`.
   * Required on purpose: a forgotten decision must fail the build rather than
   * quietly re-create the dead link this replaced.
   */
  showRecordLink: boolean;
}) {
  const [order] = useStudentOrder(sectionId);
  const rows = sortRosterByOrder(data, order);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        No students on the roster yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-14">#</TableHead>
            <TableHead>Student number</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            {showReportCard && (
              <TableHead className="w-32 text-right">
                <span className="sr-only">Report card</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono tabular-nums text-muted-foreground">
                {row.index_number}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.student_number || '—'}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  <StudentRecordLink
                    studentNumber={row.student_number}
                    canOpen={showRecordLink}
                  >
                    {row.student_name}
                  </StudentRecordLink>
                  <HouseChip
                    name={row.house_name}
                    colourToken={row.house_colour_token}
                  />
                </span>
              </TableCell>
              <TableCell>
                <EnrollmentStatusBadge status={row.enrollment_status} />
              </TableCell>
              {showReportCard && (
                <TableCell className="text-right">
                  {row.student_id ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/markbook/report-cards/${row.student_id}`}>
                        Report card
                      </Link>
                    </Button>
                  ) : null}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
