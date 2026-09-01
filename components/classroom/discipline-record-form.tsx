'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm, type FieldErrors, type Path } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import {
  DISCIPLINE_DETAILS_MAX,
  DISCIPLINE_RECORD_TYPE_HINTS,
  DISCIPLINE_RECORD_TYPE_LABELS,
  DISCIPLINE_RECORD_TYPE_VALUES,
  DISCIPLINE_REMARKS_MAX,
  DisciplineRecordSchema,
  type DisciplineRecordFormValues,
} from '@/lib/schemas/discipline';

// Filing or correcting one disciplinary record — action item #7.
//
// One component for both, the shape `components/sis/edit-discount-code-dialog`
// uses: a single mutation that switches URL and verb on whether it was handed
// an existing record. Two components would be two places for the "letters only"
// rule to drift apart.
//
// Every message the server sends back is already a sentence written for a
// school admin (see lib/schemas/discipline.ts), and `apiFetch` lifts it onto
// the error. Do not flatten those into "Failed to save" — the 403 in particular
// names exactly who may fix the record.

/**
 * Every label a validation error can point at, in the reader's own words.
 *
 * A function rather than a constant because two of them follow the record
 * type, and a toast naming a field by a heading that is not on screen is worse
 * than no toast at all.
 */
function fieldLabels(isLetter: boolean): Record<string, string> {
  return {
    record_type: 'What is this?',
    occurred_on: isLetter ? 'Date sent' : 'Date',
    occurred_at_time: 'Time',
    acknowledged_on: 'Parent returned the signed slip',
    nature: 'What kind of thing was it?',
    details: 'What happened',
    remarks: 'Remarks',
    document_url: isLetter
      ? 'Link to the signed slip'
      : 'Link to the acknowledged incident report',
  };
}

/** `''` is what a cleared control submits; the column wants a real absence. */
function orNull(value: string): string | null {
  return value === '' ? null : value;
}

function blankValues(): DisciplineRecordFormValues {
  return {
    record_type: 'incident',
    // Deliberately empty rather than today. The date is the one fact on this
    // form that has to be right, and a pre-filled one is accepted without being
    // read — which is exactly how three backfilled incidents all end up dated
    // the day somebody sat down to type them.
    occurred_on: '',
    occurred_at_time: null,
    nature: '',
    details: '',
    remarks: null,
    document_url: null,
    acknowledged_on: null,
    // NOT on the form (dropped 2026-08-21 — Mr Ace asked what it was for,
    // which is the answer to whether a teacher would know). It stays in the
    // values because `toColumns` writes `filed_by_office ?? null`: omit the
    // key on an EDIT and correcting an old record would silently erase an
    // office somebody had already recorded. The column and the route are
    // untouched, so putting the field back is a JSX change and nothing else.
    filed_by_office: null,
  };
}

function valuesFrom(record: DisciplineRecordRow): DisciplineRecordFormValues {
  return {
    record_type: record.recordType,
    occurred_on: record.occurredOn,
    occurred_at_time: record.occurredAtTime,
    nature: record.nature,
    details: record.details,
    remarks: record.remarks,
    document_url: record.documentUrl,
    acknowledged_on: record.acknowledgedOn,
    filed_by_office: record.filedByOffice,
  };
}

