'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

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
  last_name: '',
  first_name: '',
  middle_name: '',
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
  // match to pre-fill the form. Keeps the fully-manual path intact for the
  // edge case where admissions doesn't have the student.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdmissionsMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchedFrom, setMatchedFrom] = useState<string | null>(null);
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
        // Ignore — leaves prior results in place. Registrar can still type manually.
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
      toast.info('That admissions record has no studentNumber yet — assign one in Records first.');
      return;
    }
    form.setValue('student_number', m.studentNumber, { shouldDirty: true, shouldValidate: true });
    if (m.lastName) form.setValue('last_name', m.lastName, { shouldDirty: true, shouldValidate: true });
    if (m.firstName) form.setValue('first_name', m.firstName, { shouldDirty: true, shouldValidate: true });
    if (m.middleName != null) {
      form.setValue('middle_name', m.middleName, { shouldDirty: true });
    }
    setMatchedFrom(`${m.ayCode} · ${m.fullName}`);
    setSearchQuery('');
    setSearchResults([]);
  }

  function clearMatch() {
    setMatchedFrom(null);
  }

  async function onSubmit(values: ManualAddStudentInput) {
    try {
      const res = await fetch(`/api/sections/${sectionId}/students`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          student_number: values.student_number,
          last_name: values.last_name,
          first_name: values.first_name,
          middle_name: values.middle_name?.trim() || null,
          enrollment_status: values.late_enrollee ? 'late_enrollee' : 'active',
          bus_no: values.bus_no?.trim() || null,
          classroom_officer_role: values.classroom_officer_role?.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      toast.success('Student added');
      setOpen(false);
      form.reset(DEFAULTS);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add student');
    }
  }

  const busy = form.formState.isSubmitting;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset(DEFAULTS);
          setSearchQuery('');
          setSearchResults([]);
          setMatchedFrom(null);
        }
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" />
          Manually add student
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-3 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Add student manually
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Adds a new row to{' '}
              <span className="font-mono text-foreground">public.students</span> (if the student
              number is new) and enrols them in this section. The student will be assigned index{' '}
              <span className="font-mono tabular-nums text-foreground">#{nextIndex}</span>.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="flex flex-col gap-6 p-6">
              {/* Admissions search — optional pre-fill before manual entry. */}
              <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
                <label
                  htmlFor="admissions-search"
                  className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Search admissions (optional)
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="admissions-search"
                    placeholder="Name, studentNumber, or enroleeNumber…"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (matchedFrom) setMatchedFrom(null);
                    }}
                    className="pl-8 pr-8"
                    autoComplete="off"
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
                {matchedFrom && (
                  <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-[11px]">
                    <span className="truncate text-primary">
                      Pre-filled from <span className="font-mono">{matchedFrom}</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearMatch}
                      className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                )}
                {searchResults.length > 0 && (
                  <ScrollArea className="h-[180px] rounded-md border border-border bg-card">
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
                            {m.studentNumber && <span>· #{m.studentNumber}</span>}
                            {!m.studentNumber && (
                              <span className="text-amber-700 dark:text-amber-200">
                                · no studentNumber yet
                              </span>
                            )}
                            {m.level && <span>· {m.level}</span>}
                            {m.section && <span>· {m.section}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                    </div>
                  </ScrollArea>
                )}
                {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">
                    No matches — type manually below.
                  </div>
                )}
              </div>

              <FormField
                control={form.control}
                name="student_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Student number</FormLabel>
                    <FormControl>
                      <Input autoFocus {...field} />
                    </FormControl>
                    <FormDescription>
                      Stable cross-year ID. Never reused even after the student leaves.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="middle_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Middle name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormDescription>Optional.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
              <Button type="submit" size="sm" disabled={busy}>
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
