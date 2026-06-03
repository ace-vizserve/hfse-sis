'use client';

import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EnrolmentEditSheet } from '@/components/sis/enrolment-edit-sheet';
import type { EnrollmentStatus } from '@/lib/schemas/enrolment';

// Client wrapper for the Records placement-tab edit pencil.
//
// EnrolmentEditSheet's trigger uses Radix `<SheetTrigger asChild>{children}>`,
// which clones the child and attaches a ref. When the child Button is created
// by a *server* component and passed across the RSC boundary, Radix's Slot
// fails to render it (the trigger comes out empty). The SIS sections page works
// because it renders the sheet from a client component (section-roster-table);
// the Records student page is a server component, so it must hand the
// sheet+trigger to a client boundary — this component. Props are all
// serializable so the server page can render it directly.
export function PlacementEditButton(props: {
  sectionId: string;
  enrolmentId: string;
  ayCode: string;
  studentName: string;
  indexNumber: number;
  initial: {
    bus_no: string | null;
    classroom_officer_role: string | null;
    enrollment_status: EnrollmentStatus;
    withdrawal_reason: string | null;
    withdrawal_notes: string | null;
    late_enrollee_term_number: number | null;
  };
}) {
  return (
    <EnrolmentEditSheet
      sectionId={props.sectionId}
      enrolmentId={props.enrolmentId}
      ayCode={props.ayCode}
      studentName={props.studentName}
      indexNumber={props.indexNumber}
      initial={props.initial}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        title="Edit enrolment details"
      >
        <Pencil className="size-3" />
        <span className="sr-only">Edit enrolment</span>
      </Button>
    </EnrolmentEditSheet>
  );
}
