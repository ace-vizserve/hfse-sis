'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { SheetFields, SheetSection } from '@/components/billing/sheet-section';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { CustomerForm } from '@/lib/billing/customer-form';
import type { NewCustomerStudent } from '@/lib/billing/new-customer';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// Billing → New customer: pick a student with no QuickBooks customer, check
// the form (filled from their newest application), add it to QuickBooks —
// linked to the student in the same step. A customer always belongs to a
// student here: one with none would never show in Billing.

type Key = keyof CustomerForm;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewCustomerSheet({
  open,
  onOpenChange,
  student: preset,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Open on this student (To review's row ▾); omitted = staff pick one. */
  student?: { studentNumber: string; name: string } | null;
}) {
  const run = useWriteAction();
  const [picked, setPicked] = useState<{
    studentNumber: string;
    name: string;
  } | null>(preset ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const students = useQuery({
    queryKey: ['billing-new-customer-students'],
    queryFn: () =>
      apiFetch<{ students: NewCustomerStudent[] }>('/api/billing/new-customer'),
    enabled: open && !preset,
  });
  const draft = useQuery({
    queryKey: ['billing-new-customer-form', picked?.studentNumber],
    queryFn: () =>
      apiFetch<{ form: CustomerForm }>(
        `/api/billing/new-customer?student=${encodeURIComponent(picked!.studentNumber)}`
      ),
    enabled: open && !!picked,
    staleTime: 0,
    gcTime: 0,
  });
  // Edits, kept per student so picking another starts from their own form.
  const [edits, setEdits] = useState<{ sn: string; form: CustomerForm }>();
  const form =
    edits && edits.sn === picked?.studentNumber
      ? edits.form
      : (draft.data?.form ?? null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const unclearRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEdits({
      sn: picked!.studentNumber,
      form: { ...form!, [k]: e.target.value },
    });
  const nameMissing = !!form && form.displayName.trim() === '';
  const emailBad =
    !!form && form.email.trim() !== '' && !EMAIL.test(form.email.trim());

  const add = useMutation({
    mutationFn: async (v: { studentNumber: string; form: CustomerForm }) => {
      try {
        return await apiFetch<{ displayName: string }>(
          `/api/billing/students/${encodeURIComponent(v.studentNumber)}/customer`,
          jsonInit('POST', { form: v.form, requestId })
        );
      } catch (err) {
        if (shouldRenewAfter(err, unclearRef))
          setRequestId(crypto.randomUUID());
        throw err;
      }
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked || !form) {
      setShowErrors(true);
      return;
    }
    if (nameMissing || emailBad) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(
      () => add.mutateAsync({ studentNumber: picked.studentNumber, form }),
      {
        pending: 'Adding to QuickBooks…',
        success: (d) => `${d.displayName} added to QuickBooks and linked`,
        onResolved: () => onOpenChange(false),
      }
    );
    setSaving(false);
  }

  const text = (
    k: Key,
    label: string,
    opts?: { mono?: boolean; type?: string }
  ) => (
    <Field>
      <FieldLabel htmlFor={`new-${k}`}>{label}</FieldLabel>
      <Input
        id={`new-${k}`}
        type={opts?.type}
        value={form?.[k] ?? ''}
        onChange={set(k)}
        className={opts?.mono ? 'font-mono' : undefined}
      />
    </Field>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Customers
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              New customer
            </SheetTitle>
            <SheetDescription>
              A QuickBooks customer for a student who has none yet, filled in
              from their application. Check it, then add it — it is linked to
              the student straight away.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <SheetSection title="Student">
              {preset ? (
                <p className="text-sm text-foreground">
                  {preset.name}{' '}
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {preset.studentNumber}
                  </span>
                </p>
              ) : (
                <Field>
                  <FieldLabel htmlFor="new-student" className="sr-only">
                    Student
                  </FieldLabel>
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="new-student"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={pickerOpen}
                        aria-invalid={showErrors && !picked}
                        className="w-full justify-between font-normal"
                      >
                        <span
                          className={cn(
                            'truncate',
                            !picked && 'text-muted-foreground'
                          )}
                        >
                          {picked
                            ? `${picked.name} · ${picked.studentNumber}`
                            : students.isLoading
                              ? 'Loading students…'
                              : 'Choose a student'}
                        </span>
                        <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-(--radix-popover-trigger-width) p-0"
                    >
                      <Command>
                        <CommandInput placeholder="Name or student number" />
                        <CommandList>
                          <CommandEmpty>
                            No student without a customer by that name.
                          </CommandEmpty>
                          {(students.data?.students ?? []).map((s) => (
                            <CommandItem
                              key={s.studentNumber}
                              value={`${s.name} ${s.studentNumber}`}
                              onSelect={() => {
                                setPicked({
                                  studentNumber: s.studentNumber,
                                  name: s.name,
                                });
                                setPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  'size-4',
                                  picked?.studentNumber === s.studentNumber
                                    ? 'opacity-100'
                                    : 'opacity-0'
                                )}
                              />
                              <span className="flex-1 truncate">{s.name}</span>
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {s.studentNumber}
                                {s.ayCode ? ` · ${s.ayCode}` : ''}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FieldDescription>
                    Only students with no QuickBooks customer are listed.
                  </FieldDescription>
                  {students.isError && (
                    <FieldError>{(students.error as Error).message}</FieldError>
                  )}
                  {showErrors && !picked && (
                    <FieldError>Choose the student first.</FieldError>
                  )}
                </Field>
              )}
            </SheetSection>

            {!picked ? null : draft.isError ? (
              <p className="text-sm text-destructive">
                {(draft.error as Error).message} Close and try again.
              </p>
            ) : !form ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                <SheetSection title="Name">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {text('givenName', 'First name')}
                    {text('middleName', 'Middle name')}
                    {text('familyName', 'Last name')}
                  </div>
                  <SheetFields>
                    <Field>
                      <FieldLabel htmlFor="new-displayName">
                        Customer display name *
                      </FieldLabel>
                      <Input
                        id="new-displayName"
                        value={form.displayName}
                        onChange={set('displayName')}
                        aria-invalid={showErrors && nameMissing}
                      />
                      {showErrors && nameMissing && (
                        <FieldError>
                          Customer display name is required.
                        </FieldError>
                      )}
                    </Field>
                    {text('companyName', 'Company name (parents)')}
                  </SheetFields>
                </SheetSection>
                <SheetSection title="Contact">
                  <SheetFields>
                    <Field>
                      <FieldLabel htmlFor="new-email">Email</FieldLabel>
                      <Input
                        id="new-email"
                        type="email"
                        value={form.email}
                        onChange={set('email')}
                        aria-invalid={showErrors && emailBad}
                      />
                      {showErrors && emailBad && (
                        <FieldError>That is not an email address.</FieldError>
                      )}
                    </Field>
                    {text('phone', 'Phone number', { mono: true })}
                    {text('mobile', 'Mobile number', { mono: true })}
                  </SheetFields>
                </SheetSection>
                <SheetSection title="Billing address">
                  <SheetFields>
                    {text('billLine1', 'Street address 1')}
                    {text('billLine2', 'Street address 2')}
                    {text('billCity', 'City')}
                    {text('billPostalCode', 'Postal code', { mono: true })}
                    {text('billCountry', 'Country')}
                  </SheetFields>
                </SheetSection>
              </>
            )}
          </div>

          <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border bg-background px-6 py-4">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Adding…"
              disabled={saving || (!!picked && !form)}
            >
              Add to QuickBooks
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
