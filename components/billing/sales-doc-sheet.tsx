'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  emptyProductLine,
  productLinesBody,
  productLinesTotal,
  productLinesValid,
  ProductLinesEditor,
  useProductItems,
  type ProductLine,
} from '@/components/billing/product-lines-editor';
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
import { Textarea } from '@/components/ui/textarea';
import {
  REFUND_FROM_REQUIRED,
  SALES_DOC_NAME,
  SALES_DOC_NOTE_MAX,
  SALES_DOC_SEGMENT,
  type SalesDocKind,
} from '@/lib/billing/sales-doc-body';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import { todaySg } from '@/lib/billing/view';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

/** A credit memo started from an invoice (QuickBooks' "Create a credit
 *  memo"): its lines and statement message. */
export type SalesDocStart = {
  from: string | null;
  lines: Array<{
    itemId: string;
    itemName?: string | null;
    description: string;
    qty: number;
    unitPrice: number;
  }>;
  statementMessage: string | null;
};

// QuickBooks' own words per form (sandbox capture 2026-10-21).
const WORDS: Record<
  SalesDocKind,
  { no: string; date: string; message: string; total: string }
> = {
  refund_receipt: {
    no: 'Refund Receipt no.',
    date: 'Refund Receipt date',
    message: 'Message displayed on refund receipt',
    total: 'Total amount refunded',
  },
  credit_memo: {
    no: 'Credit Note no.',
    date: 'Credit Note date',
    message: 'Message displayed on credit note',
    total: 'Total credit',
  },
};

