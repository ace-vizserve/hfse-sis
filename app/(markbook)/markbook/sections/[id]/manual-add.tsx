'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  ManualAddStudentSchema,
  type ManualAddStudentInput,
} from '@/lib/schemas/manual-add-student';

const DEFAULTS: ManualAddStudentInput = {
  student_number: '',
  late_enrollee: false,
  bus_no: '',
  classroom_officer_role: '',
};

type AdmissionsMatch = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  level: string | null;
  section: string | null;
  status: string | null;
};

// Server-side error codes — mirrored from POST /api/sections/[id]/students.
// Each code maps to a toast.action with a deep-link that helps the registrar
// resolve the underlying issue without leaving the markbook surface entirely.
type FailureCode =
  | 'not_synced'
  | 'not_in_admissions'
  | 'not_enrolled'
  | 'wrong_level'
  | 'already_in_section'
  | 'already_in_this_section'
  | 'at_capacity'
  | 'invalid_body'
  | 'missing_student_number'
  | 'section_not_found'
  | 'section_level_missing'
  | 'ay_not_found'
  | 'student_lookup_failed'
  | 'admissions_lookup_failed'
  | 'status_lookup_failed'
  | 'insert_failed';

type FailureBody = {
  error: string;
  code: FailureCode;
  enroleeNumber?: string;
  ayCode?: string;
  applicationStatus?: string | null;
  applicantLevel?: string | null;
  sectionLevelLabel?: string | null;
  otherSectionId?: string;
  studentNumber?: string;
};

