'use client';

import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { SheetFields, SheetSection } from '@/components/billing/sheet-section';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Field,
  FieldDescription,
  FieldError,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  PAY_ACCOUNT_REQUIRED,
  PURCHASE_NAME,
  type PurchaseKind,
} from '@/lib/billing/refund-expense-body';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import { todaySg } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Paying a credit back, step 1 (QuickBooks' help): an Expense or Cheque with
// the customer as Payee, its Category line on Accounts Receivable. Only the
// fields this needs, by QuickBooks' names: Payee, Payment account / Bank
// account, Payment date, Payment method / Ref no. (Expense) or Cheque no.,
// the one Category line, Memo. Step 2 is Receive payment.
const WORDS: Record<PurchaseKind, { account: string; ref: string }> = {
  expense: { account: 'Payment account', ref: 'Ref no.' },
  check: { account: 'Bank account', ref: 'Cheque no.' },
};

export function RefundExpenseSheet({
  open,
  onOpenChange,
  kind,
  studentNumber,
  studentName,
  bankAccounts,
  paymentMethods = [],
  credit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: PurchaseKind;
  studentNumber: string;
  studentName: string;
  bankAccounts: Array<{ id: string; label: string }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  /** The customer's unused credit: what is usually paid back. */
  credit: number;
}) {
  const run = useWriteAction();
  const name = PURCHASE_NAME[kind];
  const words = WORDS[kind];
  const [account, setAccount] = useState('');
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [method, setMethod] = useState('');
  const [refNo, setRefNo] = useState('');
  const [amount, setAmount] = useState(credit > 0 ? credit.toFixed(2) : '');
  const [description, setDescription] = useState('');
  const [memo, setMemo] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const unclearRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const n = Number(amount);
  const amountOk = amount.trim() !== '' && Number.isFinite(n) && n > 0;
  const valid = !!account && amountOk;

  const save = useMutation({
    mutationFn: async () => {
      try {
        return await apiFetch<{ docNumber: string | null; warnings: string[] }>(
          `/api/billing/students/${encodeURIComponent(studentNumber)}/refund-expenses`,
          jsonInit('POST', {
            kind,
            accountId: account,
            txnDate,
            ...(kind === 'expense' && method
              ? { paymentMethodId: method }
              : {}),
            ...(refNo.trim() ? { refNo: refNo.trim() } : {}),
            amount: Math.round(n * 100) / 100,
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(memo.trim() ? { memo: memo.trim() } : {}),
            requestId,
          })
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
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: `Saving the ${name.toLowerCase()} in QuickBooks…`,
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        toast.message(
          `Next: Receive payment — tick this ${name.toLowerCase()} and the credit, with Amount received 0.00.`
        );
        return `${name}${d.docNumber ? ` ${d.docNumber}` : ''} of ${formatSgd(Math.round(n * 100) / 100)} saved in QuickBooks`;
      },
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {studentName}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              {name}
            </SheetTitle>
            <SheetDescription>
              Pays {studentName}&rsquo;s credit back from a bank account,
              recorded in QuickBooks on Accounts Receivable. Then use Receive
              payment to tick it with the credit, so they net to 0.00.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <SheetSection title={`${name} details`}>
              <SheetFields>
                <Field>
                  <FieldLabel htmlFor="exp-payee">Payee</FieldLabel>
                  <Input id="exp-payee" value={studentName} readOnly disabled />
                </Field>
                <Field>
                  <FieldLabel htmlFor="exp-account">
                    {words.account} <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Select value={account} onValueChange={setAccount}>
                    <SelectTrigger id="exp-account" className="w-full">
                      <SelectValue placeholder="Choose an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showErrors && !account && (
                    <FieldError>{PAY_ACCOUNT_REQUIRED}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="exp-date">
                    Payment date <span className="text-destructive">*</span>
                  </FieldLabel>
                  <DatePicker
                    id="exp-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
                {kind === 'expense' && (
                  <Field>
                    <FieldLabel htmlFor="exp-method">Payment method</FieldLabel>
                    <Select
                      value={method}
                      onValueChange={setMethod}
                      disabled={paymentMethods.length === 0}
                    >
                      <SelectTrigger id="exp-method" className="w-full">
                        <SelectValue placeholder="Choose payment method" />
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
                )}
                <Field>
                  <FieldLabel htmlFor="exp-ref">{words.ref}</FieldLabel>
                  <Input
                    id="exp-ref"
                    value={refNo}
                    maxLength={21}
                    onChange={(e) => setRefNo(e.target.value)}
                    className="font-mono"
                  />
                </Field>
              </SheetFields>
            </SheetSection>

            <SheetSection title="Category details">
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table className="[&_td]:px-3 [&_th]:px-3">
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-32 text-right">
                        Amount <span className="text-destructive">*</span>
                      </TableHead>
                      <TableHead>Customer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="align-top">
                      <TableCell className="pt-4 tabular-nums text-muted-foreground">
                        1
                      </TableCell>
                      <TableCell className="whitespace-nowrap pt-4">
                        Accounts Receivable (A/R)
                      </TableCell>
                      <TableCell className="min-w-48">
                        <Input
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Description"
                          aria-label="Description"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          aria-label="Amount"
                          aria-invalid={(showErrors && !amountOk) || undefined}
                          className="ml-auto w-28 text-right tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap pt-4">
                        {studentName}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              {showErrors && !amountOk && (
                <FieldError>Enter an amount above 0.</FieldError>
              )}
              <p className="text-[12px] text-muted-foreground">
                {credit > 0
                  ? `Unused credit on ${studentName}: ${formatSgd(credit)}.`
                  : `${studentName} has no unused credit just now.`}
              </p>
            </SheetSection>

            <SheetSection title="Memo">
              <Field>
                <FieldLabel htmlFor="exp-memo" className="sr-only">
                  Memo
                </FieldLabel>
                <Textarea
                  id="exp-memo"
                  value={memo}
                  maxLength={4000}
                  rows={3}
                  onChange={(e) => setMemo(e.target.value)}
                />
                <FieldDescription>
                  Saved on the {name.toLowerCase()} in QuickBooks.
                </FieldDescription>
              </Field>
            </SheetSection>

            <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
              <dt className="font-serif text-base font-semibold text-foreground">
                Total
              </dt>
              <dd className="text-right font-serif text-base font-semibold tabular-nums">
                {formatSgd(amountOk ? Math.round(n * 100) / 100 : 0)}
              </dd>
            </dl>
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
              loadingText="Saving in QuickBooks…"
              disabled={saving}
            >
              Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
