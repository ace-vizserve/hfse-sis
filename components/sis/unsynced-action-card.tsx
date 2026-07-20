'use client';

import { AlertTriangle, ArrowUpRight, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { AssignSectionDialog } from '@/components/sis/assign-section-dialog';
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type {
  AssignableLevel,
  AssignableSection,
} from '@/lib/sis/class-assignment';

// ──────────────────────────────────────────────────────────────────────────
// Top-of-fold action card on the Records lite page (rendered when the
// student has admissions history but no `public.students` row — i.e. the
// per-row sync hasn't completed yet because `classSection` was never set).
//
// Owns the open-state for <AssignSectionDialog>; everything else on the
// lite page is RSC. The secondary "Open in admissions" button is a plain
// next/link so the user can pivot to the admissions-side editor without
// needing the dialog.
// ──────────────────────────────────────────────────────────────────────────

type Props = {
  enroleeNumber: string;
  ayCode: string;
  level: AssignableLevel | null;
  studentName: string;
  availableSections: AssignableSection[];
};

export function UnsyncedActionCard({
  enroleeNumber,
  ayCode,
  level,
  studentName,
  availableSections,
}: Props) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Alert variant="warning">
        <AlertIcon variant="warning">
          <AlertTriangle />
        </AlertIcon>
        <AlertTitle>
          Grading access is not yet set up for this student.
        </AlertTitle>
        <AlertDescription>
          <p>
            This student is enrolled but does not have a class section assigned.
            Once a section is assigned, grades and attendance will be available
            here.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => setOpen(true)}>
              <GraduationCap className="size-4" />
              Assign to a section
            </Button>
            <Button variant="outline" asChild>
              <Link
                href={`/admissions/applications/${encodeURIComponent(enroleeNumber)}?ay=${encodeURIComponent(ayCode)}&tab=enrollment`}
              >
                Open in admissions
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
      <AssignSectionDialog
        enroleeNumber={enroleeNumber}
        ayCode={ayCode}
        level={level}
        studentName={studentName}
        availableSections={availableSections}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
