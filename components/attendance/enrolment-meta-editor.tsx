'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';

// Shared editor for the attendance sheet's Details-view roster metadata.
// One instance mounted per grid (single portal, matches the cell-mark
// popover's perf invariant) — this file is pure presentation; the parent
// (wide-grid.tsx) owns the PATCH mutation and passes it in via `onSave`.
// Each field's visibility is gated by its own capability boolean — Academics
// and Admin are omitted entirely (not disabled) for a viewer who can't edit
// them, matching this feature's "hidden, not shown-disabled" requirement.
export function EnrolmentMetaEditor({
  enrolment,
  canEditBusCare,
  canEditAcademics,
  canEditAdmin,
  saving,
  onSave,
}: {
  enrolment: WideGridEnrolment;
  canEditBusCare: boolean;
  canEditAcademics: boolean;
  canEditAdmin: boolean;
  saving: boolean;
  onSave: (patch: Record<string, string | null>) => void;
}) {
  const [busNo, setBusNo] = useState(enrolment.busNo ?? '');
  const [officerRole, setOfficerRole] = useState(
    enrolment.classroomOfficerRole ?? ''
  );
  const [academicsNotes, setAcademicsNotes] = useState(
    enrolment.academicsNotes ?? ''
  );
  const [adminNotes, setAdminNotes] = useState(enrolment.adminNotes ?? '');

  function handleSave() {
    const patch: Record<string, string | null> = {};
    if (canEditBusCare) {
      patch.bus_no = busNo.trim() || null;
      patch.classroom_officer_role = officerRole.trim() || null;
    }
    if (canEditAcademics) patch.academics_notes = academicsNotes.trim() || null;
    if (canEditAdmin) patch.admin_notes = adminNotes.trim() || null;
    onSave(patch);
  }

  return (
    <SheetContent className="flex flex-col gap-4">
      <SheetHeader>
        <SheetTitle>{enrolment.studentName}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4">
        {canEditBusCare && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="meta-bus-no">Bus number</Label>
              <Input
                id="meta-bus-no"
                value={busNo}
                maxLength={40}
                onChange={(e) => setBusNo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meta-officer-role">Classroom officer role</Label>
              <Input
                id="meta-officer-role"
                value={officerRole}
                maxLength={80}
                onChange={(e) => setOfficerRole(e.target.value)}
              />
            </div>
          </>
        )}
        {canEditAcademics && (
          <div className="space-y-1.5">
            <Label htmlFor="meta-academics-notes">Academics notes</Label>
            <Textarea
              id="meta-academics-notes"
              value={academicsNotes}
              maxLength={200}
              onChange={(e) => setAcademicsNotes(e.target.value)}
            />
          </div>
        )}
        {canEditAdmin && (
          <div className="space-y-1.5">
            <Label htmlFor="meta-admin-notes">Admin notes</Label>
            <Textarea
              id="meta-admin-notes"
              value={adminNotes}
              maxLength={200}
              onChange={(e) => setAdminNotes(e.target.value)}
            />
          </div>
        )}
      </div>
      <SheetFooter>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}
