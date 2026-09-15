'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { apiFetch, ApiError, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GRADING_METHOD_LABELS,
  GRADING_METHOD_VALUES,
  SubjectCreateSchema,
  type GradingMethod,
  type SubjectCreateInput,
  type SubjectCreateFormInput,
} from '@/lib/schemas/subject';

export type NewSubjectResult = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
  grading_method: GradingMethod;
};

// Originally extracted out of the (since-deleted) Structure Defaults
// template editor's `NewSubjectButton` — the form BODY only (fields +
// POST /catalog mutation), no Dialog/Sheet chrome, so it can be embedded
// in a caller's own chrome. Now used solely by `subject-catalog-card.tsx`'s
// "+ Add subject" Sheet drawer. Creates a `subjects` catalog row only — no
// weights/config, no level attachment; the caller decides what happens
// next (closes its chrome + refreshes so the new, still-unconfigured
// subject shows up as a fresh, flagged row).
export function NewSubjectForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (subject: NewSubjectResult) => void;
  onCancel: () => void;
}) {
  // Three generics, kept after migration 138 removed the schema's only
  // transformed field (report_label, now per academic year on
  // subject_configs): TFieldValues is what RHF's Controllers hold,
  // TTransformedValues is what handleSubmit receives. The two shapes are
  // identical today, and stating both keeps this form correct the moment a
  // transform comes back rather than failing then.
  const form = useForm<SubjectCreateFormInput, unknown, SubjectCreateInput>({
    resolver: zodResolver(SubjectCreateSchema),
    defaultValues: {
      code: '',
      name: '',
      is_examinable: true,
      grading_method: 'standard_sheet',
    },
  });

  useEffect(() => {
    form.reset({
      code: '',
      name: '',
      is_examinable: true,
      grading_method: 'standard_sheet',
    });
    // Reset once on mount only — this form is embedded fresh each time its
    // chrome (Dialog/Sheet) opens (both callers unmount-on-close), so a
    // mount-time reset is equivalent to the pre-extraction `useEffect(...,
    // [open])` without needing an `open` prop this component doesn't own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createMutation = useMutation({
    mutationFn: (values: SubjectCreateInput) =>
      apiFetch<NewSubjectResult>(
        '/api/sis/admin/subjects/catalog',
        jsonInit('POST', values)
      ),
  });

  const run = useWriteAction();

  // RHF's `isSubmitting` is the busy signal, and awaiting `run` holds it true
  // through the refresh as well as the POST. The caller's `onSuccess` now only
  // closes its chrome — this owns the refresh, so the caller refreshing too
  // would render the server twice for one save.
  async function onSubmit(values: SubjectCreateInput) {
    await run(() => createMutation.mutateAsync(values), {
      pending: `Adding ${values.code}…`,
      success: `Added ${values.code} — ${values.name}`,
      error: (e) => {
        if (e instanceof ApiError) {
          const bodyError = (e.body as { error?: string } | null)?.error;
          return bodyError ?? `Save failed (${e.status})`;
        }
        return e instanceof Error ? e.message : 'Save failed';
      },
      onResolved: (result) => onSuccess(result),
    });
  }

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus
                  placeholder="MATH, ENG, FIL…"
                  onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  className="font-mono uppercase"
                />
              </FormControl>
              <FormDescription>
                Uppercase letters, digits, underscore, or hyphen. Max 32
                characters. Permanent after creation.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Mathematics" />
              </FormControl>
              <FormDescription>
                Shown on grading sheets, report cards, and dropdowns.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Grade type — the SAME control the edit form shows, worded the same
            way (components/sis/subject-config-form.tsx).

            It used to be a checkbox labelled "Examinable", described only as
            "counted toward the term/annual academic average". That never said
            what the flag actually decides — whether the subject carries a
            NUMBER or a LETTER — and "examinable" is the word that sent Miss
            Joann looking for a per-term exam switch at the 2026-09-15 training.
            Two screens told two stories about one column; this is the one that
            was left behind when the edit form was fixed.

            ⚠ The flag itself is untouched and must be: `subjects.is_examinable`
            drives letter-vs-numeric across ~47 files — MUSIC, ARTS, PE, HE, CL,
            CA, PEH and PMPD are all letter-graded through it (migration 049).
            "Does this term have an exam" is a different question entirely, and
            it lives on the grading sheet now (migration 159). */}
        <FormField
          control={form.control}
          name="is_examinable"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Grade type</FormLabel>
              <Select
                value={field.value ? 'numeric' : 'letter'}
                onValueChange={(v) => field.onChange(v === 'numeric')}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="numeric">Numeric</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Numeric subjects get a mark out of 100 and count towards the
                general average. Letter subjects show a letter on the report
                card instead — music, art, PE and the like.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="grading_method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Grading method</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {GRADING_METHOD_VALUES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {GRADING_METHOD_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Standard sheet generates a WW/PT/QA grading grid when attached
                to a section. No sheet records this subject some other way and
                skips grid generation.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={submitting}
            loadingText="Adding…"
            className="gap-1.5"
          >
            Add subject
          </Button>
        </div>
      </form>
    </Form>
  );
}
