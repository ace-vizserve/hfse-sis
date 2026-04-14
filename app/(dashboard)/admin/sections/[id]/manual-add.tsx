'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, UserPlus } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export function ManualAddStudent({
  sectionId,
  nextIndex,
}: {
  sectionId: string;
  nextIndex: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    student_number: '',
    last_name: '',
    first_name: '',
    middle_name: '',
    late_enrollee: false,
  });

  function reset() {
    setForm({
      student_number: '',
      last_name: '',
      first_name: '',
      middle_name: '',
      late_enrollee: false,
    });
    setError(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sections/${sectionId}/students`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          student_number: form.student_number.trim(),
          last_name: form.last_name.trim(),
          first_name: form.first_name.trim(),
          middle_name: form.middle_name.trim() || null,
          enrollment_status: form.late_enrollee ? 'late_enrollee' : 'active',
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'failed');
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4" />
          Manually add student
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
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

        <form onSubmit={submit} className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ma-student-number">Student number</FieldLabel>
                <Input
                  id="ma-student-number"
                  required
                  autoFocus
                  value={form.student_number}
                  onChange={(e) => setForm({ ...form, student_number: e.target.value })}
                />
                <FieldDescription>
                  Stable cross-year ID. Never reused even after the student leaves.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="ma-last-name">Last name</FieldLabel>
                <Input
                  id="ma-last-name"
                  required
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ma-first-name">First name</FieldLabel>
                <Input
                  id="ma-first-name"
                  required
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ma-middle-name">Middle name</FieldLabel>
                <Input
                  id="ma-middle-name"
                  value={form.middle_name}
                  onChange={(e) => setForm({ ...form, middle_name: e.target.value })}
                />
                <FieldDescription>Optional.</FieldDescription>
              </Field>

              <Label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-normal text-foreground">
                <Checkbox
                  checked={form.late_enrollee}
                  onCheckedChange={(v) => setForm({ ...form, late_enrollee: v === true })}
                  className="mt-0.5"
                />
                <span>
                  Late enrollee
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Assessments before the enrolment date will be marked N/A.
                  </span>
                </span>
              </Label>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
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
      </SheetContent>
    </Sheet>
  );
}
