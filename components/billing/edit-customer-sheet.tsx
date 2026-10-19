'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPin, NotebookPen, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
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
import { Skeleton } from '@/components/ui/skeleton';
import type { CustomerForm } from '@/lib/billing/customer-form';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Customer page → Edit: QuickBooks' Customer form (Name and contact,
// Addresses, Notes), read from QuickBooks when it opens and saved back to it.
// QuickBooks' fields are plain text, so Notes is a plain input here.

type Key = keyof CustomerForm;

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 border-b border-border pb-2 font-serif text-base font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function EditCustomerSheet({
  open,
  onOpenChange,
  studentNumber,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
}) {
  const run = useWriteAction();
  const url = `/api/billing/students/${encodeURIComponent(studentNumber)}/customer`;
  const read = useQuery({
    queryKey: ['billing-customer-form', studentNumber],
    queryFn: () => apiFetch<{ form: CustomerForm }>(url),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const [form, setForm] = useState<CustomerForm | null>(null);
  const current = form ?? read.data?.form ?? null;
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...(f ?? current!), [k]: e.target.value }));
  const nameMissing = !!current && current.displayName.trim() === '';
  const emailBad =
    !!current &&
    current.email.trim() !== '' &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.email.trim());

  const save = useMutation({
    mutationFn: async (body: CustomerForm) => {
      try {
        return await apiFetch<{ form: CustomerForm; changed: string[] }>(
          url,
          jsonInit('PATCH', { ...body, requestId })
        );
      } catch (err) {
        if (shouldRenewRequestId(err)) setRequestId(crypto.randomUUID());
        throw err;
      }
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    if (nameMissing || emailBad) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(current), {
      pending: 'Saving to QuickBooks…',
      success: (d) =>
        d.changed.length === 0
          ? 'Nothing changed'
          : `Saved in QuickBooks: ${d.changed.join(', ')}`,
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  const text = (k: Key, label: string, opts?: { mono?: boolean }) => (
    <Field>
      <FieldLabel htmlFor={`cust-${k}`}>{label}</FieldLabel>
      <Input
        id={`cust-${k}`}
        value={current?.[k] ?? ''}
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
          <SheetHeader className="shrink-0 border-b border-border p-5">
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              Customer
            </SheetTitle>
            <SheetDescription>
              Saved straight to QuickBooks, as Edit does there.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {read.isError ? (
              <p className="text-sm text-destructive">
                {read.error instanceof Error
                  ? read.error.message
                  : 'QuickBooks couldn’t be read.'}{' '}
                Close and try again.
              </p>
            ) : !current ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <FieldGroup className="gap-8">
                <Section icon={UserRound} title="Name and contact">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[80px_1fr_1fr_1fr_80px]">
                    {text('title', 'Title')}
                    {text('givenName', 'First name')}
                    {text('middleName', 'Middle name')}
                    {text('familyName', 'Last name')}
                    {text('suffix', 'Suffix')}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {text('companyName', 'Company name')}
                    <Field>
                      <FieldLabel htmlFor="cust-displayName">
                        Customer display name *
                      </FieldLabel>
                      <Input
                        id="cust-displayName"
                        value={current.displayName}
                        onChange={set('displayName')}
                        aria-invalid={showErrors && nameMissing}
                      />
                      {showErrors && nameMissing && (
                        <FieldError>
                          Customer display name is required.
                        </FieldError>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="cust-email">Email</FieldLabel>
                      <Input
                        id="cust-email"
                        type="email"
                        value={current.email}
                        onChange={set('email')}
                        aria-invalid={showErrors && emailBad}
                      />
                      {showErrors && emailBad && (
                        <FieldError>That is not an email address.</FieldError>
                      )}
                    </Field>
                    {text('phone', 'Phone number', { mono: true })}
                    {text('mobile', 'Mobile number', { mono: true })}
                    {text('fax', 'Fax', { mono: true })}
                    {text('other', 'Other', { mono: true })}
                    {text('website', 'Website')}
                  </div>
                </Section>
                <Section icon={MapPin} title="Addresses">
                  <p className="text-[13px] font-medium text-foreground">
                    Billing address
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {text('billLine1', 'Street address 1')}
                    {text('billLine2', 'Street address 2')}
                    {text('billCity', 'City')}
                    {text('billState', 'State')}
                    {text('billPostalCode', 'Postal code', { mono: true })}
                    {text('billCountry', 'Country')}
                  </div>
                </Section>
                <Section icon={NotebookPen} title="Notes">
                  {text('notes', 'Notes')}
                </Section>
              </FieldGroup>
            )}
          </div>
          <SheetFooter className="shrink-0 flex-row justify-between gap-2 border-t border-border bg-background p-5">
            <SheetClose asChild>
              <Button type="button" variant="ghost" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Saving…"
              disabled={saving || !current}
            >
              Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
