// Classroom class-page roster — a plain shadcn Table, not the <DataTable>
// shell. Phase 2 is deliberately minimal (no term axis, no per-term
// artifact lists yet — see the design doc's Phase 4); a section roster
// tops out at 50 students (Hard Rule #5), so a bare sortable/searchable
// table buys nothing here. Rows are already scoped to "on the roster"
// (active + late enrollee) by the caller — withdrawn students aren't
// part of the day-to-day class.

import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type ClassroomRosterRow = {
  id: string;
  index_number: number;
  student_number: string;
  student_name: string;
  enrollment_status: 'active' | 'late_enrollee';
};

export function ClassroomRosterTable({ data }: { data: ClassroomRosterRow[] }) {
  if (data.length === 0) {
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono tabular-nums text-muted-foreground">
                {row.index_number}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.student_number || '—'}
              </TableCell>
              <TableCell>
                <IdentifierLink
                  href={`/records/students/${row.student_number}`}
                >
                  {row.student_name}
                </IdentifierLink>
              </TableCell>
              <TableCell>
                <EnrollmentStatusBadge status={row.enrollment_status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
