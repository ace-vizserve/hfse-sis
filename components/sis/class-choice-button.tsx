'use client';

import { GraduationCap } from 'lucide-react';
import * as React from 'react';

import {
  AssignSectionDialog,
  type AssignSectionMode,
} from '@/components/sis/assign-section-dialog';
import { Button } from '@/components/ui/button';
import type { ApplicationFit } from '@/lib/admissions/options';
import type {
  AssignableLevel,
  AssignableSection,
} from '@/lib/sis/class-assignment';

// The Class Assignment tile's own button on the admissions record — "Choose a
// class", "Change class" or "Assign a class" (see lib/sis/class-tile-state.ts
// for which). Owns the open state for <AssignSectionDialog>; the tile around it
// is a server component. Everything passed in is plain data — the page loads
// the class list and the application fit on the server.

export function ClassChoiceButton({
  mode,
  label,
  enroleeNumber,
  studentName,
  ayCode,
  level,
  sections,
  applicationFit,
}: {
  mode: AssignSectionMode;
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
        mode={mode}
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
