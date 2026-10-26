'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { SowModule } from '@/lib/schemas/sow';

// Edit module details: the scheme's header block in the school's template
// (syllabus, hours, methods, pass requirement, textbook, references).
//
// Plain inputs, not the formatting editor: these are stored as plain text
// (`SowModuleEditSchema`) and land in single cells of the Excel template, so
// list formatting would have nowhere to go.

export const MODULE_FIELDS: {
  key: keyof SowModule;
  label: string;
  max: number;
}[] = [
  { key: 'title', label: 'Module title', max: 300 },
  { key: 'syllabus', label: 'Syllabus', max: 2000 },
  { key: 'hoursPerWeek', label: 'Hours per week', max: 50 },
  { key: 'teachingMethods', label: 'Teaching methods', max: 2000 },
  { key: 'passRequirement', label: 'Pass requirement', max: 1000 },
  { key: 'textbook', label: 'Textbook', max: 1000 },
  { key: 'references', label: 'References', max: 2000 },
  { key: 'remarks', label: 'Remarks', max: 2000 },
];

type Form = Record<keyof SowModule, string>;

const fromModule = (m: Record<string, unknown>): Form =>
  Object.fromEntries(
    MODULE_FIELDS.map((f) => [
      f.key,
      typeof m[f.key] === 'string' ? (m[f.key] as string) : '',
    ])
  ) as Form;

export function EditModuleSheet({
  open,
  onOpenChange,
  sowId,
  module,
  updatedAt,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sowId: string;
  module: Record<string, unknown>;
  updatedAt: string;
  title: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {open && (
          <ModuleForm
            key={updatedAt}
            sowId={sowId}
            module={module}
            updatedAt={updatedAt}
            title={title}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ModuleForm({
  sowId,
  module,
  updatedAt,
  title,
  onDone,
}: {
  sowId: string;
  module: Record<string, unknown>;
  updatedAt: string;
  title: string;
  onDone: () => void;
}) {
  const run = useWriteAction();
  const [form, setForm] = useState<Form>(() => fromModule(module));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const initial = fromModule(module);
    const changed: SowModule = {};
    for (const f of MODULE_FIELDS) {
      if (form[f.key] !== initial[f.key]) changed[f.key] = form[f.key];
    }
    if (Object.keys(changed).length === 0) {
      onDone();
      return;
    }
    setConflict(null);
    setSaving(true);
    await run(
      () =>
        apiFetch(
          `/api/sow/${sowId}`,
          jsonInit('PATCH', { module: changed, expectedUpdatedAt: updatedAt })
        ),
      {
        pending: 'Saving module details…',
        success: 'Module details saved',
        error: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConflict(err.message);
            return null;
          }
          return err instanceof Error && err.message
            ? err.message
            : 'Could not save. Please try again.';
        },
        onResolved: onDone,
      }
    );
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
        <p className="text-[13px] text-muted-foreground">{title}</p>
        <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
          Module details
        </SheetTitle>
        <SheetDescription>
          The top of the scheme of work: what it follows, how it is taught and
          what students need to pass.
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {conflict && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive"
          >
            {conflict}
          </div>
        )}
        <FieldGroup>
          {MODULE_FIELDS.map((f, i) => (
            <Field key={f.key}>
              <FieldLabel htmlFor={`module-${f.key}`}>{f.label}</FieldLabel>
              <Input
                id={`module-${f.key}`}
                value={form[f.key]}
                maxLength={f.max}
                autoFocus={i === 0}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
              />
            </Field>
          ))}
        </FieldGroup>
      </div>
      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-6 py-4">
        <SheetClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </SheetClose>
        <Button type="submit" loading={saving} loadingText="Saving…">
          Save module details
        </Button>
      </SheetFooter>
    </form>
  );
}
