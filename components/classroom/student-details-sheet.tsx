'use client';

import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Mail, Phone, Sparkles } from 'lucide-react';
import { useState } from 'react';

import {
  DISCIPLINE_LIST_VIEW,
  DisciplineList,
  StudentDisciplineTakeover,
  type DisciplineView,
} from '@/components/classroom/student-discipline-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HouseChip } from '@/components/ui/house-chip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StudentDetails } from '@/lib/classroom/student-details';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';
import { ApiError, apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

// The teacher's view of one student on their own class roster — medical,
// learning needs and home contacts. Asked for at the 2026-07-31 training by
// Christina (16:08), Melissa (21:53) and Chandana (22:36).
//
// WHY A SHEET AND NOT A DIALOG. One student, many read-only fields, and a
// teacher works down the class rather than opening one child — the roster stays
// visible behind it. Same reasoning as every other multi-field single-object
// panel in the SIS.
//
// WHY THE SAFETY STRIP SITS OUTSIDE THE TABS. Tabs are right for four topics,
// but a peanut allergy behind a click is worse than no tabs at all. The strip
// renders above the tab list and stays on screen whichever tab is open, so the
// one fact a teacher must not miss cannot be navigated away from.
//
// WHY TABS CARRY A DOT. Most students have nothing in either Medical or
// Learning — 4 allergies and 32 real learning-needs declarations across 498
// AY2026 applications. Without a marker, a teacher has to open every tab to
// discover they are all empty. The dot is only ever shown for content that
// survived the junk filter (lib/classroom/student-details.ts), so a tab
// promising something never opens onto "NA".
//
// THE FOURTH TAB WRITES. Discipline (#7) is the only tab that is not read-only:
// filing lives here because teachers cannot open Records at all, and because
// the school files by whoever was in charge at the venue. Its detail view and
// its form replace this panel's body rather than opening a second Sheet on top
// — see student-discipline-panel.tsx.

type Props = {
  sectionId: string;
  studentNumber: string;
  studentName: string;
  indexNumber: number;
  sectionName: string | null;
  houseName: string | null;
  houseColourToken: string | null;
  /**
   * The signed-in user's own id. A disciplinary record may be corrected by the
   * person who filed it, so the panel has to know who is reading — and the
   * verified id can only come from the server.
   */
  viewerUserId: string;
  /**
   * Leadership may correct anyone's filing — the caller decides via
   * `canManageAnyDisciplineRecord(capability)`. Required on purpose: a
   * forgotten decision must fail the build rather than quietly offer an Edit
   * button that answers 403.
   */
  canManageAnyDiscipline: boolean;
  /** Renders the trigger as the student's name rather than a button. */
  asName?: boolean;
};

type TabKey = 'medical' | 'learning' | 'contacts' | 'discipline';

function ContentDot({ tone }: { tone: 'alert' | 'info' }) {
  return (
    <span
      aria-hidden
      data-testid="content-dot"
      className={cn(
        'size-1.5 rounded-full',
        tone === 'alert' ? 'bg-destructive' : 'bg-primary',
        // The active tab is a navy gradient with white text, and both tones
        // disappear against it — the marker would vanish at exactly the moment
        // you are looking at that tab.
        'in-data-[state=active]:bg-white'
      )}
    />
  );
}

// Seen far more often than any populated tab: 4 students have an allergy
// recorded and 32 a learning need, out of 498. So this is a normal resting
// state, not a failure, and it is built like one — an icon, a line, and a
// sentence saying who would change it if it is wrong.
function Nothing({
  icon: Icon,
  what,
}: {
  icon: React.ComponentType<{ className?: string }>;
  what: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <p className="font-serif text-base font-semibold text-foreground">
        Nothing recorded
      </p>
      <p className="max-w-[34ch] text-sm text-muted-foreground">
        No {what} is on this student&rsquo;s enrolment record. The office can
        add it if that is wrong.
      </p>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

// The fetch lives in here, NOT in the component below, and that is structural
// rather than tidy-mindedness. `SheetContent` mounts only while the drawer is
// open, so a closed roster of forty students runs zero queries and — more to
// the point — needs no QueryClient in scope at all. With `useQuery` in the
// outer component every render of the roster demanded a provider, which broke
// `classroom-roster-table.test.tsx` and would have made the table impossible
// to render anywhere a provider is absent.
function StudentDetailsBody({
  sectionId,
  studentNumber,
  viewerUserId,
  canManageAnyDiscipline,
}: {
  sectionId: string;
  studentNumber: string;
  viewerUserId: string;
  canManageAnyDiscipline: boolean;
}) {
  const { data, isLoading, isError, error } = useQuery<StudentDetails>({
    queryKey: queryKeys.classroomStudentDetails(sectionId, studentNumber),
    queryFn: ({ signal }) =>
      apiFetch<StudentDetails>(
        `/api/classroom/${sectionId}/students/${encodeURIComponent(studentNumber)}`,
        { signal }
      ),
  });

  // A SECOND query, in parallel, not a fourth slice off the first. The details
  // endpoint reads the enrolment record; this reads a separate table that any
  // teacher can also write to, and folding them together would make one cache
  // entry that a filing has to invalidate in order to refresh a phone number.
  // It runs on open rather than on tab-select because the tab's dot has to be
  // right before anyone clicks it.
  const discipline = useQuery<{ records: DisciplineRecordRow[] }>({
    queryKey: queryKeys.classroomStudentDiscipline(sectionId, studentNumber),
    queryFn: ({ signal }) =>
      apiFetch<{ records: DisciplineRecordRow[] }>(
        `/api/classroom/${sectionId}/students/${encodeURIComponent(studentNumber)}/discipline`,
        { signal }
      ),
  });
  const records = discipline.data?.records ?? [];

  // The detail and the form REPLACE everything below the header, tabs included.
  // The state lives out here rather than inside the panel because the panel's
  // list is a child of `TabsContent` — it cannot reach outside the tabs to
  // remove them.
  const [disciplineView, setDisciplineView] =
    useState<DisciplineView>(DISCIPLINE_LIST_VIEW);

  // The status is shown, not swallowed. "Could not be loaded" on its own sent
  // the first real failure back as a screenshot with nothing to act on: a 404
  // (this student is not on this roster) and a 500 (the lookup broke) need
  // different people to do different things, and only the panel knows which
  // happened. Kept short and in the reader's own words — the number is the
  // only thing here an admin would repeat down a phone.
  const status = error instanceof ApiError ? error.status : null;
  // The route names the step it died on and puts it in the body. Surfacing it
  // turns a screenshot of this panel into a usable bug report, which is what
  // actually gets sent — the server log is on someone else's screen.
  const errorField = (name: 'step' | 'detail'): string | null => {
    if (!(error instanceof ApiError)) return null;
    if (!error.body || typeof error.body !== 'object') return null;
    const value = (error.body as Record<string, unknown>)[name];
    return typeof value === 'string' && value ? value : null;
  };
  const step = errorField('step');
  // Only ever present outside production — the route omits it there.
  const detail = errorField('detail');

  // Open on the reason you most likely opened it: the safety information if
  // there is any, then the learning note, otherwise the contacts a teacher
  // came for. Landing on an empty Medical tab for the ~95% of students who
  // have nothing would make the drawer feel broken.
  const initialTab: TabKey = data?.hasMedical
    ? 'medical'
    : data?.hasLearning
      ? 'learning'
      : 'contacts';

  if (disciplineView.mode !== 'list') {
    return (
      <StudentDisciplineTakeover
        sectionId={sectionId}
        studentNumber={studentNumber}
        records={records}
        view={disciplineView}
        onView={setDisciplineView}
        viewerUserId={viewerUserId}
        canManageAnyDiscipline={canManageAnyDiscipline}
      />
    );
  }

  return (
    <>
      {isLoading && (
        <div className="space-y-3 px-5 pb-5">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {isError && (
        <div className="px-5 pb-5">
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
              <HeartPulse className="size-4" />
            </div>
            <div className="space-y-1">
              <p className="font-serif text-sm font-semibold text-foreground">
                {status === 404
                  ? 'This student is not on this class list'
                  : 'This student’s details could not be loaded'}
              </p>
              <p className="text-sm text-muted-foreground">
                {status === 404
                  ? 'Refresh the class list. If they should be in this class, ask the office to check their placement.'
                  : 'Close the panel and open it again. If it keeps happening, tell the office.'}
              </p>
              {status !== null && status !== 404 && (
                <p className="font-mono text-[11px] wrap-break-word text-muted-foreground">
                  Error {status}
                  {step ? ` · ${step}` : ''}
                  {detail ? ` — ${detail}` : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Pinned above the tabs on purpose — see the header note. */}
          {data.hasMedical && (
            <div
              data-testid="safety-strip"
              className="mx-5 mb-1 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground">
                <HeartPulse className="size-3.5" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {data.medical.notes[0]?.value ??
                  data.medical.conditions.join(' · ')}
              </p>
            </div>
          )}

          {/* SEGMENTED, not the default rail. `TabsList`'s default variant is
              the page-level treatment — mono uppercase, full width, gradient
              navy fill — and inside a 448px drawer it becomes the loudest
              element on screen, shouting three words at a teacher who came to
              read a phone number. `segmented` is what the primitive documents
              for compact switchers: sentence case, in a well, quiet enough to
              sit under a serif name without competing with it. */}
          <Tabs
            defaultValue={initialTab}
            className="min-h-0 flex-1 gap-0 overflow-hidden px-5 pb-5"
          >
            <TabsList variant="segmented" className="w-full">
              <TabsTrigger value="medical" className="gap-1.5">
                Medical
                {data.hasMedical && <ContentDot tone="alert" />}
              </TabsTrigger>
              <TabsTrigger value="learning" className="gap-1.5">
                Learning
                {data.hasLearning && <ContentDot tone="info" />}
              </TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              {/* `info`, not `alert`. The alert dot is the medical strip's
                  signal and has to stay sharp for a peanut allergy; a filed
                  record is worth knowing about, not an emergency. */}
              <TabsTrigger value="discipline" className="gap-1.5">
                Discipline
                {records.length > 0 && <ContentDot tone="info" />}
              </TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto pt-5">
              <TabsContent value="medical" className="space-y-4">
                {!data.hasMedical && data.medical.paracetamol === null ? (
                  <Nothing
                    icon={HeartPulse}
                    what="medical or dietary information"
                  />
                ) : (
                  <>
                    {data.medical.conditions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {data.medical.conditions.map((c) => (
                          <Badge
                            key={c}
                            variant="outline"
                            className="border-destructive/40 bg-destructive/10 text-destructive"
                          >
                            {c}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {data.medical.notes.length > 0 && (
                      <dl className="space-y-3">
                        {data.medical.notes.map((n) => (
                          <FieldRow key={n.label} label={n.label}>
                            {n.value}
                          </FieldRow>
                        ))}
                      </dl>
                    )}
                    {data.medical.paracetamol !== null && (
                      <dl>
                        <FieldRow label="Paracetamol">
                          {data.medical.paracetamol
                            ? 'Consent given'
                            : 'No consent'}
                        </FieldRow>
                      </dl>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="learning">
                {data.learning.length === 0 ? (
                  <Nothing icon={Sparkles} what="learning need" />
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-accent p-4">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="space-y-2">
                      {data.learning.map((n) => (
                        <p key={n.label} className="text-sm text-foreground">
                          {n.value}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ONE card, divided — not a stack of boxes. Three bordered
                  cards with two unbordered rows floating underneath read as
                  five unrelated things; the household is one thing, so it gets
                  one container with hairline rules between the people and a
                  muted footer for the facts that describe the household rather
                  than a person. */}
              <TabsContent value="contacts">
                {data.contacts.people.length === 0 &&
                !data.contacts.emergency &&
                !data.contacts.livingWith ? (
                  <Nothing icon={Phone} what="contact for this family" />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <ul className="divide-y divide-border">
                      {data.contacts.people.map((p) => (
                        <li key={p.label} className="space-y-1.5 px-4 py-3.5">
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {p.label}
                          </p>
                          <p className="text-sm font-medium leading-snug text-foreground">
                            {p.name ?? '—'}
                          </p>
                          <div className="flex flex-col gap-1 pt-0.5">
                            {p.mobile && (
                              <a
                                href={`tel:${p.mobile.replace(/\s+/g, '')}`}
                                className="flex w-fit items-center gap-1.5 font-mono text-sm text-primary tabular-nums hover:underline"
                              >
                                <Phone className="size-3.5 shrink-0" />
                                {p.mobile}
                              </a>
                            )}
                            {p.email && (
                              <a
                                href={`mailto:${p.email}`}
                                className="flex w-fit max-w-full items-center gap-1.5 text-sm text-primary hover:underline"
                              >
                                <Mail className="size-3.5 shrink-0" />
                                <span className="truncate">{p.email}</span>
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    {(data.contacts.emergency || data.contacts.livingWith) && (
                      <dl className="space-y-2.5 border-t border-border bg-muted/40 px-4 py-3.5">
                        {data.contacts.emergency && (
                          <FieldRow label="In an emergency">
                            {data.contacts.emergency.name}
                            {data.contacts.emergency.mobile
                              ? ` · ${data.contacts.emergency.mobile}`
                              : ''}
                          </FieldRow>
                        )}
                        {data.contacts.livingWith && (
                          <FieldRow label="Lives with">
                            {data.contacts.livingWith}
                          </FieldRow>
                        )}
                      </dl>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="discipline">
                <DisciplineList
                  records={records}
                  isLoading={discipline.isLoading}
                  isError={discipline.isError}
                  onOpen={(recordId) =>
                    setDisciplineView({ mode: 'detail', recordId })
                  }
                  onFile={() =>
                    setDisciplineView({ mode: 'form', recordId: null })
                  }
                />
              </TabsContent>
            </div>
          </Tabs>
        </>
      )}
    </>
  );
}

export function StudentDetailsSheet({
  sectionId,
  studentNumber,
  studentName,
  indexNumber,
  sectionName,
  houseName,
  houseColourToken,
  viewerUserId,
  canManageAnyDiscipline,
  asName = false,
}: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        {asName ? (
          <button
            type="button"
            className="rounded-sm text-left underline decoration-border underline-offset-4 transition-colors hover:text-primary hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {studentName}
          </button>
        ) : (
          <Button variant="ghost" size="sm">
            View details
          </Button>
        )}
      </SheetTrigger>

      {/* max-w-lg, not md. An email address and a full Filipino name in the
          `SURNAME, First, Middle` form the school uses both run long, and at
          md they truncated or wrapped mid-name. */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
      >
        <SheetHeader className="gap-1.5 border-b border-border pb-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Student details
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            {studentName}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5 text-xs">
              <span className="font-mono tabular-nums">{studentNumber}</span>
              <span aria-hidden className="text-hairline-strong">
                ·
              </span>
              <span>
                No. {indexNumber}
                {sectionName ? ` in ${sectionName}` : ''}
              </span>
              <HouseChip name={houseName} colourToken={houseColourToken} />
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col pt-5">
          <StudentDetailsBody
            sectionId={sectionId}
            studentNumber={studentNumber}
            viewerUserId={viewerUserId}
            canManageAnyDiscipline={canManageAnyDiscipline}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