// Refund receipt and Credit memo: QuickBooks' forms (their fields, in their
// order) in the SIS sheet, with Create invoice's product lines. The customer
// is always the student's linked QuickBooks customer.
export function SalesDocSheet({
  open,
  onOpenChange,
  kind,
  studentNumber,
  studentName,
  customerEmail,
  bankAccounts = [],
  paymentMethods = [],
  start = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: SalesDocKind;
  studentNumber: string;
  studentName: string;
  customerEmail: string | null;
  /** Refund From: QuickBooks' Bank accounts, read live. */
  bankAccounts?: Array<{ id: string; label: string; isDefault?: boolean }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  start?: SalesDocStart | null;
}) {
  const run = useWriteAction();
  const router = useRouter();
  const refund = kind === 'refund_receipt';
  const words = WORDS[kind];
  const name = SALES_DOC_NAME[kind];
  const items = useProductItems(open);
  const [lines, setLines] = useState<ProductLine[]>(() =>
    start?.lines.length
      ? start.lines.map((l, i) => ({
          key: i + 1,
          itemId: l.itemId,
          description: l.description,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
        }))
      : [emptyProductLine(1), emptyProductLine(2)]
  );
  const knownNames = useMemo(
    () =>
      new Map(
        (start?.lines ?? []).flatMap((l) =>
          l.itemName ? [[l.itemId, l.itemName] as const] : []
        )
      ),
    [start]
  );
  const [txnDate, setTxnDate] = useState(() => todaySg());
  const [docNumber, setDocNumber] = useState('');
  const [method, setMethod] = useState('');
  const [refundFrom, setRefundFrom] = useState('');
  const [checkNo, setCheckNo] = useState('');
  const [message, setMessage] = useState('');
  const [statementMessage, setStatementMessage] = useState(
    start?.statementMessage ?? ''
  );
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const unclearRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  // QuickBooks' form starts with two empty lines; a line with nothing
  // picked and nothing typed is left out, as QuickBooks leaves it out.
  const used = lines.filter(
    (l) => l.itemId || l.description.trim() || l.unitPrice.trim()
  );
  const total = productLinesTotal(used);
  const linesOk = used.length > 0 && productLinesValid(used);
  const valid =
    linesOk &&
    total > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(txnDate) &&
    (!refund || !!refundFrom);

  const save = useMutation({
    mutationFn: async () => {
      try {
        return await apiFetch<{
          id: string;
          docNumber: string | null;
          warnings: string[];
          appliedTo?: string[];
        }>(
          `/api/billing/students/${encodeURIComponent(studentNumber)}/sales-docs`,
          jsonInit('POST', {
            kind,
            // New lines carry no QuickBooks line id.
            lines: productLinesBody(used),
            txnDate,
            ...(docNumber.trim() ? { docNumber: docNumber.trim() } : {}),
            ...(message.trim() ? { message: message.trim() } : {}),
            ...(statementMessage.trim()
              ? { statementMessage: statementMessage.trim() }
              : {}),
            ...(refund
              ? {
                  refundFromId: refundFrom,
                  ...(method ? { paymentMethodId: method } : {}),
                  ...(checkNo.trim() ? { checkNo: checkNo.trim() } : {}),
                }
              : {}),
            requestId,
          })
        );
      } catch (err) {
        // Renew only when our route said nothing was written.
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
      pending: `Creating the ${name.toLowerCase()} in QuickBooks…`,
      success: (d) => {
        for (const w of d.warnings) toast.warning(w);
        // QuickBooks' "Automatically apply credits" put it on invoices.
        if (d.appliedTo?.length)
          toast.message(
            `Applied to invoice ${d.appliedTo.join(', ')}, as QuickBooks' "Automatically apply credits" setting does.`
          );
        return `${name}${d.docNumber ? ` ${d.docNumber}` : ''} created in QuickBooks`;
      },
      // Open it; its page reads QuickBooks fresh.
      onResolved: (d) => {
        onOpenChange(false);
        router.push(
          `/billing/${encodeURIComponent(studentNumber)}/${SALES_DOC_SEGMENT[kind]}/${encodeURIComponent(d.id)}`
        );
      },
      refresh: false,
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
              {refund
                ? `Money paid back to ${studentName} for the products below, recorded in QuickBooks as leaving the account you pick.`
                : start?.from
                  ? `A credit for ${studentName}, from invoice ${start.from}. It lowers what they owe in QuickBooks until it is used on an invoice or paid back.`
                  : `A credit for ${studentName}. It lowers what they owe in QuickBooks until it is used on an invoice or paid back.`}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <SheetSection title={`${name} details`}>
              <SheetFields>
                <Field>
                  <FieldLabel htmlFor="doc-email">Email</FieldLabel>
                  <Input
                    id="doc-email"
                    value={customerEmail ?? ''}
                    placeholder="None in QuickBooks"
                    readOnly
                    disabled
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="doc-number">{words.no}</FieldLabel>
                  <Input
                    id="doc-number"
                    value={docNumber}
                    maxLength={21}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="QuickBooks’ next number"
                    className="font-mono tabular-nums"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="doc-date">
                    {words.date} <span className="text-destructive">*</span>
                  </FieldLabel>
                  <DatePicker
                    id="doc-date"
                    value={txnDate}
                    onChange={(d) => setTxnDate(d || todaySg())}
                    allowClear={false}
                  />
                </Field>
                {refund && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="doc-method">
                        Payment method
                      </FieldLabel>
                      <Select
                        value={method}
                        onValueChange={setMethod}
                        disabled={paymentMethods.length === 0}
                      >
                        <SelectTrigger id="doc-method" className="w-full">
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
                    <Field>
                      <FieldLabel htmlFor="doc-refund-from">
                        Refund from <span className="text-destructive">*</span>
                      </FieldLabel>
                      <Select value={refundFrom} onValueChange={setRefundFrom}>
                        <SelectTrigger id="doc-refund-from" className="w-full">
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
                      {bankAccounts.length === 0 && (
                        <FieldDescription>
                          QuickBooks has no bank accounts to offer just now.
                          Reload the page to try again.
                        </FieldDescription>
                      )}
                      {showErrors && !refundFrom && (
                        <FieldError>{REFUND_FROM_REQUIRED}</FieldError>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="doc-check">Cheque no.</FieldLabel>
                      <Input
                        id="doc-check"
                        value={checkNo}
                        maxLength={21}
                        onChange={(e) => setCheckNo(e.target.value)}
                        className="font-mono"
                      />
                      <FieldDescription>
                        For a cheque; leave blank otherwise.
                      </FieldDescription>
                    </Field>
                  </>
                )}
              </SheetFields>
            </SheetSection>

            <SheetSection
              title="Products and services"
              aside={
                <p className="text-[12px] text-muted-foreground">
                  {used.length === 1 ? '1 line' : `${used.length} lines`}
                </p>
              }
            >
              <ProductLinesEditor
                lines={lines}
                onChange={setLines}
                items={items.data?.items ?? []}
                loading={items.isLoading}
                error={items.isError ? (items.error as Error).message : null}
                knownNames={knownNames}
                showErrors={showErrors && used.length > 0}
              />
              {showErrors && (used.length === 0 || (linesOk && total <= 0)) && (
                <FieldError>
                  Add a product or service with an amount above 0.
                </FieldError>
              )}
            </SheetSection>

            <SheetSection title={words.message}>
              <Field>
                <FieldLabel htmlFor="doc-message" className="sr-only">
                  {words.message}
                </FieldLabel>
                <Input
                  id="doc-message"
                  value={message}
                  maxLength={1000}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <FieldDescription>
                  Printed on the {name.toLowerCase()} the customer receives.
                </FieldDescription>
              </Field>
            </SheetSection>

            <SheetSection title="Message displayed on statement">
              <Field>
                <FieldLabel htmlFor="doc-statement" className="sr-only">
                  Message displayed on statement
                </FieldLabel>
                <Textarea
                  id="doc-statement"
                  value={statementMessage}
                  maxLength={SALES_DOC_NOTE_MAX}
                  rows={3}
                  onChange={(e) => setStatementMessage(e.target.value)}
                />
                <FieldDescription>
                  Shown on the customer&rsquo;s statement and in
                  QuickBooks&rsquo; lists as the memo.
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
              <dt className="whitespace-nowrap border-t border-border pt-2 font-serif text-base font-semibold text-foreground">
                {words.total}
              </dt>
              <dd className="border-t border-border pt-2 text-right font-serif text-base font-semibold tabular-nums">
                {formatSgd(total)}
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
