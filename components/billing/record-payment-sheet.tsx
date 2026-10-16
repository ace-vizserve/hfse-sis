'use client';

import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
} from '@/components/ui/sheet';
import {
  oldestFirst,
  planPayment,
  type CreditSource,
  type OpenInvoice,
} from '@/lib/billing/payment-plan';
import { formatDay, round2, todaySg } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

export function RecordPaymentSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  openInvoices,
  credits,
  depositAccounts,
  mode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  /** 'credit' opens it as Use credit: credit ticked, no new money. */
  mode: 'pay' | 'credit';
}) {
  const run = useWriteAction();
  const invoices = useMemo(() => oldestFirst(openInvoices), [openInvoices]);
  const creditTotal = round2(credits.reduce((s, c) => s + c.unapplied, 0));
  const owed = round2(invoices.reduce((s, i) => s + i.balance, 0));
  const [useCredit, setUseCredit] = useState(
    mode === 'credit' && creditTotal > 0
  );
  // Record payment starts at everything owed; Use credit starts with no new money.
  const [amount, setAmount] = useState(() =>
    mode === 'credit' ? '' : owed.toFixed(2)
  );
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [account, setAccount] = useState(depositAccounts[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(invoices.map((i) => i.id))
  );
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const cash = amount.trim() === '' ? 0 : Number(amount);
  const amountValid = Number.isFinite(cash) && cash >= 0;
  const plan = useMemo(
    () =>
      planPayment({
        invoices: invoices.filter((i) => ticked.has(i.id)),
        credits,
        useCredit,
        amount: amountValid ? cash : 0,
      }),
    [invoices, ticked, credits, useCredit, cash, amountValid]
  );
  const applied = new Map<string, number>();
  for (const x of [...plan.creditUse, ...plan.cashApply])
    applied.set(
      x.invoiceId,
      round2((applied.get(x.invoiceId) ?? 0) + x.amount)
    );
  const needsAccount = cash > 0;
  const nothingToDo = cash <= 0 && plan.creditUsed <= 0;
  const valid = amountValid && !nothingToDo && (!needsAccount || !!account);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ warnings: string[] }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/payments`,
        jsonInit('POST', {
          amount: cash,
          txnDate,
          depositAccountId: needsAccount ? account : null,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          invoiceIds: invoices.filter((i) => ticked.has(i.id)).map((i) => i.id),
          useCredit,
        })
      ),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Recording in QuickBooks…',
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        if (cash <= 0) return `${formatSgd(plan.creditUsed)} of credit used`;
        return plan.leftover > 0
          ? `${formatSgd(cash)} recorded · ${formatSgd(plan.leftover)} kept as credit`
          : `${formatSgd(cash)} recorded in QuickBooks`;
      },
      onResolved: () => {
        onOpenChange(false);
      },
    });
    setSaving(false);
  }

  const toggle = (id: string, on: boolean) =>
    setTicked((t) => {
      const n = new Set(t);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border p-5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {studentName}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {mode === 'credit' ? 'Use credit' : 'Record payment'}
            </SheetTitle>
            <SheetDescription>
              Recorded in QuickBooks first. The SIS saves it once QuickBooks
              accepts.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="pay-amount">
                    Amount received (S$)
                  </FieldLabel>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={
                      mode === 'credit' ? '0.00 — credit only' : '0.00'
                    }
                    className="tabular-nums"
                  />
                  {showErrors && !amountValid && (
                    <FieldError>Enter an amount of 0 or more.</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-date">Date received</FieldLabel>
                  <DatePicker
                    id="pay-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="pay-account">Paid into</FieldLabel>
                  <Select
                    value={account}
                    onValueChange={setAccount}
                    disabled={!needsAccount}
                  >
                    <SelectTrigger id="pay-account" className="w-full">
                      <SelectValue placeholder="Choose an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {depositAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {depositAccounts.length === 0 && (
                    <FieldDescription>
                      No payment accounts yet — a superadmin sets them in
                      Billing settings.
                    </FieldDescription>
                  )}
                  {showErrors && needsAccount && !account && (
                    <FieldError>Choose the account.</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-ref">Reference no.</FieldLabel>
                  <Input
                    id="pay-ref"
                    value={reference}
                    maxLength={21}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Bank or card reference"
                    className="font-mono"
                  />
                </Field>
              </div>

              {creditTotal > 0 && (
                <label
                  htmlFor="pay-credit"
                  className="flex items-center gap-3 rounded-md border border-primary/30 bg-accent px-3 py-2.5 text-sm text-accent-foreground"
                >
                  <Checkbox
                    id="pay-credit"
                    checked={useCredit}
                    onCheckedChange={(v) => setUseCredit(v === true)}
                  />
                  <span className="flex-1">
                    Use credit first
                    <span className="block text-[12px] text-muted-foreground">
                      {credits
                        .map(
                          (c) =>
                            `${c.reference ? c.reference : 'Payment'}, ${formatDay(c.txnDate)}`
                        )
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatSgd(creditTotal)}</span>
                </label>
              )}

              <Field>
                <FieldLabel>Pays these invoices</FieldLabel>
                <FieldDescription>
                  Oldest first, up to the amount. Untick all to keep the money
                  as credit on the customer.
                </FieldDescription>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is owing. The payment will be kept as credit.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {invoices.map((i) => {
                      const on = ticked.has(i.id);
                      const pays = applied.get(i.id) ?? 0;
                      return (
                        <label
                          key={i.id}
                          className={cn(
                            'grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm',
                            on && 'border-brand-indigo bg-brand-indigo/5'
                          )}
                        >
                          <Checkbox
                            checked={on}
                            onCheckedChange={(v) => toggle(i.id, v === true)}
                          />
                          <span className="min-w-0">
                            <span className="font-mono font-semibold tabular-nums">
                              {i.docNumber ?? i.id}
                            </span>
                            <span className="ml-2 text-muted-foreground">
                              {i.items}
                            </span>
                            <span className="block text-[12px] text-muted-foreground">
                              {formatDay(i.txnDate)} · owes{' '}
                              {formatSgd(i.balance)}
                            </span>
                          </span>
                          <span className="text-right tabular-nums">
                            {on && pays > 0 ? `pays ${formatSgd(pays)}` : '—'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>

              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
                {plan.creditUsed > 0 && (
                  <>
                    <dt className="text-muted-foreground">Credit used</dt>
                    <dd className="text-right tabular-nums">
                      {formatSgd(plan.creditUsed)}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">From this payment</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(plan.cashApplied)}
                </dd>
                <dt className="text-muted-foreground">Left over</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(plan.leftover)}
                  {plan.leftover > 0 && (
                    <span className="block text-[12px] text-muted-foreground">
                      stays as credit on the customer
                    </span>
                  )}
                </dd>
              </dl>
              {showErrors && nothingToDo && (
                <FieldError>
                  Enter the amount received, or use credit on a ticked invoice.
                </FieldError>
              )}
            </FieldGroup>
          </div>
          <SheetFooter className="shrink-0 gap-2 border-t border-border bg-background p-5">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="submit"
              loading={saving}
              loadingText="Saving in QuickBooks…"
              disabled={saving}
            >
              {cash > 0 ? 'Record in QuickBooks' : 'Use credit in QuickBooks'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
