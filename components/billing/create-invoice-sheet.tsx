'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { stageForAccount, type InvoiceLine } from '@/lib/billing/classify';
import { clearInvoiceCopy, readInvoiceCopy } from '@/lib/billing/invoice-copy';
import { INVOICE_NOTE_MAX } from '@/lib/billing/invoice-create-body';
import {
  duplicateTileWarning,
  mapsFromData,
  todaySg,
  type MapsData,
} from '@/lib/billing/view';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Item = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: number | null;
  accountId: string | null;
  accountName: string | null;
};
type Line = {
  key: number;
  itemId: string;
  description: string;
  qty: string;
  unitPrice: string;
};
type Result = {
  qboInvoiceId: string;
  docNumber: string | null;
  sentTo: string | null;
  warnings: string[];
};

const emptyLine = (key: number): Line => ({
  key,
  itemId: '',
  description: '',
  qty: '1',
  unitPrice: '',
});

// Create invoice: QuickBooks' new-invoice fields (Mr Ace, 2026-10-19: "use
// QB as reference") in the SIS sheet ("we always use SIS layout") — Customer
// email, Invoice no., Invoice date, Due date; the product or service lines
// with Add line / Clear all; Note to customer; Memo on statement; the
// totals; Cancel, Save and
// send, Create invoice. The customer is always the student's linked
// QuickBooks customer.
export function CreateInvoiceSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  customerEmail,
  maps,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  /** The QuickBooks customer's email, if it has one. */
  customerEmail: string | null;
  maps: MapsData;
  /** The customer's invoices as stored, for the duplicate-tile note. */
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
}) {
  const run = useWriteAction();
  const router = useRouter();
  const items = useQuery({
    queryKey: ['qbo-items'],
    queryFn: () => apiFetch<{ items: Item[] }>('/api/quickbooks/items'),
    staleTime: 5 * 60 * 1000,
  });
  // Make a copy (the invoice page's More actions): its lines and note start
  // the form, once — the stored copy is cleared after the form has it.
  const [copy] = useState(() => readInvoiceCopy(studentNumber));
  useEffect(() => clearInvoiceCopy(studentNumber), [studentNumber]);
  const [lines, setLines] = useState<Line[]>(() =>
    copy
      ? copy.lines.map((l, i) => ({
          key: i + 1,
          itemId: l.itemId,
          description: l.description,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
        }))
      : [emptyLine(1)]
  );
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState(copy?.memo ?? '');
  const [statementMemo, setStatementMemo] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const copiedFrom = copy ? (copy.from ?? 'an invoice') : null;
  // One id per open: a retry of the same submit can't create it twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // Kept once an attempt was unclear: see shouldRenewAfter.
  const unclearRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<null | 'close' | 'send'>(null);

  const parsed = lines.map((l) => ({
    ...l,
    q: Number(l.qty),
    p: Number(l.unitPrice),
  }));
  const linesValid = parsed.every(
    (l) =>
      l.itemId &&
      l.qty.trim() !== '' &&
      l.q > 0 &&
      l.unitPrice.trim() !== '' &&
      l.p >= 0
  );
  const total = parsed.reduce(
    (s, l) =>
      s +
      (l.qty.trim() !== '' && l.unitPrice.trim() !== '' && l.q > 0 && l.p >= 0
        ? Math.round(l.q * l.p * 100) / 100
        : 0),
    0
  );
  const valid = linesValid && /^\d{4}-\d{2}-\d{2}$/.test(txnDate);

  // Which tile (and year) the chosen items would put this invoice on, and
  // whether that tile already has a live invoice for the year.
  const warning = useMemo(() => {
    const byId = new Map((items.data?.items ?? []).map((i) => [i.id, i]));
    const asLines: InvoiceLine[] = lines
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        itemName: byId.get(l.itemId)?.name ?? null,
        accountId: byId.get(l.itemId)?.accountId ?? null,
        description: null,
        qty: Number(l.qty) || null,
        amount: 0,
      }));
    if (asLines.length === 0) return null;
    // An item the SIS hasn't cached yet is placed by its account's name.
    const m = mapsFromData(maps);
    for (const i of byId.values())
      if (i.accountId && !m.accounts.has(i.accountId))
        m.accounts.set(i.accountId, stageForAccount(i.accountName));
    return duplicateTileWarning({
      lines: asLines,
      txnDate,
      maps: m,
      studentNumber,
      existing,
    });
  }, [items.data, lines, txnDate, maps, studentNumber, existing]);

  const save = useMutation({
    mutationFn: async (send: boolean) => {
      try {
        return await apiFetch<Result>(
          `/api/billing/students/${encodeURIComponent(studentNumber)}/invoices`,
          jsonInit('POST', {
            lines: parsed.map((l) => ({
              itemId: l.itemId,
              ...(l.description.trim()
                ? { description: l.description.trim() }
                : {}),
              qty: l.q,
              unitPrice: l.p,
            })),
            txnDate,
            dueDate: dueDate || null,
            ...(memo.trim() ? { memo: memo.trim() } : {}),
            ...(statementMemo.trim()
              ? { statementMemo: statementMemo.trim() }
              : {}),
            ...(docNumber.trim() ? { docNumber: docNumber.trim() } : {}),
            send,
            requestId,
          })
        );
      } catch (err) {
        // Our route answered with its own error: nothing was created, so the
        // next submit is a new one. A `keepRequestId` answer (QuickBooks
        // didn't answer the create) and anything else (lost response,
        // timeout) keep the id, so a retry is de-duplicated by QuickBooks.
        if (shouldRenewAfter(err, unclearRef))
          setRequestId(crypto.randomUUID());
        throw err;
      }
    },
  });
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const nextKey = () => Math.max(0, ...lines.map((x) => x.key)) + 1;

  async function submit(send: boolean) {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(send ? 'send' : 'close');
    await run(() => save.mutateAsync(send), {
      pending: send
        ? 'Creating the invoice in QuickBooks and emailing it…'
        : 'Creating the invoice in QuickBooks…',
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        const what = d.docNumber ? `Invoice ${d.docNumber}` : 'The invoice';
        return d.sentTo
          ? `${what} created and emailed to ${d.sentTo}`
          : `${what} created in QuickBooks`;
      },
      // Open the new invoice; its page reads QuickBooks fresh, so no refresh.
      onResolved: (d) => {
        onOpenChange(false);
        router.push(
          `/billing/${encodeURIComponent(studentNumber)}/invoices/${encodeURIComponent(d.qboInvoiceId)}`
        );
      },
      refresh: false,
    });
    setSaving(null);
  }

  const amountOf = (l: Line) =>
    l.qty.trim() !== '' &&
    Number(l.qty) > 0 &&
    Number(l.unitPrice) >= 0 &&
    l.unitPrice.trim() !== ''
      ? formatSgd(Math.round(Number(l.qty) * Number(l.unitPrice) * 100) / 100)
      : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {studentName}
            </p>
            <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
              Create invoice
            </SheetTitle>
            <SheetDescription>
              {copiedFrom
                ? `A new invoice for ${studentName}, copied from invoice ${copiedFrom} and created in QuickBooks.`
                : `A new invoice for ${studentName}, created in QuickBooks.`}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <SheetSection title="Invoice details">
              <SheetFields>
                <Field>
                  <FieldLabel htmlFor="bill-email">Customer email</FieldLabel>
                  <Input
                    id="bill-email"
                    value={customerEmail ?? ''}
                    placeholder="None in QuickBooks"
                    readOnly
                    disabled
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bill-doc-number">Invoice no.</FieldLabel>
                  <Input
                    id="bill-doc-number"
                    value={docNumber}
                    maxLength={21}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="QuickBooks’ next number"
                    className="font-mono tabular-nums"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bill-txn-date">
                    Invoice date <span className="text-destructive">*</span>
                  </FieldLabel>
                  <DatePicker
                    id="bill-txn-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bill-due-date">Due date</FieldLabel>
                  <DatePicker
                    id="bill-due-date"
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="The customer’s terms"
                  />
                </Field>
              </SheetFields>

              {warning && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-4">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                    <AlertTriangle className="size-4" />
                  </div>
                  <p className="text-sm text-ink">{warning}</p>
                </div>
              )}
            </SheetSection>

            {/* The lines: product or service (with its description), qty,
                rate, amount. */}
            <SheetSection
              title="Products and services"
              aside={
                <p className="text-[12px] text-muted-foreground">
                  {lines.length === 1 ? '1 line' : `${lines.length} lines`}
                </p>
              }
            >
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {items.isError && (
                  <FieldError className="px-4 pt-3">
                    {(items.error as Error).message}
                  </FieldError>
                )}
                <div className="overflow-x-auto">
                  <Table className="[&_td]:px-3 [&_th]:px-3">
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="w-8">#</TableHead>
                        <TableHead className="w-full">
                          Product or service{' '}
                          <span className="text-destructive">*</span>
                        </TableHead>
                        <TableHead className="w-20 text-right">
                          Qty <span className="text-destructive">*</span>
                        </TableHead>
                        <TableHead className="w-28 text-right">Rate</TableHead>
                        <TableHead className="w-28 text-right">
                          Amount
                        </TableHead>
                        <TableHead className="w-12">
                          <span className="sr-only">Delete</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((l, i) => (
                        <TableRow key={l.key} className="align-top">
                          <TableCell className="pt-4 tabular-nums text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell className="min-w-56 space-y-2 whitespace-normal">
                            <Select
                              value={l.itemId}
                              onValueChange={(id) => {
                                const it = items.data?.items.find(
                                  (x) => x.id === id
                                );
                                const prev = items.data?.items.find(
                                  (x) => x.id === l.itemId
                                );
                                const untouched =
                                  !l.description ||
                                  l.description === (prev?.description ?? '');
                                setLine(l.key, {
                                  itemId: id,
                                  unitPrice:
                                    it?.unitPrice != null
                                      ? String(it.unitPrice)
                                      : '',
                                  description: untouched
                                    ? (it?.description ?? '')
                                    : l.description,
                                });
                              }}
                            >
                              <SelectTrigger
                                className="w-full"
                                aria-label={`Product or service, line ${i + 1}`}
                              >
                                <SelectValue
                                  placeholder={
                                    items.isLoading
                                      ? 'Loading products…'
                                      : 'Choose a product or service'
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {(items.data?.items ?? []).map((it) => (
                                  <SelectItem key={it.id} value={it.id}>
                                    {it.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={l.description}
                              onChange={(e) =>
                                setLine(l.key, { description: e.target.value })
                              }
                              placeholder="Description"
                              aria-label={`Description, line ${i + 1}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              inputMode="decimal"
                              value={l.qty}
                              onChange={(e) =>
                                setLine(l.key, { qty: e.target.value })
                              }
                              aria-label={`Qty, line ${i + 1}`}
                              className="ml-auto w-16 text-right tabular-nums"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              inputMode="decimal"
                              value={l.unitPrice}
                              onChange={(e) =>
                                setLine(l.key, { unitPrice: e.target.value })
                              }
                              aria-label={`Rate, line ${i + 1}`}
                              className="ml-auto w-28 text-right tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="pt-4 text-right tabular-nums text-foreground">
                            {amountOf(l)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="size-8"
                              aria-label={`Delete line ${i + 1}`}
                              disabled={lines.length === 1}
                              onClick={() =>
                                setLines((ls) =>
                                  ls.filter((x) => x.key !== l.key)
                                )
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setLines((ls) => [...ls, emptyLine(nextKey())])
                    }
                  >
                    <Plus className="size-3.5" />
                    Add line
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setLines([emptyLine(nextKey())])}
                  >
                    Clear all
                  </Button>
                </div>
              </div>
              {showErrors && !linesValid && (
                <FieldError>
                  Each line needs a product or service, a quantity above 0 and a
                  rate.
                </FieldError>
              )}
            </SheetSection>

            <SheetSection title="Note to customer">
              <Field>
                <FieldLabel htmlFor="bill-memo" className="sr-only">
                  Note to customer
                </FieldLabel>
                {/* Plain text: QuickBooks prints the note as typed. */}
                <Input
                  id="bill-memo"
                  value={memo}
                  maxLength={1000}
                  onChange={(e) => setMemo(e.target.value)}
                />
                <FieldDescription>
                  Printed on the invoice the customer receives.
                </FieldDescription>
              </Field>
            </SheetSection>

            {/* QuickBooks' "Memo on statement (hidden)", under Note to
                customer: the invoice's PrivateNote. */}
            <SheetSection title="Memo on statement">
              <Field>
                <FieldLabel htmlFor="bill-statement-memo" className="sr-only">
                  Memo on statement
                </FieldLabel>
                <Textarea
                  id="bill-statement-memo"
                  value={statementMemo}
                  maxLength={INVOICE_NOTE_MAX}
                  rows={3}
                  onChange={(e) => setStatementMemo(e.target.value)}
                />
                <FieldDescription>
                  Not printed on the invoice &mdash; the customer doesn&rsquo;t
                  see it.
                </FieldDescription>
              </Field>
            </SheetSection>

            <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right tabular-nums">{formatSgd(total)}</dd>
              <dt className="text-muted-foreground">GST</dt>
              <dd className="text-right text-muted-foreground">
                By each item&rsquo;s tax code
              </dd>
              <dt className="border-t border-border pt-2 whitespace-nowrap font-serif text-base font-semibold text-foreground">
                Total before GST
              </dt>
              <dd className="border-t border-border pt-2 text-right font-serif text-base font-semibold tabular-nums">
                {formatSgd(total)}
              </dd>
            </dl>
          </div>

          <SheetFooter className="shrink-0 flex-row flex-wrap justify-end gap-2 border-t border-border bg-background px-6 py-4">
            <SheetClose asChild>
              <Button type="button" variant="outline" disabled={!!saving}>
                Cancel
              </Button>
            </SheetClose>
            <Button
              type="button"
              variant="outline"
              loading={saving === 'send'}
              loadingText="Saving and sending…"
              disabled={!!saving || !customerEmail}
              title={
                customerEmail
                  ? `Creates it and emails it to ${customerEmail}`
                  : 'The QuickBooks customer has no email to send to.'
              }
              onClick={() => void submit(true)}
            >
              Save and send
            </Button>
            <Button
              type="submit"
              loading={saving === 'close'}
              loadingText="Creating in QuickBooks…"
              disabled={!!saving}
            >
              Create invoice
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
