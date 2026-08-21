'use client';

import { Plus, UserSearch } from 'lucide-react';
import { useState } from 'react';

import { DisciplineRecordForm } from '@/components/classroom/discipline-record-form';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

// Filing a record from the CLASS page rather than from one student's drawer.
//
// The drawer is where you file when you already have a child open. This is
// where you file when you have an incident and have to find them — which,
// going by how the school actually works, is the more common of the two: the
// person filing is "the person in charge who is present at the venue"
// (Chandana, 2026-08-14), and they arrive knowing what happened, not knowing
// which row of the roster to click.
//
// SAME FORM, not a second one. The only thing this adds is the step the drawer
// gets for free — which student — so the two entry points cannot drift on what
// a record contains or on how a failure is reported.

export type DisciplineFilingStudent = {
  studentNumber: string;
  studentName: string;
  indexNumber: number;
};

export function FileDisciplineRecordButton({
  sectionId,
  sectionName,
  students,
  variant = 'default',
}: {
  sectionId: string;
  sectionName: string | null;
  students: DisciplineFilingStudent[];
  /** `empty-state` drops the icon, matching the §7.6 empty-state CTA. */
  variant?: 'default' | 'empty-state';
}) {
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState<DisciplineFilingStudent | null>(null);

  function close() {
    setOpen(false);
    // Deferred so the panel does not visibly snap back to the picker while the
    // sheet is still animating out.
    setTimeout(() => setStudent(null), 200);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <SheetTrigger asChild>
        <Button size="sm" className={variant === 'empty-state' ? 'mt-1.5' : ''}>
          <Plus className="size-4" />
          File a record
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <SheetHeader className="gap-1.5 border-b border-border pb-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {sectionName ?? 'This class'}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            {student ? student.studentName : 'Who is this about?'}
          </SheetTitle>
          <SheetDescription>
            {student
              ? `No. ${student.indexNumber} · ${student.studentNumber}`
              : 'Choose the student this incident or letter concerns.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col pt-5">
          {student ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStudent(null)}
                className="-ml-2"
              >
                <UserSearch className="size-4" />
                Choose a different student
              </Button>
              <div className="h-px bg-border" />
              <DisciplineRecordForm
                sectionId={sectionId}
                studentNumber={student.studentNumber}
                record={null}
                onDone={close}
                onCancel={close}
              />
            </div>
          ) : (
            // cmdk rather than a plain list: a roster runs to 50 (Hard Rule
            // #5) and the filer knows the name, so typing beats scrolling.
            // Searchable by index number too, because teachers call students
            // by their number.
            <Command className="min-h-0 flex-1">
              <CommandInput placeholder="Search by name or number…" />
              <CommandList className="max-h-none flex-1">
                <CommandEmpty>Nobody on this class list matches.</CommandEmpty>
                {students.map((s) => (
                  <CommandItem
                    key={s.studentNumber}
                    value={`${s.studentName} ${s.indexNumber} ${s.studentNumber}`}
                    onSelect={() => setStudent(s)}
                    className="gap-3"
                  >
                    <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {s.indexNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {s.studentName}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {s.studentNumber}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
