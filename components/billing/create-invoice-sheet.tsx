'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { FieldError } from '@/components/ui/field';
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
  SheetTitle,
} from '@/components/ui/sheet';
import { stageForAccount, type InvoiceLine } from '@/lib/billing/classify';
import { clearInvoiceCopy, readInvoiceCopy } from '@/lib/billing/invoice-copy';
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
import { cn } from '@/lib/utils';

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

/** A label over its control, as QuickBooks' invoice form sets them. */
function Labelled({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// Create invoice, laid out as QuickBooks' new-invoice screen (Mr Ace,
// 2026-10-19: "use QB as reference"): the invoice head (INVOICE, Balance
// due), the customer band (customer and email | Invoice no., Invoice date,
// Due date), the Product or service lines with Add product or service / Clear
// all lines, Note to customer beside the totals, and QuickBooks' footer bar —
// Cancel | Save and close, Save and send. The customer is always the
// student's linked QuickBooks customer.
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-none lg:w-[min(1280px,96vw)]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Title bar, as QuickBooks: the form's name and close. */}
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border pl-4 pr-14 sm:pl-6">
            <SheetTitle className="font-serif text-[22px] font-semibold tracking-tight">
              Invoice
            </SheetTitle>
            <SheetDescription className="truncate text-sm">
              New, for {studentName} — created in QuickBooks
            </SheetDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/50 p-3 sm:p-6">
            <article className="mx-auto max-w-360 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              {/* INVOICE and Balance due. */}
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-8">
                <h2 className="font-serif text-[32px] font-semibold leading-none tracking-tight text-brand-indigo">
                  INVOICE
                </h2>
                <div className="text-right">
                  <p className="text-[13px] text-muted-foreground">
                    Balance due
                  </p>
                  <p className="font-serif text-[26px] font-semibold leading-tight tabular-nums text-foreground">
                    {formatSgd(total)}
                  </p>
                </div>
              </div>

              {/* Customer | Invoice no., Invoice date, Due date. */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 bg-accent/50 px-5 py-5 sm:px-8 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
                <div className="space-y-3">
                  <Labelled label="Customer">
                    <div className="flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-input">
                      <span className="truncate">{studentName}</span>
                    </div>
                  </Labelled>
                  <Labelled label="Customer email">
                    <div className="flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-input">
                      {customerEmail ? (
                        <span className="truncate">{customerEmail}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          None in QuickBooks
                        </span>
                      )}
                    </div>
                  </Labelled>
                </div>
                <div className="space-y-3">
                  <Labelled label="Invoice no." htmlFor="bill-doc-number">
                    <Input
                      id="bill-doc-number"
                      value={docNumber}
                      maxLength={21}
                      onChange={(e) => setDocNumber(e.target.value)}
                      placeholder="QuickBooks’ next number"
                      className="bg-card tabular-nums"
                    />
                  </Labelled>
                  <Labelled label="Invoice date" htmlFor="bill-txn-date">
                    <DatePicker
                      id="bill-txn-date"
                      value={txnDate}
                      onChange={(d) => setTxnDate(d || todaySg())}
                      allowClear={false}
                    />
                  </Labelled>
                  <Labelled label="Due date" htmlFor="bill-due-date">
                    <DatePicker
                      id="bill-due-date"
                      value={dueDate}
                      onChange={setDueDate}
                      placeholder="The customer’s terms"
                    />
                  </Labelled>
                </div>
              </div>

              {warning && (
                <div className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-4 sm:mx-8">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                    <AlertTriangle className="size-4" />
                  </div>
                  <p className="text-sm text-ink">{warning}</p>
                </div>
              )}

              {/* Product or service. */}
              <div className="px-5 pt-6 sm:px-8">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-serif text-base font-semibold text-foreground">
                    Product or service
                  </h3>
                  {copiedFrom && (
                    <p className="text-[13px] text-muted-foreground">
                      Copied from invoice {copiedFrom}
                    </p>
                  )}
                </div>
                {items.isError && (
                  <FieldError className="mt-2">
                    {(items.error as Error).message}
                  </FieldError>
                )}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[13px] text-muted-foreground">
                        <th className="w-8 py-2 pr-2 font-medium">#</th>
                        <th className="w-[30%] py-2 pr-2 font-medium">
                          Product/service
                        </th>
                        <th className="py-2 pr-2 font-medium">Description</th>
                        <th className="w-20 py-2 pr-2 text-right font-medium">
                          Qty
                        </th>
                        <th className="w-32 py-2 pr-2 text-right font-medium">
                          Rate
                        </th>
                        <th className="w-32 py-2 pr-2 text-right font-medium">
                          Amount
                        </th>
                        <th className="w-10 py-2" aria-label="Delete" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr
                          key={l.key}
                          className="border-b border-border align-middle"
                        >
                          <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="py-2 pr-2">
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
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              value={l.description}
                              onChange={(e) =>
                                setLine(l.key, { description: e.target.value })
                              }
                              aria-label={`Description, line ${i + 1}`}
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              inputMode="decimal"
                              value={l.qty}
                              onChange={(e) =>
                                setLine(l.key, { qty: e.target.value })
                              }
                              aria-label={`Qty, line ${i + 1}`}
                              className="text-right tabular-nums"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              inputMode="decimal"
                              value={l.unitPrice}
                              onChange={(e) =>
                                setLine(l.key, { unitPrice: e.target.value })
                              }
                              aria-label={`Rate, line ${i + 1}`}
                              className="text-right tabular-nums"
                            />
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums text-foreground">
                            {amountOf(l)}
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setLines((ls) => [...ls, emptyLine(nextKey())])
                    }
                  >
                    <Plus className="size-3.5" />
                    Add product or service
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setLines([emptyLine(nextKey())])}
                  >
                    Clear all lines
                  </Button>
                </div>
                {showErrors && !linesValid && (
                  <FieldError className="mt-2">
                    Each line needs a product or service, a quantity above 0 and
                    a rate.
                  </FieldError>
                )}
              </div>

              {/* Note to customer left, totals right. */}
              <div className="mt-6 grid grid-cols-1 gap-8 border-t border-border px-5 py-6 sm:px-8 md:grid-cols-[minmax(0,1fr)_340px]">
                <Labelled
                  label="Note to customer"
                  htmlFor="bill-memo"
                  className="max-w-md"
                >
                  {/* Plain text: QuickBooks prints the note as typed. */}
                  <Input
                    id="bill-memo"
                    value={memo}
                    maxLength={1000}
                    onChange={(e) => setMemo(e.target.value)}
                    className="bg-card"
                  />
                </Labelled>
                <dl className="grid h-fit grid-cols-[1fr_auto] gap-x-8 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="text-right tabular-nums">
                    {formatSgd(total)}
                  </dd>
                  <dt className="text-muted-foreground">GST</dt>
                  <dd className="text-right text-muted-foreground">
                    By each item&rsquo;s tax code
                  </dd>
                  <dt className="border-t border-border pt-2 font-serif text-base font-semibold text-foreground">
                    Total before GST
                  </dt>
                  <dd className="border-t border-border pt-2 text-right font-serif text-base font-semibold tabular-nums">
                    {formatSgd(total)}
                  </dd>
                </dl>
              </div>
            </article>
          </div>

          {/* Footer bar, as QuickBooks: Cancel | Save and close, Save and send. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-4 py-3 sm:px-6">
            <SheetClose asChild>
              <Button type="button" variant="ghost" disabled={!!saving}>
                Cancel
              </Button>
            </SheetClose>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="outline"
                loading={saving === 'close'}
                loadingText="Saving in QuickBooks…"
                disabled={!!saving}
              >
                Save and close
              </Button>
              <Button
                type="button"
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
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