export function DisciplineRecordForm({
  sectionId,
  studentNumber,
  record,
  onDone,
  onCancel,
}: {
  sectionId: string;
  studentNumber: string;
  /** The record being corrected, or null when filing a new one. */
  record: DisciplineRecordRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isEdit = record !== null;
  const form = useForm<DisciplineRecordFormValues>({
    resolver: zodResolver(DisciplineRecordSchema),
    defaultValues: record ? valuesFrom(record) : blankValues(),
  });

  const recordType = form.watch('record_type');
  const isLetter = recordType === 'letter';

  // "What happened" is the one long field on this form, so it is the one that
  // hurts to lose. The key has to name the exact record: keyed on the record
  // id when correcting, and on the class + student when filing a new one, so
  // two half-typed incidents on two different children never see each other's
  // draft.
  const detailsDraftKey = `discipline-details:${
    record ? record.id : `new:${sectionId}:${studentNumber}`
  }`;

  // Switching to Incident must clear the acknowledgement, not merely hide it.
  // The zod refine and a CHECK both refuse an acknowledged incident, so a value
  // left behind a hidden field would fail the save with nothing on screen
  // explaining why. `toColumns` nulls it server-side too — belt and braces,
  // because this is the failure a filer cannot diagnose.
  useEffect(() => {
    if (!isLetter && form.getValues('acknowledged_on')) {
      form.setValue('acknowledged_on', null, { shouldValidate: true });
    }
  }, [isLetter, form]);

  const queryClient = useQueryClient();
  const listKey = queryKeys.classroomStudentDiscipline(
    sectionId,
    studentNumber
  );

  const base = `/api/classroom/${sectionId}/students/${encodeURIComponent(studentNumber)}/discipline`;
  const saveMutation = useMutation({
    mutationFn: (values: DisciplineRecordFormValues) =>
      apiFetch<{ ok: true; id: string }>(
        isEdit ? `${base}/${record.id}` : base,
        jsonInit(isEdit ? 'PATCH' : 'POST', values)
      ),
  });

  const run = useWriteAction();

  async function onSubmit(values: DisciplineRecordFormValues) {
    await run(
      async () => {
        const body = await saveMutation.mutateAsync(values);
        // A filed record shows on two DIFFERENT KINDS of surface: the
        // drawer's list, which is a TanStack query, and the class page and
        // Records tab, which are server renders. `router.refresh()` cannot
        // touch the first and `invalidateQueries` cannot touch the second, so
        // a write does both. Refetching INSIDE the awaited work is what keeps
        // KD #186's rule intact — the success toast still lands after the
        // screen has actually changed, not before.
        await queryClient.invalidateQueries({ queryKey: listKey });
        return body;
      },
      {
        pending: isEdit ? 'Saving changes…' : 'Filing record…',
        success: isEdit ? 'Changes saved' : 'Record filed',
        error: (e) => {
          // The write route proves reach through the SECTION, and its roster
          // check requires a non-withdrawn `section_students` row. So a record
          // filed on a class the student has since left answers 404 "not
          // found" — true, and useless to read. Everything else the route says
          // is already a sentence written for a school admin, so it passes
          // through untouched.
          if (e instanceof ApiError && e.status === 404) {
            return 'This record can no longer be edited here — the student has left that class.';
          }
          return e instanceof Error
            ? e.message
            : 'That record could not be saved.';
        },
        onResolved: () => onDone(),
        // `refresh` is left at its default of true, for the server-rendered
        // half above. It is a wasted round trip when filing from the drawer,
        // and that is the right trade: the alternative is a prop about refresh
        // mechanics that each new call site has to get right.
      }
    );
  }

  // `handleSubmit(onSubmit)` alone is silent when validation fails, and this
  // form is taller than the drawer — the offending field and its message are
  // very often scrolled out of sight, so the button reads as dead.
  function onInvalid(errors: FieldErrors<DisciplineRecordFormValues>) {
    const names = Object.keys(errors);
    if (names.length === 0) return;
    const labels = names.map((n) => fieldLabels(isLetter)[n] ?? n);
    const shown = labels.slice(0, 3).join(', ');
    toast.error(
      labels.length > 3
        ? `Check these fields: ${shown}, and ${labels.length - 3} more.`
        : `Check these fields: ${shown}.`
    );
    form.setFocus(names[0] as Path<DisciplineRecordFormValues>);
  }

  const busy = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="record_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What is this?</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="gap-2"
                >
                  {DISCIPLINE_RECORD_TYPE_VALUES.map((value) => (
                    <label
                      key={value}
                      htmlFor={`discipline-type-${value}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo/40 has-[[data-state=checked]]:bg-brand-indigo/5"
                    >
                      <RadioGroupItem
                        value={value}
                        id={`discipline-type-${value}`}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium text-foreground">
                          {DISCIPLINE_RECORD_TYPE_LABELS[value]}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {DISCIPLINE_RECORD_TYPE_HINTS[value]}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-[1.35fr_1fr] gap-3">
          <FormField
            control={form.control}
            name="occurred_on"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{isLetter ? 'Date sent' : 'Date'}</FormLabel>
                <FormControl>
                  <DatePicker
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    placeholder="Pick a date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* A bare time is outside KD #44's ban, which names `date` and
              `datetime-local`. `DateTimePicker` is the wrong instrument here —
              it would force a clock time onto a letter, which has none. */}
          <FormField
            control={form.control}
            name="occurred_at_time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time</FormLabel>
                <FormControl>
                  <Input
                    type="time"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(orNull(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Letters only. The school's warning letter ends with a tear-off
            receipt due back in two days, so a letter is not finished when it is
            sent — but an incident has nothing for a parent to acknowledge. */}
        {isLetter && (
          <FormField
            control={form.control}
            name="acknowledged_on"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Parent returned the signed slip</FormLabel>
                <FormControl>
                  <DatePicker
                    value={field.value ?? ''}
                    onChange={(v) => field.onChange(orNull(v))}
                    placeholder="Not back yet"
                  />
                </FormControl>
                <FormDescription>
                  Leave blank until it comes back. Letters only.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Directly under the acknowledgement, because for a letter these are
            two halves of one fact: the day the signed slip came back, and
            where the scan of it lives. They used to sit five fields apart,
            which is why the link read as unrelated to it.

            Mr Ace, 2026-08-21, on how this is actually used: "they file here
            they send the document and attach here the signed/acknowledged
            document." So this is always the RETURNED copy, never the one that
            went out — on a letter the slip the parent signed, on an incident
            the acknowledged report. Only the wording changes. */}
        <FormField
          control={form.control}
          name="document_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {isLetter
                  ? 'Link to the signed slip'
                  : 'Link to the acknowledged incident report'}
              </FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(orNull(e.target.value))}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  inputMode="url"
                  placeholder="https://"
                />
              </FormControl>
              <FormDescription>
                {isLetter
                  ? 'Where the signed copy is saved.'
                  : 'Where the acknowledged copy is saved.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="nature"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What kind of thing was it?</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={
                    isLetter
                      ? 'First warning — attendance'
                      : 'Pushing in the canteen queue'
                  }
                />
              </FormControl>
              <FormDescription>
                In your own words for now — the school&rsquo;s list hasn&rsquo;t
                been shared yet.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="details"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What happened</FormLabel>
              <FormControl>
                <RichTextEditor
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  rows={4}
                  maxLength={DISCIPLINE_DETAILS_MAX}
                  draftKey={detailsDraftKey}
                  placeholder="Describe it as you would on the form."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="remarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <RichTextEditor
                  value={field.value ?? ''}
                  onChange={(v) => field.onChange(orNull(v))}
                  onBlur={field.onBlur}
                  rows={3}
                  maxLength={DISCIPLINE_REMARKS_MAX}
                  placeholder="Anything to add, including what happens next."
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            loadingText={isEdit ? 'Saving…' : 'Filing…'}
          >
            {isEdit ? 'Save changes' : 'File record'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
