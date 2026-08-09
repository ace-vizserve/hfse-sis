'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Phone, TrendingDown, UserSearch } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { AtRiskStudent } from '@/lib/classroom/at-risk';
import type { StudentDetails } from '@/lib/classroom/student-details';
import { GRADE_ALERT_THRESHOLD } from '@/lib/markbook/alert-threshold';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';

// "Look up student" for a form class adviser — Ms Koh's ask (55:10), the half
// no grading sheet can answer.
//
// SAME WORDS, SAME SHAPE as the button on the attendance sheet and the grading
// sheet. Three surfaces, one habit: a teacher who has learned it once has
// learned it everywhere. The difference is what it ranks — attendance ranks by
// absence, the grading sheet by one subject, this by every subject the class
// takes.
//
// TWO VIEWS, ONE PANEL — the list, then one student with what fell and the
// numbers to ring, and a link back. Koh's sentence ends at "the FCA got to
// contact the parents", so a list that cannot reach a phone number stops one
// step short of what she asked for.

type Props = {
  sectionId: string;
  termId: string;
  termLabel: string;
};

function Row({
  student,
  onOpen,
}: {
  student: AtRiskStudent;
  onOpen: () => void;
}) {
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-sm text-left font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {student.studentName}
          </button>
          <p className="pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {student.studentNumber} · No. {student.indexNumber}
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/40 bg-destructive/10 font-mono tabular-nums text-destructive"
        >
          {student.worstDiff}
        </Badge>
      </div>

      <ul className="space-y-1">
        {student.drops.map((d) => (
          <li
            key={`${d.subject}-${d.metric}`}
            className="flex items-baseline justify-between gap-3 text-[13px]"
          >
            <span className="min-w-0">
              <span className="font-medium text-foreground">{d.subject}</span>
              <span className="text-muted-foreground">
                {' '}
                · {d.metricLabel} · {d.prior} → {d.current}
              </span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-destructive">
              {d.diff}
            </span>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        since {student.drops[0].priorTermLabel}
      </p>
    </li>
  );
}

// The second view — one student, their falls in full, and the numbers to ring.
//
// IN THE SAME PANEL, NOT A SHEET ON TOP OF A SHEET. Nested dialogs are out
// (they trap focus twice and the back gesture stops meaning anything), and the
// attendance and grading lookups both already use this shape: a list, a
// student, and a link back. Three surfaces, one habit — and it is the shape
// that lets an adviser work down the class without closing anything.
function StudentView({
  sectionId,
  student,
  onBack,
}: {
  sectionId: string;
  student: AtRiskStudent;
  onBack: () => void;
}) {
  const { data, isLoading } = useQuery<StudentDetails>({
    queryKey: queryKeys.classroomStudentDetails(
      sectionId,
      student.studentNumber
    ),
    queryFn: ({ signal }) =>
      apiFetch<StudentDetails>(
        `/api/classroom/${sectionId}/students/${encodeURIComponent(student.studentNumber)}`,
        { signal }
      ),
  });

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="size-4" />
        All students
      </Button>

      <div>
        <p className="font-serif text-lg font-semibold text-foreground">
          {student.studentName}
        </p>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {student.studentNumber} · No. {student.indexNumber}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <p className="border-b border-border bg-muted/40 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          What fell, since {student.drops[0].priorTermLabel}
        </p>
        <ul className="divide-y divide-border">
          {student.drops.map((d) => (
            <li
              key={`${d.subject}-${d.metric}`}
              className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium text-foreground">{d.subject}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {d.metricLabel} · {d.prior} → {d.current}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-destructive">
                {d.diff}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Who to call
        </p>
        {isLoading && <Skeleton className="h-20 w-full rounded-xl" />}
        {data && data.contacts.people.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No contact for this family is on the enrolment record.
          </p>
        )}
        {data && data.contacts.people.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {data.contacts.people.map((p) => (
              <li key={p.label} className="px-4 py-3">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {p.label}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {p.name ?? '—'}
                </p>
                {p.mobile && (
                  <a
                    href={`tel:${p.mobile.replace(/\s+/g, '')}`}
                    className="flex w-fit items-center gap-1.5 pt-0.5 font-mono text-sm text-primary tabular-nums hover:underline"
                  >
                    <Phone className="size-3.5 shrink-0" />
                    {p.mobile}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Body({ sectionId, termId }: Omit<Props, 'termLabel'>) {
  const [selected, setSelected] = useState<AtRiskStudent | null>(null);
  const { data, isLoading, isError } = useQuery<{ students: AtRiskStudent[] }>({
    queryKey: ['classroom-at-risk', sectionId, termId],
    queryFn: ({ signal }) =>
      apiFetch(`/api/classroom/${sectionId}/at-risk?term_id=${termId}`, {
        signal,
      }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 px-5 pb-5">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-5 pb-5">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <TrendingDown className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="font-serif text-sm font-semibold text-foreground">
              This list could not be loaded
            </p>
            <p className="text-sm text-muted-foreground">
              Close the panel and open it again. If it keeps happening, tell the
              office.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const students = data?.students ?? [];

  // An empty list is good news and must read as good news. "No results" would
  // look like the search had failed.
  if (students.length === 0) {
    return (
      <div className="px-5 pb-5">
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <UserSearch className="size-4" />
          </div>
          <p className="font-serif text-base font-semibold text-foreground">
            Nobody needs a look
          </p>
          <p className="max-w-[38ch] text-sm text-muted-foreground">
            No student in this class has fallen {GRADE_ALERT_THRESHOLD} points
            or more in any subject since their last marked term.
          </p>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <StudentView
        sectionId={sectionId}
        student={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <div className="overflow-hidden rounded-xl border border-border">
        <ul className="divide-y divide-border">
          {students.map((s) => (
            <Row
              key={s.sectionStudentId}
              student={s}
              onOpen={() => setSelected(s)}
            />
          ))}
        </ul>
      </div>
      <p className="pt-3 text-[13px] text-muted-foreground">
        Ranked by the steepest single fall. Open a name for the parents&rsquo;
        numbers.
      </p>
    </div>
  );
}

export function AtRiskLookup({ sectionId, termId, termLabel }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <UserSearch className="size-4" />
          Look up student
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="gap-1.5 border-b border-border pb-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {termLabel}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Students who need a look
          </SheetTitle>
          <SheetDescription>
            Marks that have fallen {GRADE_ALERT_THRESHOLD} points or more since
            the last marked term, across every subject this class takes.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col pt-5">
          {open && <Body sectionId={sectionId} termId={termId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
