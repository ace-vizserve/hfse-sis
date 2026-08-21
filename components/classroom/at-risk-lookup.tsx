'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronRight,
  Phone,
  Search,
  TrendingDown,
  UserSearch,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SubjectTermPanel } from '@/components/shared/subject-term-panel';
import { cn } from '@/lib/utils';
import { numericToLetter } from '@/lib/compute/letter-grade';
import { ALERT_METRICS } from '@/lib/markbook/alert-threshold';
import { signedGrade } from '@/lib/markbook/format-grade';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AtRiskDrop,
  AtRiskStudent,
  SubjectTermHistory,
} from '@/lib/classroom/at-risk';
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

// ONE LINE PER STUDENT, the same shape the grading sheet's list uses.
//
// This row used to stack every fall — three or four lines each naming its own
// subject, its own metric, its own pair of figures, and a "since Term 1 —
// AY2026" footer under them. Mr Ace, 2026-08-21: "what the hell is this
// design." It was a detail view wearing a list's clothes, and the same subject
// appeared twice whenever two of its components fell.
//
// A list exists to be scanned. So: the worst fall per SUBJECT, at most three
// subjects, and the rest counted. Everything else is one tap away.
function summarise(student: AtRiskStudent): string {
  if (student.drops.length === 0) return 'Steady';

  const worstBySubject = new Map<string, AtRiskDrop>();
  for (const d of student.drops) {
    const held = worstBySubject.get(d.subject);
    if (!held || d.diff < held.diff) worstBySubject.set(d.subject, d);
  }

  const ranked = [...worstBySubject.values()].sort((a, b) => a.diff - b.diff);
  const shown = ranked.slice(0, 3).map((d) =>
    // A band never carries a points figure — a five-point move there usually
    // just means the letter moved.
    d.display.kind === 'band'
      ? `${d.subject} ${d.display.prior}→${d.display.current}`
      : `${d.subject} ${signedGrade(d.diff)}`
  );

  const rest = ranked.length - shown.length;
  return rest > 0 ? `${shown.join(' · ')} · +${rest} more` : shown.join(' · ');
}

function Row({
  student,
  onOpen,
}: {
  student: AtRiskStudent;
  onOpen: () => void;
}) {
  const fell = student.drops.length > 0;
  const points = student.drops.some((d) => d.display.kind === 'points');

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {student.indexNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {student.studentName}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {summarise(student)}
          </span>
        </span>
        {/* The summary figure is points, so it only appears when at least one
            fall IS points. A student whose only movement is a letter band
            would otherwise be headlined "−8", the exact misreading the band
            display exists to prevent. */}
        {fell ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-destructive">
            {points ? signedGrade(student.worstDiff ?? 0) : 'Band down'}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/50">
            —
          </span>
        )}
      </button>
    </li>
  );
}

// One subject's whole year, folded away until it is wanted.
//
// A class takes eight to ten subjects. Rendering every table open turns the
// panel into a wall of numbers that hides the two that matter, so the subjects
// that fell start open and the steady ones start shut — the information is all
// there, ordered by whether anyone needs to act on it.
// The subject strip. Tabs rather than stacked panels: a class takes eight to
// ten subjects, and eight open tables is a wall of numbers that hides the two
// that matter. A dot marks a subject that fell; a greyed tab is one nobody has
// marked yet, listed so an adviser can see it exists.
function SubjectTabs({
  subjects,
  selected,
  onSelect,
}: {
  subjects: SubjectTermHistory[];
  selected: string;
  onSelect: (subject: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Subjects"
      className="flex flex-wrap gap-0.5 border-b border-border"
    >
      {subjects.map((s) => {
        const marked = s.terms.some(
          (t) =>
            t.quarterly != null || t.ww != null || t.pt != null || t.qa != null
        );
        const on = s.subject === selected;
        return (
          <button
            key={s.subject}
            role="tab"
            type="button"
            aria-selected={on}
            disabled={!marked}
            onClick={() => onSelect(s.subject)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2 pt-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              on
                ? 'border-primary font-semibold text-foreground'
                : marked
                  ? 'border-transparent text-muted-foreground hover:text-foreground'
                  : 'border-transparent text-muted-foreground/50'
            )}
          >
            {s.fell && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-destructive"
                aria-label="fell this term"
              />
            )}
            {s.subject}
          </button>
        );
      })}
    </div>
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
  // Opens on the steepest fall, because that is why the adviser is here. Falls
  // back to the first subject that has any mark at all.
  const firstMarked =
    student.subjects.find((s) => s.fell) ??
    student.subjects.find((s) =>
      s.terms.some(
        (t) =>
          t.quarterly != null || t.ww != null || t.pt != null || t.qa != null
      )
    ) ??
    student.subjects[0];
  const [subject, setSubject] = useState<string | null>(null);
  const shown =
    student.subjects.find((s) => s.subject === subject) ?? firstMarked;

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

      {/* THE SAME PANEL THE GRADING SHEET RENDERS. Mr Ace, 2026-08-21: "use
          identical designs for grading sheet look up and classroom grades
          lookup its basically the same data bro." The only difference the data
          forces is this tab strip — an adviser has every subject, a subject
          teacher has one. */}
      {student.subjects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No marks have been entered for this student yet.
        </p>
      ) : !shown ? null : (
        <div className="space-y-4">
          <SubjectTabs
            subjects={student.subjects}
            selected={shown.subject}
            onSelect={setSubject}
          />
          <SubjectTermPanel
            subject={shown.subject}
            isExaminable={shown.isExaminable}
            terms={shown.terms}
          />
        </div>
      )}

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