export function ManualAddStudent({
  sectionId,
  nextIndex,
}: {
  sectionId: string;
  nextIndex: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<ManualAddStudentInput>({
    resolver: zodResolver(ManualAddStudentSchema),
    defaultValues: DEFAULTS,
  });

  // Admissions search state. Debounced input → /api/sis/search → click a
  // match to lock it in. The `pickedMatch` is the only path to a valid
  // submit — there is no fully-manual typing fallback (KD #51 + the
  // "no free-text fallback" rule that already governs staff/teacher pickers).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdmissionsMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedMatch, setPickedMatch] = useState<AdmissionsMatch | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce — only search after a short pause. Min 2 chars (matches API).
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sis/search?q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body.matches)) {
          setSearchResults(body.matches as AdmissionsMatch[]);
        }
      } catch {
        // Ignore — the picker just shows no results.
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  function pickMatch(m: AdmissionsMatch) {
    if (!m.studentNumber) {
      // Pre-empt the server's `not_synced` 404 — same toast.action shape so
      // the affordance is consistent regardless of where the gate triggers.
      toast.action('Applicant not synced to grading', {
        description: `${m.fullName} has no student number assigned. Run the admissions sync first.`,
        action: {
          label: 'Open admissions sync',
          onClick: () => router.push('/sis/sync-students'),
        },
      });
      return;
    }
    form.setValue('student_number', m.studentNumber, { shouldDirty: true, shouldValidate: true });
    setPickedMatch(m);
    setSearchQuery('');
    setSearchResults([]);
  }

  function clearPick() {
    setPickedMatch(null);
    form.setValue('student_number', '', { shouldDirty: false, shouldValidate: false });
  }

  function showFailureToast(failure: FailureBody) {
    switch (failure.code) {
      case 'already_in_section':
        toast.action('Already in another section', {
          description: failure.error,
          action: {
            label: 'Open that section',
            onClick: () => {
              if (failure.otherSectionId) {
                router.push(`/sis/sections/${failure.otherSectionId}`);
              }
            },
          },
        });
        return;
      case 'wrong_level':
        toast.action('Wrong level for this section', {
          description: failure.error,
          action: {
            label: 'View applicant',
            onClick: () => {
              if (failure.enroleeNumber && failure.ayCode) {
                router.push(
                  `/admissions/applications/${encodeURIComponent(failure.enroleeNumber)}?ay=${encodeURIComponent(failure.ayCode)}`,
                );
              }
            },
          },
        });
        return;
      case 'not_enrolled':
      case 'not_in_admissions':
        toast.action('Applicant is not Enrolled yet', {
          description: failure.error,
          action: {
            label: 'Open in admissions',
            onClick: () => {
              if (failure.enroleeNumber && failure.ayCode) {
                router.push(
                  `/admissions/applications/${encodeURIComponent(failure.enroleeNumber)}?ay=${encodeURIComponent(failure.ayCode)}&tab=enrollment`,
                );
              }
            },
          },
        });
        return;
      case 'not_synced':
        toast.action('Student not synced to grading', {
          description: failure.error,
          action: {
            label: 'Open admissions sync',
            onClick: () => router.push('/sis/sync-students'),
          },
        });
        return;
      case 'at_capacity':
        toast.action('Section at capacity', {
          description: failure.error,
          action: {
            label: 'Pick another section',
            onClick: () => router.push('/sis/sections'),
          },
        });
        return;
      case 'already_in_this_section':
        toast.warning(failure.error);
        return;
      default:
        toast.error(failure.error || 'Failed to add student');
        return;
    }
  }

  async function onSubmit(values: ManualAddStudentInput) {
    if (!pickedMatch) {
      toast.warning('Pick an applicant from the admissions search first.');
      return;
    }
    try {
      const res = await fetch(`/api/sections/${sectionId}/students`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          student_number: values.student_number,
          enrollment_status: values.late_enrollee ? 'late_enrollee' : 'active',
          bus_no: values.bus_no?.trim() || null,
          classroom_officer_role: values.classroom_officer_role?.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showFailureToast(body as FailureBody);
        return;
      }
      const insertedFullName =
        (body as { fullName?: string }).fullName?.trim() || pickedMatch.fullName;
      const idx = (body as { index_number?: number }).index_number ?? '';
      toast.success(`Added ${insertedFullName} as #${idx}`);
      setOpen(false);
      form.reset(DEFAULTS);
      setPickedMatch(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add student');
    }
  }

  const busy = form.formState.isSubmitting;
  const submitDisabled = busy || !pickedMatch;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset(DEFAULTS);
          setSearchQuery('');
          setSearchResults([]);
          setPickedMatch(null);
        }
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" />
          Add student from admissions
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-3 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Add a student from admissions
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Identity must come from an existing admissions record — there is no
              free-text fallback. The applicant must be{' '}
              <strong>Enrolled</strong> at this section&apos;s level. Picks the next
              available index{' '}
              <span className="font-mono tabular-nums text-foreground">#{nextIndex}</span>.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="flex flex-col gap-6 p-6">
                {/* Admissions search — required path. */}
                <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                  <label
                    htmlFor="admissions-search"
                    className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Search admissions
                  </label>
                  {!pickedMatch && (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="admissions-search"
                          placeholder="Name or student number…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-8 pr-8"
                          autoComplete="off"
                          autoFocus
                        />
                        {(searching || searchQuery) && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setSearchResults([]);
                            }}
                            className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label="Clear search"
                          >
                            {searching ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                          </button>
                        )}
                      </div>
                      {searchResults.length > 0 && (
                        <ScrollArea className="h-[200px] rounded-md border border-border bg-card">
                          <div className="divide-y divide-border">
                            {searchResults.map((m) => (
                              <button
                                key={`${m.ayCode}|${m.enroleeNumber}`}
                                type="button"
                                onClick={() => pickMatch(m)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {m.fullName}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-muted-foreground">
                                    <span>{m.ayCode}</span>
                                    {m.studentNumber ? (
                                      <span>· #{m.studentNumber}</span>
                                    ) : (
                                      <span className="text-brand-amber">· no student number</span>
                                    )}
                                    {m.level && <span>· {m.level}</span>}
                                    {m.status && <span>· {m.status}</span>}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                      {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-muted-foreground">
                          No matches. Make sure the applicant exists in admissions.
                        </div>
                      )}
                      {searchQuery.trim().length < 2 && (
                        <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                          Type at least 2 characters of a name or student number.
                        </p>
                      )}
                    </>
                  )}

                  {pickedMatch && (
                    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate font-serif text-sm font-semibold tracking-tight text-foreground">
                            {pickedMatch.fullName}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            <span>{pickedMatch.ayCode}</span>
                            {pickedMatch.studentNumber && <span>· #{pickedMatch.studentNumber}</span>}
                            {pickedMatch.level && <span>· {pickedMatch.level}</span>}
                          </div>
                          {pickedMatch.status && (
                            <Badge
                              variant={
                                pickedMatch.status === 'Enrolled' ||
                                pickedMatch.status === 'Enrolled (Conditional)'
                                  ? 'success'
                                  : 'warning'
                              }
                            >
                              {pickedMatch.status}
                            </Badge>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={clearPick}
                          className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="bus_no"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bus number</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="e.g. SVC7"
                          maxLength={40}
                        />
                      </FormControl>
                      <FormDescription>Optional. Shown on the attendance sheet.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="classroom_officer_role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Classroom officer role</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ''}
                          placeholder="e.g. HAPI HAUS"
                          maxLength={80}
                        />
                      </FormControl>
                      <FormDescription>Optional. Display-only.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="late_enrollee"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-normal text-foreground">
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                            className="mt-0.5"
                          />
                          <span>
                            Late enrollee
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              Assessments before the enrolment date will be marked N/A.
                            </span>
                          </span>
                        </label>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6 sm:justify-end">
                <SheetClose asChild>
                  <Button type="button" variant="outline" size="sm">
                    Cancel
                  </Button>
                </SheetClose>
                <Button type="submit" size="sm" disabled={submitDisabled}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  {busy ? 'Adding…' : 'Add student'}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
