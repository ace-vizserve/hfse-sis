'use client';

import { GraduationCap } from 'lucide-react';
import * as React from 'react';

import { AssignSectionDialog } from '@/components/sis/assign-section-dialog';
import { Button } from '@/components/ui/button';
import type { ApplicationFit } from '@/lib/admissions/options';
import type {
  AssignableLevel,
  AssignableSection,
} from '@/lib/sis/class-assignment';

// The Class Assignment tile's own "Assign a class" button on the admissions
// record, shown only once the application is Enrolled (see
// lib/sis/class-tile-state.ts). Owns the open state for <AssignSectionDialog>;
// the tile around it is a server component. Everything passed in is plain
// data — the page loads the class list and the application fit on the server.

export function ClassChoiceButton({
  label,
  enroleeNumber,
  studentName,
  ayCode,
  level,
  sections,
  applicationFit,
}: {
  label: string;
  enroleeNumber: string;
  studentName: string;
  ayCode: string;
  level: AssignableLevel | null;
  sections: AssignableSection[];
  applicationFit: ApplicationFit | null;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-1 self-start"
        onClick={() => setOpen(true)}
      >
        <GraduationCap className="size-3.5" />
        {label}
      </Button>
      <AssignSectionDialog
        enroleeNumber={enroleeNumber}
        studentName={studentName}
        ayCode={ayCode}
        level={level}
        availableSections={sections}
        applicationFit={applicationFit}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