function Body({ sectionId, termId, termLabel }: Props) {
  const [selected, setSelected] = useState<AtRiskStudent | null>(null);
  const [query, setQuery] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
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

  // An empty payload now means an empty CLASS, not a healthy one — the route
  // returns the whole roster. A class with no students is the only case left
  // where there is genuinely nothing to show.
  if (students.length === 0) {
    return (
      <div className="px-5 pb-5">
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <UserSearch className="size-4" />
          </div>
          <p className="font-serif text-base font-semibold text-foreground">
            No students yet
          </p>
          <p className="max-w-[38ch] text-sm text-muted-foreground">
            Nobody is on this class list for {termLabel}.
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

  // Index order, because that is how a teacher already holds the class in their
  // head — they call students by number. The panel used to arrive ranked by the
  // steepest fall, which is only the right order if triage is the only question
  // being asked; the filter answers that one on demand instead.
  const q = query.trim().toLowerCase();
  const shown = students
    .filter((s) => (onlyFlagged ? s.drops.length > 0 : true))
    .filter((s) => (q ? s.studentName.toLowerCase().includes(q) : true))
    .sort((a, b) => a.indexNumber - b.indexNumber);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Type a student name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {/* The term is named in the option. Without it a narrowed list reading
            "nobody" invites "this class has no problems", when what it means
            is "nobody in THIS term". */}
        <Select
          value={onlyFlagged ? 'flagged' : 'all'}
          onValueChange={(v) => setOnlyFlagged(v === 'flagged')}
        >
          <SelectTrigger className="w-auto shrink-0 gap-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All students</SelectItem>
            <SelectItem value="flagged">Only flagged · {termLabel}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <UserSearch className="size-4" />
            </div>
            <p className="font-serif text-base font-semibold text-foreground">
              {q ? 'No match' : 'Nobody needs a look'}
            </p>
            <p className="max-w-[38ch] text-sm text-muted-foreground">
              {q
                ? `No student in this class matches “${query}”.`
                : `No student has fallen ${GRADE_ALERT_THRESHOLD} points or more in any subject in ${termLabel}.`}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <ul className="divide-y divide-border">
              {shown.map((s) => (
                <Row
                  key={s.sectionStudentId}
                  student={s}
                  onOpen={() => setSelected(s)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="shrink-0 text-[13px] text-muted-foreground">
        Open a name for their whole year and the parents&rsquo; numbers.
      </p>
    </div>
  );
}

export function AtRiskLookup({ sectionId, termId, termLabel }: Props) {
  const [open, setOpen] = useState(false);

  // A DIALOG, NOT A SIDE SHEET — and the same one the grading sheet opens.
  //
  // This was a 512px drawer, which is fine for a list of names and hopeless for
  // what it now holds: four terms across, for every subject the class takes.
  // Mr Ace, 2026-08-21, looking at it: "its a sheet and what the hell is that
  // UI." Three surfaces, one habit only works if the habit is the same shape,
  // so this matches `grade-lookup-dialog` down to the width and the title pair.
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserSearch className="size-4" />
          Look up student
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[calc(100vh-4rem)] max-h-[860px] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border px-6 py-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {termLabel}
          </p>
          <DialogTitle className="font-serif text-xl font-semibold tracking-tight">
            Grade lookup
          </DialogTitle>
          <DialogDescription>
            Everyone in this class, with their whole year in every subject.
            Filter to the students whose marks have fallen{' '}
            {GRADE_ALERT_THRESHOLD} points or more.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          {open && (
            <Body sectionId={sectionId} termId={termId} termLabel={termLabel} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
