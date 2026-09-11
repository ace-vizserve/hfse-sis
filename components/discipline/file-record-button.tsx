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

// Filing a disciplinary record — the ONE place it happens, on the school-wide
// register at /classroom/discipline.
//
// ⚠ THIS IS THE CLASS-PAGE PICKER, WIDENED. It was
// `components/classroom/file-discipline-record-button.tsx`, scoped to one
// roster, and it was deleted on 2026-09-11 along with the two other filing
// surfaces. Christina Labrador, T4 teachers' training, 10 Sep: *"make it just
// a view tab for all the teachers, rather than use it to file incidents. So we
// have one centralized template to file any incident."* The two-step shape
// survived the move because it was already right — the person filing is "the
// person in charge who is present at the venue" (Chandana, 2026-08-14), and
// they arrive knowing what happened, not knowing which row to click.
//
// What changed is the size of the haystack: one class became every student in
// the year, so the list now carries the class name and searching by it is the
// point rather than a nicety.
//
// SAME FORM, not a second one. The only thing this adds is the step a student
// drawer used to get for free — which student — so nothing here can drift from
// what a record contains or from how a failure is reported.
//
// ⚠ THE SECTION COMES FROM THE STUDENT, NOT FROM THE FILER. The write route is
// `POST /api/classroom/[sectionId]/students/[studentNumber]/discipline`, and it
// resolves `student_id`, `section_id` and `academic_year_id` server-side from
// those two path segments — never from the body. So this component's only job
// is to name the right pair, and it cannot redirect a record onto a child it
// was not opened on.

export type FilingStudent = {
  studentNumber: string;
  studentName: string;
  /** The class the record will be filed against — a record is a fact about a
   *  student IN a class, and `section_id` is stored as it was at filing time. */
  sectionId: string;
  sectionName: string;
  indexNumber: number;
};

export function FileDisciplineRecordButton({
  students,
}: {
  /** Every student on roll in the selected year, across every class. */
  students: FilingStudent[];
}) {
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState<FilingStudent | null>(null);

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
        <Button>
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
            {student ? student.sectionName : 'New record'}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            {student ? student.studentName : 'Who is this about?'}
          </SheetTitle>
          <SheetDescription>
            {student
              ? `No. ${student.indexNumber} · ${student.studentNumber}`
              : 'Search any student in the school by name, class or number.'}
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
                sectionId={student.sectionId}
                studentNumber={student.studentNumber}
                record={null}
                onDone={close}
                onCancel={close}
              />
            </div>
          ) : (
            // cmdk rather than a plain list. On one roster that was a
            // convenience; across the school it is the only workable shape —
            // the filer knows the name, and typing beats scrolling several
            // hundred rows. Searchable by class and by index number too,
            // because teachers call students by their number and the office
            // usually knows the class before the name.
            <Command className="min-h-0 flex-1">
              <CommandInput placeholder="Search by name, class or number…" />
              <CommandList className="max-h-none flex-1">
                <CommandEmpty>
                  Nobody on this year&apos;s roll matches.
                </CommandEmpty>
                {students.map((s) => (
                  <CommandItem
                    key={`${s.sectionId}-${s.studentNumber}`}
                    value={`${s.studentName} ${s.sectionName} ${s.indexNumber} ${s.studentNumber}`}
                    onSelect={() => setStudent(s)}
                    className="gap-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {s.studentName}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {s.sectionName}
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
