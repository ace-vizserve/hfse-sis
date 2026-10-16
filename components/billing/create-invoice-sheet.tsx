'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
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
import { stageForAccount, type InvoiceLine } from '@/lib/billing/classify';
import {
  duplicateTileWarning,
  mapsFromData,
  todaySg,
  type MapsData,
} from '@/lib/billing/view';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
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
  docNumber: string | null;
  sentTo: string | null;
  warnings: string[];
};

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
  const items = useQuery({
    queryKey: ['qbo-items'],
    queryFn: () => apiFetch<{ items: Item[] }>('/api/quickbooks/items'),
    staleTime: 5 * 60 * 1000,
  });
  const [lines, setLines] = useState<Line[]>([
    { key: 1, itemId: '', description: '', qty: '1', unitPrice: '' },
  ]);
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [dueDate, setDueDate] = useState('');
  const [memo, setMemo] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [send, setSend] = useState(!!customerEmail);
  // One id per open: a retry of the same submit can't create it twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

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
    mutationFn: async () => {
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
        if (shouldRenewRequestId(err)) setRequestId(crypto.randomUUID());
        throw err;
      }
    },
  });
  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    await run(() => save.mutateAsync(), {
      pending: 'Creating the invoice in QuickBooks…',
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        const what = d.docNumber ? `Invoice ${d.docNumber}` : 'The invoice';
        return d.sentTo
          ? `${what} created and emailed to ${d.sentTo}`
          : `${what} created in QuickBooks`;
      },
      onResolved: () => onOpenChange(false),
    });
    setSaving(false);
  }

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
              Create invoice
            </SheetTitle>
            <SheetDescription>
              Created in QuickBooks first. Leave the number blank and QuickBooks
              picks the next one.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              {warning && (
                <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-4">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                    <AlertTriangle className="size-4" />
                  </div>
                  <p className="text-sm text-ink">{warning}</p>
                </div>
              )}

              <Field>
                <FieldLabel>Lines</FieldLabel>
                {items.isError && (
                  <FieldError>{(items.error as Error).message}</FieldError>
                )}
                <div className="space-y-3">
                  {lines.map((l) => (
                    <div
                      key={l.key}
                      className="space-y-2 rounded-md border border-border p-3"
                    >
                      <div className="flex items-start gap-2">
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
                          <SelectTrigger className="w-full" aria-label="Item">
                            <SelectValue
                              placeholder={
                                items.isLoading
                                  ? 'Loading items…'
                                  : 'Choose an item'
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
                        {lines.length > 1 && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label="Remove line"
                            onClick={() =>
                              setLines((ls) =>
                                ls.filter((x) => x.key !== l.key)
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                      <Input
                        value={l.description}
                        onChange={(e) =>
                          setLine(l.key, { description: e.target.value })
                        }
                        placeholder="Description (optional)"
                        aria-label="Description"
                      />
                      <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
                        <Input
                          inputMode="decimal"
                          value={l.qty}
                          onChange={(e) =>
                            setLine(l.key, { qty: e.target.value })
                          }
                          aria-label="Quantity"
                          className="tabular-nums"
                        />
                        <Input
                          inputMode="decimal"
                          value={l.unitPrice}
                          onChange={(e) =>
                            setLine(l.key, { unitPrice: e.target.value })
                          }
                          placeholder="Price"
                          aria-label="Price"
                          className="tabular-nums"
                        />
                        <span className="min-w-24 text-right text-sm tabular-nums text-foreground">
                          {l.qty.trim() !== '' &&
                          Number(l.qty) > 0 &&
                          Number(l.unitPrice) >= 0 &&
                          l.unitPrice.trim() !== ''
                            ? formatSgd(
                                Math.round(
                                  Number(l.qty) * Number(l.unitPrice) * 100
                                ) / 100
                              )
                            : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setLines((ls) => [
                        ...ls,
                        {
                          key: Math.max(...ls.map((x) => x.key)) + 1,
                          itemId: '',
                          description: '',
                          qty: '1',
                          unitPrice: '',
                        },
                      ])
                    }
                  >
                    <Plus className="size-3.5" />
                    Add line
                  </Button>
                  <p className="text-sm text-foreground">
                    Total before GST{' '}
                    <span className="font-semibold tabular-nums">
                      {formatSgd(total)}
                    </span>
                  </p>
                </div>
                <FieldDescription>
                  GST follows each item&rsquo;s tax code in QuickBooks; the
                  invoice page shows the GST QuickBooks worked out.
                </FieldDescription>
                {showErrors && !linesValid && (
                  <FieldError>
                    Each line needs an item, a quantity above 0 and a price.
                  </FieldError>
                )}
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
                <FieldDescription>
                  Type your own, e.g. HFSE062240, or leave blank.
                </FieldDescription>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="bill-txn-date">Invoice date</FieldLabel>
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
                    placeholder="Usual terms"
                  />
                  <FieldDescription>
                    Blank uses QuickBooks’ usual terms.
                  </FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="bill-memo">
                  Message to the parents
                </FieldLabel>
                <Input
                  id="bill-memo"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
                <FieldDescription>Shown on the invoice.</FieldDescription>
              </Field>

              <Field orientation="horizontal">
                <Checkbox
                  id="bill-send"
                  checked={send}
                  disabled={!customerEmail}
                  onCheckedChange={(v) => setSend(v === true)}
                />
                <FieldLabel htmlFor="bill-send" className="font-normal">
                  {customerEmail
                    ? `Email it now to ${customerEmail}`
                    : 'Email it now — the QuickBooks customer has no email'}
                </FieldLabel>
              </Field>
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
              Create in QuickBooks
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
