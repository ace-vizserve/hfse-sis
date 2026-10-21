'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { SheetFields, SheetSection } from '@/components/billing/sheet-section';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { CustomerForm } from '@/lib/billing/customer-form';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';

// The add-a-QuickBooks-customer form, filled from the student's newest
// application — shared by Billing → New customer and Create invoice's "Who is
// this invoice for" step. The hook owns the draft, the edits and the save; the
// fields render it.

type Key = keyof CustomerForm;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewCustomerFormState = ReturnType<typeof useNewCustomerForm>;

export function useNewCustomerForm({
  studentNumber,
  enabled,
  onDuplicate,
}: {
  studentNumber: string | null;
  enabled: boolean;
  /** QuickBooks refused the name as taken: the caller offers linking that
   *  customer instead (no error toast then). */
  onDuplicate?: (name: string) => void;
}) {
  const run = useWriteAction();
  const draft = useQuery({
    queryKey: ['billing-new-customer-form', studentNumber],
    queryFn: () =>
      apiFetch<{ form: CustomerForm }>(
        `/api/billing/new-customer?student=${encodeURIComponent(studentNumber!)}`
      ),
    enabled: enabled && !!studentNumber,
    staleTime: 0,
    gcTime: 0,
  });
  // Edits, kept per student so picking another starts from their own form.
  const [edits, setEdits] = useState<{ sn: string; form: CustomerForm }>();
  const form =
    edits && edits.sn === studentNumber
      ? edits.form
      : (draft.data?.form ?? null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const unclearRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEdits({ sn: studentNumber!, form: { ...form!, [k]: e.target.value } });
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

  /** Validates, then adds and links. False when nothing was sent. */
  async function submit(opts?: { onResolved?: () => void }): Promise<boolean> {
    if (!studentNumber || !form || nameMissing || emailBad) {
      setShowErrors(true);
      return false;
    }
    setSaving(true);
    await run(() => add.mutateAsync({ studentNumber, form }), {
      pending: 'Adding to QuickBooks…',
      success: (d) => `${d.displayName} added to QuickBooks and linked`,
      error: (err) => {
        const body =
          err instanceof ApiError &&
          err.body &&
          typeof err.body === 'object' &&
          !Array.isArray(err.body)
            ? (err.body as { duplicateName?: unknown; error?: unknown })
            : null;
        if (onDuplicate && typeof body?.duplicateName === 'string') {
          onDuplicate(body.duplicateName);
          return null;
        }
        return typeof body?.error === 'string'
          ? body.error
          : err instanceof Error
            ? err.message
            : 'Couldn’t add the customer.';
      },
      onResolved: () => opts?.onResolved?.(),
    });
    setSaving(false);
    return true;
  }

  return {
    form,
    set,
    draft,
    showErrors,
    nameMissing,
    emailBad,
    saving,
    submit,
  };
}

/** The form's sections: Name, Contact, Billing address. */
export function NewCustomerFields({ f }: { f: NewCustomerFormState }) {
  const { form, set, draft, showErrors, nameMissing, emailBad } = f;
  if (draft.isError)
    return (
      <p className="text-sm text-destructive">
        {(draft.error as Error).message} Close and try again.
      </p>
    );
  if (!form)
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
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
        value={form[k] ?? ''}
        onChange={set(k)}
        className={opts?.mono ? 'font-mono' : undefined}
      />
    </Field>
  );
  return (
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
              <FieldError>Customer display name is required.</FieldError>
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
  );
}
