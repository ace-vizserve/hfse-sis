'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Loader2,
  Search,
  Send,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  CHANGE_REQUEST_FIELDS,
  ChangeRequestFormSchema,
  REASON_CATEGORIES,
  REASON_CATEGORY_LABELS,
  type ChangeRequestField,
  type ChangeRequestFormInput,
} from '@/lib/schemas/change-request';

// One row per student in this section. Provided by the server component.
export type RequestableStudent = {
  entry_id: string;
  index_number: number;
  student_name: string;
  student_number: string;
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  letter_grade: string | null;
  is_na: boolean;
  withdrawn: boolean;
};

// Designated approvers for the markbook.change_request flow, minus the
// current teacher (they can't self-approve). Populated server-side from
// `approver_assignments`.
export type ApproverOption = {
  user_id: string;
  email: string;
  role: string | null;
};

type Props = {
  sheetId: string;
  isExaminable: boolean;
  wwSlotCount: number;
  ptSlotCount: number;
  students: RequestableStudent[];
  approvers: ApproverOption[];
};

const FIELD_LABELS: Record<ChangeRequestField, string> = {
  ww_scores: 'Written Works (WW)',
  pt_scores: 'Performance Tasks (PT)',
  qa_score: 'Quarterly Assessment (QA)',
  letter_grade: 'Letter grade',
  is_na: 'Late enrollee N/A flag',
};

