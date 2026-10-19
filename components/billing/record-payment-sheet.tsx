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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  type PayableInvoice,
} from '@/lib/billing/payment-plan';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { formatDay, round2, todaySg } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

export function RecordPaymentSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  openInvoices,
  credits,
  depositAccounts,
  mode,
  customerBalance,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  openInvoices: PayableInvoice[];
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  /** 'credit' opens it as Use credit: credit ticked, no new money. */
  mode: 'pay' | 'credit';
  /** QuickBooks' balance for the whole customer; without it the header shows
   *  what is owed on the invoices listed. */
  customerBalance?: number | null;
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
  // One id per open: a retry of the same submit can't record twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
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
    mutationFn: async () => {
      try {
        return await apiFetch<{
          warnings: string[];
          plan: { creditUsed: number; leftover: number };
        }>(
          `/api/billing/students/${encodeURIComponent(studentNumber)}/payments`,
          jsonInit('POST', {
            amount: cash,
            txnDate,
            depositAccountId: needsAccount ? account : null,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            invoiceIds: invoices
              .filter((i) => ticked.has(i.id))
              .map((i) => i.id),
            useCredit,
            requestId,
          })
        );
      } catch (err) {
        // Our route answered with its own error (JSON with `error`): take a
        // fresh id so the next submit isn't replayed from the old one — unless
        // it said `keepRequestId` (QuickBooks didn't answer the write). That,
        // network failures, lost responses and platform timeouts keep the
        // same id, so a retry is de-duplicated.
        if (shouldRenewRequestId(err)) setRequestId(crypto.randomUUID());
        throw err;
      }
    },
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
        if (cash <= 0) return `${formatSgd(d.plan.creditUsed)} of credit used`;
        return d.plan.leftover > 0
          ? `${formatSgd(cash)} recorded · ${formatSgd(d.plan.leftover)} kept as credit`
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

  // Laid out as QuickBooks' Receive Payment: Amount received and the customer
  // balance top right, Payment date / Reference no. / Deposit to / Amount
  // received, then Outstanding Transactions. Paid oldest first, up to the
  // amount, as before.
  const title = mode === 'credit' ? 'Use credit' : 'Receive Payment';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-4xl"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 border-b border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
              <div className="space-y-1">
                <SheetTitle className="font-serif text-[24px] leading-tight tracking-tight">
                  {title}
                </SheetTitle>
                <SheetDescription>
                  Customer:{' '}
                  <span className="font-medium text-foreground">
                    {studentName}
                  </span>
                </SheetDescription>
              </div>
              <div className="text-right">
                <p className="text-[12px] text-muted-foreground">
                  Amount received
                </p>
                <p className="font-serif text-[30px] font-semibold leading-none tabular-nums text-foreground">
                  {formatSgd(amountValid ? cash : 0)}
                </p>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {customerBalance != null
                    ? 'Customer balance'
                    : 'Owed on these invoices'}{' '}
                  <span className="tabular-nums text-foreground">
                    {formatSgd(customerBalance ?? owed)}
                  </span>
                </p>
              </div>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field>
                  <FieldLabel htmlFor="pay-date">Payment date</FieldLabel>
                  <DatePicker
                    id="pay-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-ref">Reference no.</FieldLabel>
                  <Input
                    id="pay-ref"
                    value={reference}
                    maxLength={21}
                    onChange={(e) => setReference(e.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-account">Deposit to</FieldLabel>
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
                      QuickBooks has no bank accounts to offer just now. Reload
                      the page to try again.
                    </FieldDescription>
                  )}
                  {showErrors && needsAccount && !account && (
                    <FieldError>Choose the account.</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-amount">Amount received</FieldLabel>
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

              <section className="space-y-2">
                <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
                  Outstanding Transactions
                </h3>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is owing. The payment will be kept as credit.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40">
                          <TableHead className="w-10">
                            <Checkbox
                              aria-label="Tick all"
                              checked={
                                ticked.size === invoices.length
                                  ? true
                                  : ticked.size === 0
                                    ? false
                                    : 'indeterminate'
                              }
                              onCheckedChange={(v) =>
                                setTicked(
                                  v === true
                                    ? new Set(invoices.map((i) => i.id))
                                    : new Set()
                                )
                              }
                            />
                          </TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Due date</TableHead>
                          <TableHead className="text-right">
                            Original amount
                          </TableHead>
                          <TableHead className="text-right">
                            Open balance
                          </TableHead>
                          <TableHead className="text-right">Payment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((i) => {
                          const on = ticked.has(i.id);
                          const pays = applied.get(i.id) ?? 0;
                          return (
                            <TableRow
                              key={i.id}
                              data-state={on ? 'selected' : undefined}
                            >
                              <TableCell>
                                <Checkbox
                                  aria-label={`Pay ${i.docNumber ?? i.id}`}
                                  checked={on}
                                  onCheckedChange={(v) =>
                                    toggle(i.id, v === true)
                                  }
                                />
                              </TableCell>
                              <TableCell className="min-w-48">
                                <span>
                                  Invoice #{' '}
                                  <span className="font-mono tabular-nums">
                                    {i.docNumber ?? i.id}
                                  </span>{' '}
                                  <span className="tabular-nums text-muted-foreground">
                                    ({formatDay(i.txnDate)})
                                  </span>
                                </span>
                                <span className="block max-w-64 truncate text-[12px] text-muted-foreground">
                                  {i.items}
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums">
                                {i.dueDate ? formatDay(i.dueDate) : '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {i.total !== undefined
                                  ? formatSgd(i.total)
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatSgd(i.balance)}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {on && pays > 0 ? formatSgd(pays) : ''}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-[12px] text-muted-foreground">
                  Ticked invoices are paid oldest first, up to the amount
                  received. Untick all to keep the money as credit on the
                  customer.
                </p>
              </section>

              <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
                {plan.creditUsed > 0 && (
                  <>
                    <dt className="text-muted-foreground">Credit used</dt>
                    <dd className="text-right tabular-nums">
                      {formatSgd(plan.creditUsed)}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">Amount to apply</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(plan.cashApplied)}
                </dd>
                <dt className="text-muted-foreground">Amount to credit</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(plan.leftover)}
                </dd>
              </dl>
              {showErrors && nothingToDo && (
                <FieldError>
                  Enter the amount received, or use credit on a ticked invoice.
                </FieldError>
              )}
            </FieldGroup>
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
              loadingText="Recording…"
              disabled={saving}
            >
              {cash > 0 ? 'Record and close' : 'Use credit and close'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
