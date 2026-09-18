'use client';

import { useMutation } from '@tanstack/react-query';
import { Hash, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// WHY THIS CARD SHOWS TWO NUMBERS INSTEAD OF ONE FIELD.
//
// 221 of the 430 AY2026 children are numbered differently by the school than by
// this system, because the school numbers children sequentially within a class
// while the system numbers them by when the application arrived. Neither is
// wrong, and both are in daily use — so the confusion this card exists to fix
// is "which number am I looking at".
//
// A lone "School student number" input would not answer that. Showing the two
// side by side, each labelled with who uses it and whether it can change, makes
// the distinction the content rather than something to be explained elsewhere.
//
// ⚠ The system ID is deliberately NOT editable anywhere in the app. It must
// equal the admissions number, or the student sync stops recognising the child
// and creates a second one.
export function StudentNumbersCard({
  studentNumber,
  initialSchoolNumber,
  canEdit,
}: {
  studentNumber: string;
  initialSchoolNumber: string | null;
  canEdit: boolean;
}) {
  const [saved, setSaved] = useState<string | null>(initialSchoolNumber);
  const [value, setValue] = useState<string>(initialSchoolNumber ?? '');
  const [saving, setSaving] = useState(false);

  const trimmed = value.trim().toUpperCase();
  const normalised = trimmed === '' ? null : trimmed;
  const dirty = normalised !== saved;
  const tooLong = trimmed.length > 20;
  const badChars = trimmed !== '' && !/^[A-Z0-9-]+$/.test(trimmed);
  const problem = tooLong
    ? 'Use 20 characters or fewer'
    : badChars
      ? 'Use letters, numbers and hyphens only'
      : null;

  const saveMutation = useMutation({
    mutationFn: (schoolStudentNumber: string | null) =>
      apiFetch(
        `/api/students/${encodeURIComponent(studentNumber)}/school-number`,
        jsonInit('PATCH', { schoolStudentNumber })
      ),
  });

  const run = useWriteAction();

  async function save() {
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    // `run` resolves to `undefined` only when the write threw — so a defined
    // result is the signal that the saved value actually moved.
    const result = await run(() => saveMutation.mutateAsync(normalised), {
      pending: 'Saving…',
      success: normalised
        ? `School number set to ${normalised}`
        : 'School number cleared',
      error: (err) =>
        err instanceof Error ? err.message : 'Could not save the number',
    });
    if (result !== undefined) setSaved(normalised);
    setSaving(false);
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>Identity</CardDescription>
        <CardTitle className="font-serif text-xl">Student numbers</CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Hash className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 @2xl/card:grid-cols-2 @2xl/card:gap-8">
          {/* Left: the fixed one. Static text, not a disabled input — a greyed
              field invites clicking and implies it could be enabled. */}
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Used in this system
            </p>
            <p className="font-mono text-[22px] font-semibold tabular-nums leading-none text-foreground">
              {studentNumber}
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Cannot be changed. Every grade, absence and document for this
              child is filed under it.
            </p>
          </div>

          {/* Right: the editable one. */}
          <Field data-invalid={problem ? true : undefined}>
            <FieldLabel
              htmlFor="school-student-number"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Used on the school&rsquo;s class lists
            </FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="school-student-number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={!canEdit || saving}
                maxLength={24}
                spellCheck={false}
                autoComplete="off"
                placeholder={studentNumber}
                aria-invalid={problem ? true : undefined}
                className="h-10 max-w-[180px] font-mono text-[15px] uppercase tabular-nums"
              />
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={saving}
                  loadingText="Saving…"
                  disabled={!dirty || !!problem}
                  onClick={() => void save()}
                  className="gap-1.5"
                >
                  {!saving && <Save className="size-3.5" />}
                  Save
                </Button>
              )}
            </div>
            <FieldDescription
              className={problem ? 'text-destructive' : undefined}
            >
              {problem ??
                (canEdit
                  ? 'Leave empty when the office uses the same number as this system.'
                  : 'Only Records staff can change this.')}
            </FieldDescription>
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