export function RequestEditButton({
  sheetId,
  isExaminable,
  wwSlotCount,
  ptSlotCount,
  students,
  approvers,
}: Props) {
  const [open, setOpen] = useState(false);

  // Narrow the field options to what this sheet supports.
  const availableFields = useMemo(() => {
    if (isExaminable) {
      return CHANGE_REQUEST_FIELDS.filter((f) => f !== 'letter_grade');
    }
    return CHANGE_REQUEST_FIELDS.filter(
      (f) => f === 'letter_grade' || f === 'is_na'
    );
  }, [isExaminable]);

  const approverCount = approvers.length;
  const noApproversConfigured = approverCount === 0;
  const onlyOneApprover = approverCount === 1;

  const form = useForm<ChangeRequestFormInput>({
    resolver: zodResolver(ChangeRequestFormSchema),
    defaultValues: {
      grading_sheet_id: sheetId,
      grade_entry_id: '',
      field_changed: availableFields[0],
      slot_index: null,
      current_value: null,
      proposed_value: '',
      reason_category: 'regrading',
      justification: '',
      primary_approver_id: '',
      secondary_approver_id: '',
    },
  });

  const primaryApproverId = form.watch('primary_approver_id');

  const selectedEntryId = form.watch('grade_entry_id');
  const selectedField = form.watch('field_changed');
  const selectedSlot = form.watch('slot_index');

  const selectedStudent = useMemo(
    () => students.find((s) => s.entry_id === selectedEntryId) ?? null,
    [students, selectedEntryId]
  );

  // When student/field/slot changes, refresh the read-only current_value
  // snapshot inside the form so the displayed "from" value stays accurate.
  const currentValueDisplay = useMemo(() => {
    if (!selectedStudent) return '';
    switch (selectedField) {
      case 'ww_scores':
        return selectedSlot != null
          ? String(selectedStudent.ww_scores[selectedSlot] ?? '(blank)')
          : '';
      case 'pt_scores':
        return selectedSlot != null
          ? String(selectedStudent.pt_scores[selectedSlot] ?? '(blank)')
          : '';
      case 'qa_score':
        return String(selectedStudent.qa_score ?? '(blank)');
      case 'letter_grade':
        return selectedStudent.letter_grade ?? '(blank)';
      case 'is_na':
        return selectedStudent.is_na ? 'true' : 'false';
      default:
        return '';
    }
  }, [selectedStudent, selectedField, selectedSlot]);

  const needsSlot =
    selectedField === 'ww_scores' || selectedField === 'pt_scores';
  const maxSlot = selectedField === 'ww_scores' ? wwSlotCount : ptSlotCount;

  // Client-side soft guard: refuse to file when the proposed value matches the
  // current value verbatim (would be a no-op request that just spams the
  // approver inbox). Server enforces the canonical comparison; this just
  // shortens the feedback loop. Coerce both sides to string so "92" === 92
  // doesn't sneak through.
  const proposedValueRaw = form.watch('proposed_value') ?? '';
  const proposedValueTrimmed = proposedValueRaw.trim();
  const proposedTouched = !!form.formState.dirtyFields.proposed_value;
  const isSameValue =
    proposedValueTrimmed !== '' &&
    String(proposedValueTrimmed) === String(currentValueDisplay).trim();

  const busy = form.formState.isSubmitting;

  // The success response can carry a `warning` field (e.g. approvers couldn't
  // be emailed) — that is a warning, not a success, and must not be recoloured
  // into one. On failure ApiError.message already resolves to the route's
  // `error` field.
  const requestMutation = useMutation({
    mutationFn: (values: ChangeRequestFormInput) =>
      apiFetch<{ warning?: string }>(
        '/api/change-requests',
        jsonInit('POST', {
          ...values,
          current_value: currentValueDisplay || null,
        })
      ),
  });

  const run = useWriteAction();

  // RHF stays the submit-state owner (busy = form.formState.isSubmitting): the
  // await below holds isSubmitting true across the whole lifecycle, including
  // the refresh, so the button stops spinning when the queue behind the dialog
  // is really up to date. `run` never rejects, so the old try/catch is gone.
  async function onSubmit(values: ChangeRequestFormInput) {
    await run(() => requestMutation.mutateAsync(values), {
      pending: 'Submitting change request…',
      success: (body) => {
        if (body.warning) {
          toast.warning("Heads up — approvers couldn't be reached by email", {
            description: body.warning,
          });
          return null;
        }
        return 'Change request submitted for approval';
      },
      error: (e) =>
        e instanceof Error ? e.message : 'Failed to submit request',
      onResolved: () => {
        setOpen(false);
        form.reset();
      },
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <Send className="h-4 w-4" />
          Request edit
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-2 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Request a locked-sheet edit
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              This request will be sent to your school admin for approval. The
              registrar applies the change after it is approved.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-5 p-6">
                <FormField
                  control={form.control}
                  name="grade_entry_id"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Student</FormLabel>
                      <FormControl>
                        <StudentCombobox
                          students={students}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="field_changed"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Field to change</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          // Reset slot when switching fields so the refine() passes.
                          const next = v as ChangeRequestField;
                          form.setValue(
                            'slot_index',
                            next === 'ww_scores' || next === 'pt_scores'
                              ? 0
                              : null,
                            {
                              shouldValidate: true,
                            }
                          );
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {availableFields.map((f) => (
                            <SelectItem key={f} value={f}>
                              {FIELD_LABELS[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {needsSlot && maxSlot > 0 && (
                  <FormField
                    control={form.control}
                    name="slot_index"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Slot</FormLabel>
                        <Select
                          value={field.value == null ? '' : String(field.value)}
                          onValueChange={(v) => field.onChange(Number(v))}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pick a slot…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Array.from({ length: maxSlot }).map((_, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {selectedField === 'ww_scores' ? 'W' : 'PT'}
                                {i + 1}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {selectedStudent && (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Current value
                    </div>
                    <div className="tabular-nums text-foreground">
                      {currentValueDisplay || '—'}
                    </div>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="proposed_value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proposed value</FormLabel>
                      <FormControl>
                        {selectedField === 'letter_grade' ? (
                          <Select
                            value={field.value || undefined}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose UG or E" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="UG">UG — Ungraded</SelectItem>
                              <SelectItem value="E">E — Exempted</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            {...field}
                            placeholder={
                              selectedField === 'is_na'
                                ? 'true or false'
                                : 'e.g. 92'
                            }
                          />
                        )}
                      </FormControl>
                      <FormDescription>
                        The registrar will type this exact value into the locked
                        sheet when applying the approved request.
                      </FormDescription>
                      {proposedTouched && isSameValue && (
                        <p className="flex items-start gap-1.5 text-[11px] text-brand-amber">
                          <AlertTriangle
                            className="mt-0.5 h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            This is the same as the current value — change it
                            before filing.
                          </span>
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reason_category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason category</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REASON_CATEGORIES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {REASON_CATEGORY_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="justification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Justification</FormLabel>
                      <FormControl>
                        <RichTextEditor
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          placeholder="Explain in at least 20 characters why this change is needed."
                          rows={5}
                          maxLength={2000}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        Tell the approver why this change matters.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
                  <div className="space-y-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
                      Approvers
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Pick who reviews this request. Both can act independently;
                      the first to approve or reject wins.
                    </p>
                  </div>

                  <FormField
                    control={form.control}
                    name="primary_approver_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary approver</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={approverCount < 2}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pick an approver…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {approvers.map((a) => (
                              <SelectItem key={a.user_id} value={a.user_id}>
                                {a.email}
                                {a.role && (
                                  <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                                    {a.role}
                                  </span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="secondary_approver_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secondary approver</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={approverCount < 2}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pick a different approver…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {approvers
                              .filter((a) => a.user_id !== primaryApproverId)
                              .map((a) => (
                                <SelectItem key={a.user_id} value={a.user_id}>
                                  {a.email}
                                  {a.role && (
                                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                                      {a.role}
                                    </span>
                                  )}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Must be different from the primary approver.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {primaryApproverId && form.watch('secondary_approver_id') && (
                    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <AlertCircle
                        className="mt-0.5 h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        Only these two administrators will be able to act on
                        this request. If both are unavailable, the request will
                        sit in their queue until one returns or another
                        administrator is added.
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6 sm:justify-end">
                <SheetClose asChild>
                  <Button type="button" variant="outline" size="sm">
                    Cancel
                  </Button>
                </SheetClose>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    busy ||
                    noApproversConfigured ||
                    onlyOneApprover ||
                    (proposedTouched && isSameValue)
                  }
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {busy ? 'Submitting…' : 'Submit request'}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function StudentCombobox({
  students,
  value,
  onChange,
}: {
  students: RequestableStudent[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const eligible = useMemo(
    () => students.filter((s) => !s.withdrawn),
    [students]
  );
  const selected = useMemo(
    () => eligible.find((s) => s.entry_id === value) ?? null,
    [eligible, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((s) => {
      const hay =
        `#${s.index_number} ${s.student_name} ${s.student_number}`.toLowerCase();
      return hay.includes(q);
    });
  }, [eligible, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between font-normal"
        >
          <span
            className={
              selected
                ? 'truncate text-foreground'
                : 'truncate text-muted-foreground'
            }
          >
            {selected
              ? `#${selected.index_number} · ${selected.student_name}`
              : 'Pick a student…'}
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => {
          // Let the Input inside grab focus instead of the first list button.
          e.preventDefault();
        }}
      >
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a name or index…"
            className="h-8 border-0 bg-transparent pl-7 shadow-none focus-visible:ring-0"
          />
        </div>
        <div
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No students match.
            </div>
          ) : (
            filtered.map((s) => {
              const isSelected = s.entry_id === value;
              return (
                <button
                  key={s.entry_id}
                  type="button"
                  onClick={() => {
                    onChange(s.entry_id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <Check
                    className={
                      isSelected
                        ? 'size-3.5 shrink-0 text-brand-indigo'
                        : 'size-3.5 shrink-0 opacity-0'
                    }
                  />
                  <span className="truncate">
                    <span className="tabular-nums text-muted-foreground">
                      #{s.index_number}
                    </span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    {s.student_name}
                  </span>
                  <span className="ml-auto pl-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {s.student_number}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
