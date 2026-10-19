'use client';

import { useMutation } from '@tanstack/react-query';
import { Search } from 'lucide-react';
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
  PAYMENT_NOTE_MAX,
  planAllocatedPayment,
  planPayment,
  type Allocation,
  type CreditSource,
  type PayableInvoice,
  type PaymentPlan,
} from '@/lib/billing/payment-plan';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { formatDay, round2, todaySg } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

const cents = (n: number) => Math.round(n * 100);
/** A typed Payment cell: null when it isn't a number of 0 or more. */
const cellValue = (s: string): number | null => {
  if (s.trim() === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function RecordPaymentSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  openInvoices,
  credits,
  depositAccounts,
  paymentMethods = [],
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
  /** QuickBooks' payment methods (Cash, Cheque…); the field is optional. */
  paymentMethods?: Array<{ id: string; label: string }>;
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
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [find, setFind] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(invoices.map((i) => i.id))
  );
  // QuickBooks' Payment cells. null: filled from Amount received, oldest
  // first. Once a cell is typed in, the cells are the plan and Amount
  // received is their sum; typing Amount received again re-fills them.
  const [typed, setTyped] = useState<Map<string, string> | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const balanceOf = useMemo(
    () => new Map(invoices.map((i) => [i.id, i.balance])),
    [invoices]
  );
  const cellBad = (id: string, s: string) => {
    const v = cellValue(s);
    return v === null || cents(v) > cents(balanceOf.get(id) ?? 0);
  };
  const badCells = typed
    ? [...typed].filter(([id, s]) => cellBad(id, s)).map(([id]) => id)
    : [];
  const allocations: Allocation[] = typed
    ? [...typed]
        .filter(([id, s]) => !cellBad(id, s) && (cellValue(s) ?? 0) > 0)
        .map(([invoiceId, s]) => ({ invoiceId, amount: cellValue(s)! }))
    : [];

  const typedCash = amount.trim() === '' ? 0 : Number(amount);
  const amountValid = typed
    ? true
    : Number.isFinite(typedCash) && typedCash >= 0;

  const plan: PaymentPlan = (() => {
    if (typed) {
      // The money is whatever the typed cells need after credit; nothing
      // is left over, as in QuickBooks.
      const total = allocations.reduce((s, a) => s + cents(a.amount), 0) / 100;
      const r = planAllocatedPayment({
        invoices,
        credits,
        useCredit,
        amount: total,
        allocations,
      });
      if (r.ok) return { ...r.plan, leftover: 0 };
      return {
        creditUse: [],
        cashApply: [],
        creditUsed: 0,
        cashApplied: 0,
        leftover: 0,
      };
    }
    return planPayment({
      invoices: invoices.filter((i) => ticked.has(i.id)),
      credits,
      useCredit,
      amount: amountValid ? typedCash : 0,
    });
  })();
  const cash = typed ? plan.cashApplied : amountValid ? typedCash : 0;

  const applied = new Map<string, number>();
  for (const x of [...plan.creditUse, ...plan.cashApply])
    applied.set(
      x.invoiceId,
      round2((applied.get(x.invoiceId) ?? 0) + x.amount)
    );
  /** What a Payment cell shows. */
  const cellText = (id: string) =>
    typed
      ? (typed.get(id) ?? '')
      : ticked.has(id) && (applied.get(id) ?? 0) > 0
        ? applied.get(id)!.toFixed(2)
        : '';
  const isTicked = (id: string) =>
    typed
      ? typed.has(id) && (cellValue(typed.get(id)!) ?? 1) !== 0
      : ticked.has(id);

  const needsAccount = cash > 0;
  const nothingToDo = cash <= 0 && plan.creditUsed <= 0;
  const valid =
    amountValid &&
    badCells.length === 0 &&
    !nothingToDo &&
    (!needsAccount || !!account);

  const q = find.trim().toLowerCase();
  const visible = q
    ? invoices.filter((i) => (i.docNumber ?? i.id).toLowerCase().includes(q))
    : invoices;
  const visibleTicked = visible.filter((i) => isTicked(i.id)).length;

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
            ...(needsAccount && method ? { paymentMethodId: method } : {}),
            ...(needsAccount && memo.trim() ? { memo: memo.trim() } : {}),
            invoiceIds: typed
              ? allocations.map((a) => a.invoiceId)
              : invoices.filter((i) => ticked.has(i.id)).map((i) => i.id),
            ...(typed ? { allocations } : {}),
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

  /** The cells as they show now, to start typing from. */
  const snapshot = () =>
    new Map(
      invoices
        .filter((i) => cellText(i.id) !== '')
        .map((i) => [i.id, cellText(i.id)] as [string, string])
    );

  // Ticking a row pays it: oldest first from Amount received, or — once the
  // cells are typed — its whole open balance, as QuickBooks does.
  const tick = (ids: string[], on: boolean) => {
    if (typed) {
      setTyped((t) => {
        const n = new Map(t);
        for (const id of ids) {
          const v = n.get(id);
          const already = v !== undefined && (cellValue(v) ?? 1) !== 0;
          if (!on) n.delete(id);
          else if (!already) n.set(id, (balanceOf.get(id) ?? 0).toFixed(2));
        }
        return n;
      });
      return;
    }
    setTicked((t) => {
      const n = new Set(t);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  };

  const typeCell = (id: string, value: string) =>
    setTyped((t) => new Map(t ?? snapshot()).set(id, value));

  const typeAmount = (value: string) => {
    setAmount(value);
    if (typed) {
      // Back to oldest first, over the rows that are ticked now.
      setTicked(
        new Set(invoices.filter((i) => isTicked(i.id)).map((i) => i.id))
      );
      setTyped(null);
    }
  };

  // Laid out as QuickBooks' Receive Payment: Amount received and the customer
  // balance top right; Payment date / Reference no. / Payment method /
  // Deposit to / Amount received; Outstanding Transactions with a Payment
  // cell per invoice; then the Memo.
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
                  {formatSgd(cash)}
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_minmax(0,13rem)]">
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
                <Field className="sm:col-span-2 lg:col-span-1 lg:row-span-2">
                  <FieldLabel htmlFor="pay-amount">Amount received</FieldLabel>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    value={typed ? cash.toFixed(2) : amount}
                    onChange={(e) => typeAmount(e.target.value)}
                    placeholder={
                      mode === 'credit' ? '0.00 — credit only' : '0.00'
                    }
                    className="tabular-nums"
                  />
                  {typed && (
                    <FieldDescription>
                      The sum of the payments below. Type an amount to fill them
                      oldest first again.
                    </FieldDescription>
                  )}
                  {showErrors && !amountValid && (
                    <FieldError>Enter an amount of 0 or more.</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pay-method">Payment method</FieldLabel>
                  <Select
                    value={method}
                    onValueChange={setMethod}
                    disabled={!needsAccount || paymentMethods.length === 0}
                  >
                    <SelectTrigger id="pay-method" className="w-full">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentMethods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

              <section className="space-y-3">
                <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
                  Outstanding Transactions
                </h3>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is owing. The payment will be kept as credit.
                  </p>
                ) : (
                  <>
                    <div className="relative w-full max-w-60">
                      <Search
                        aria-hidden
                        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        aria-label="Find invoice no."
                        placeholder="Find invoice no."
                        value={find}
                        onChange={(e) => setFind(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead className="w-10">
                              <Checkbox
                                aria-label="Tick all"
                                disabled={visible.length === 0}
                                checked={
                                  visible.length > 0 &&
                                  visibleTicked === visible.length
                                    ? true
                                    : visibleTicked === 0
                                      ? false
                                      : 'indeterminate'
                                }
                                onCheckedChange={(v) =>
                                  tick(
                                    visible.map((i) => i.id),
                                    v === true
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
                            <TableHead className="text-right">
                              Payment
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visible.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={6}
                                className="py-6 text-center text-sm text-muted-foreground"
                              >
                                No invoice number matches “{find.trim()}”.
                              </TableCell>
                            </TableRow>
                          )}
                          {visible.map((i) => {
                            const on = isTicked(i.id);
                            const doc = i.docNumber ?? i.id;
                            const bad =
                              typed?.has(i.id) &&
                              cellBad(i.id, typed.get(i.id)!);
                            return (
                              <TableRow
                                key={i.id}
                                data-state={on ? 'selected' : undefined}
                              >
                                <TableCell>
                                  <Checkbox
                                    aria-label={`Pay ${doc}`}
                                    checked={on}
                                    onCheckedChange={(v) =>
                                      tick([i.id], v === true)
                                    }
                                  />
                                </TableCell>
                                <TableCell className="min-w-48">
                                  <span>
                                    Invoice #{' '}
                                    <span className="font-mono tabular-nums">
                                      {doc}
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
                                <TableCell className="text-right">
                                  <Input
                                    aria-label={`Payment for ${doc}`}
                                    aria-invalid={bad || undefined}
                                    inputMode="decimal"
                                    value={cellText(i.id)}
                                    onChange={(e) =>
                                      typeCell(i.id, e.target.value)
                                    }
                                    className="ml-auto h-8 w-32 text-right tabular-nums"
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
                {showErrors && badCells.length > 0 && (
                  <FieldError>
                    A payment can be from 0 up to that invoice&apos;s open
                    balance.
                  </FieldError>
                )}
                <p className="text-[12px] text-muted-foreground">
                  Ticked invoices are paid oldest first, up to the amount
                  received, or type the payment for each invoice. Untick all to
                  keep the money as credit on the customer.
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

              <Field className="max-w-md">
                <FieldLabel htmlFor="pay-memo">Memo</FieldLabel>
                <Input
                  id="pay-memo"
                  value={memo}
                  maxLength={PAYMENT_NOTE_MAX}
                  disabled={!needsAccount}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Note"
                />
                <FieldDescription>
                  Saved on the payment in QuickBooks, with who recorded it from
                  the SIS.
                </FieldDescription>
              </Field>
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
