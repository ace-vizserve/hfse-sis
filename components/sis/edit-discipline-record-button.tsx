'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { DisciplineRecordForm } from '@/components/classroom/discipline-record-form';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { formatRecordDate } from '@/lib/discipline/display';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';

// Correcting a filing from the Records student page (#7).
//
// Leadership could always do this — `canManageAnyDisciplineRecord` says so and
// the PATCH route honours it — but the only Edit button in the app was in the
// Classroom drawer, which is a teacher's surface. So the permission existed
// and the button did not.
//
// SAME FORM as the drawer, not a second one: it switches to PATCH purely on
// `record !== null`, and every row already carries the `sectionId` and
// `studentNumber` the route needs. A per-row Sheet is safe here because this
// tab is a page, not itself a Sheet — nested dialogs are what the codebase
// bans, and there is no outer dialog to nest inside.

export function EditDisciplineRecordButton({
  record,
}: {
  record: DisciplineRecordRow;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <SheetHeader className="gap-1.5 border-b border-border pb-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {record.className ?? 'Record'} ·{' '}
            {formatRecordDate(record.occurredOn)}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            {record.studentName ??
              record.studentNumber ??
              'Correct this record'}
          </SheetTitle>
          <SheetDescription>
            Corrections are recorded on the audit log, with what changed.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
          <DisciplineRecordForm
            sectionId={record.sectionId}
            studentNumber={record.studentNumber ?? ''}
            record={record}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
