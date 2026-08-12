'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import {
  StaffAssignmentSheet,
  type StaffSheetTeacher,
} from '@/components/sis/staff-assignment-sheet';
import { Button } from '@/components/ui/button';

/**
 * "Change classes" on the teacher page — opens the SAME editor the staff table
 * opens.
 *
 * Deliberately not a second implementation. Adding a class is easy to rebuild;
 * REMOVING one is not, because a removal mid-year has to capture a reason
 * (`AssignmentRemovalDialog`, gated on whether the year has started), and the
 * form-adviser path is a delete-then-create with its own failure handling. A
 * second copy of that would drift from this one, and the drifted copy would be
 * the one that quietly stopped asking why a teacher was taken off a class.
 *
 * Gated on `staff.edit_assignments`, which the academic coordinator holds —
 * so on this page she can change who teaches what, and cannot arrange cover.
 * Those are two different buttons with two different capabilities, side by
 * side, which is the point.
 */
export function TeacherAssignmentEditorButton({
  teacher,
  ayCode,
  canEdit,
  label = 'Edit classes',
  variant = 'outline',
}: {
  teacher: StaffSheetTeacher;
  ayCode: string;
  canEdit: boolean;
  label?: string;
  variant?: 'outline' | 'ghost';
}) {
  const [open, setOpen] = useState(false);

  if (!canEdit) return null;

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        {label}
      </Button>
      <StaffAssignmentSheet
        teacher={teacher}
        ayCode={ayCode}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
