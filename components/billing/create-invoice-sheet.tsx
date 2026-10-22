'use client';

import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CopyPlus, Layers } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  emptyProductLine,
  ProductLinesEditor,
  useProductItems,
  type ProductLine,
} from '@/components/billing/product-lines-editor';
import { SheetFields, SheetSection } from '@/components/billing/sheet-section';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { Textarea } from '@/components/ui/textarea';
import { clearInvoiceCopy, readInvoiceCopy } from '@/lib/billing/invoice-copy';
import { INVOICE_NOTE_MAX } from '@/lib/billing/invoice-create-body';
import type { SameItems } from '@/lib/billing/same-items';
import type { BillingStage, StageTarget } from '@/lib/billing/tie';
import { duplicateTileWarning, todaySg } from '@/lib/billing/view';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Line = ProductLine;
type Result = {
  qboInvoiceId: string;
  docNumber: string | null;
  sentTo: string | null;
  warnings: string[];
};
type EditResult = { docNumber: string | null; warnings: string[] };

/** Edit invoice: the invoice as QuickBooks has it when the sheet opens. */
export type InvoiceEdit = {
  invoiceId: string;
  docNumber: string | null;
  /** QuickBooks' version of it; a save against an older one is refused. */
  syncToken: string;
  txnDate: string;
  dueDate: string | null;
  memo: string;
  statementMemo: string;
  lines: Array<{
    lineId: string | null;
    itemId: string;
    itemName: string | null;
    description: string;
    qty: number;
    unitPrice: number;
  }>;
};

const STAGE_NAME: Record<BillingStage, string> = {
  registration: 'Registration',
  fees: 'Fees',
};

const emptyLine = emptyProductLine;

// Create invoice: QuickBooks' new-invoice fields (Mr Ace, 2026-10-19: "use
// QB as reference") in the SIS sheet ("we always use SIS layout") — Customer
// email, Invoice no., Invoice date, Due date; the product or service lines
// with Add line / Clear all; Note to customer; Memo on statement; the
// totals; Cancel, Save and
// send, Create invoice. The customer is always the student's linked
// QuickBooks customer.
//
// With `edit`, the same sheet is QuickBooks' Edit invoice: the invoice's own
// lines, dates and notes to change, Save changes, and no Send.
export function CreateInvoiceSheet({
  open,
  onOpenChange,
  studentNumber,
  studentName,
  customerEmail,
  stage = null,
  existing,
  edit = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  studentNumber: string;
  studentName: string;
  /** The QuickBooks customer's email, if it has one. */
  customerEmail: string | null;
  /** Created from a Registration / Fees stage: the invoice is tied to it. */
  stage?: StageTarget | null;
  /** The customer's invoices as stored, for the duplicate-stage note. */
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
  /** Edit invoice: this invoice, prefilled; null for Create invoice. */
  edit?: InvoiceEdit | null;
}) {
  const run = useWriteAction();
  const router = useRouter();
  const items = useProductItems(open);
  // Make a copy (the invoice page's More actions): its lines and note start
  // the form, once — the stored copy is cleared after the form has it. Edit
  // invoice starts from the invoice itself and leaves a stored copy alone.
  const [copy] = useState(() => (edit ? null : readInvoiceCopy(studentNumber)));
  useEffect(() => {
    if (!edit) clearInvoiceCopy(studentNumber);
  }, [studentNumber, edit]);
  const [lines, setLines] = useState<Line[]>(() =>
    edit
      ? edit.lines.map((l, i) => ({
          key: i + 1,
          ...(l.lineId ? { lineId: l.lineId } : {}),
          itemId: l.itemId,
          description: l.description,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
        }))
      : copy
        ? copy.lines.map((l, i) => ({
            key: i + 1,
            itemId: l.itemId,
            description: l.description,
            qty: String(l.qty),
            unitPrice: String(l.unitPrice),
          }))
        : [emptyLine(1)]
  );
  const [txnDate, setTxnDate] = useState(() => edit?.txnDate ?? todaySg());
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? '');
  const [memo, setMemo] = useState(edit?.memo ?? copy?.memo ?? '');
  const [statementMemo, setStatementMemo] = useState(
    edit?.statementMemo ?? copy?.statementMemo ?? ''
  );
  const [docNumber, setDocNumber] = useState(edit?.docNumber ?? '');
  const copiedFrom = copy ? (copy.from ?? 'an invoice') : null;
  // Edit: the names of the invoice's own products, as QuickBooks has them.
  const editNames = useMemo(
    () =>
      new Map(
        (edit?.lines ?? []).flatMap((l) =>
          l.itemName ? [[l.itemId, l.itemName] as const] : []
        )
      ),
    [edit]
  );
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
      Number.isFinite(l.p)
  );
  // A rate below 0 is a discount line; QuickBooks takes an invoice that
  // comes to 0 or more.
  const total = parsed.reduce(
    (s, l) =>
      s +
      (l.qty.trim() !== '' &&
      l.unitPrice.trim() !== '' &&
      l.q > 0 &&
      Number.isFinite(l.p)
        ? Math.round(l.q * l.p * 100) / 100
        : 0),
    0
  );
  const valid = linesValid && total >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(txnDate);

  // Created from a stage that already has a live invoice tied to it.
  // Not when editing: the stage's live invoice is this one.
  const warning = useMemo(
    () => (edit ? null : duplicateTileWarning({ target: stage, existing })),
    [edit, stage, existing]
  );

  // Edit invoice → Save changes: every line goes, QuickBooks replaces them.
  const update = useMutation({
    mutationFn: async () => {
      try {
        return await apiFetch<EditResult>(
          `/api/billing/students/${encodeURIComponent(studentNumber)}/invoices/${encodeURIComponent(edit!.invoiceId)}`,
          jsonInit('PATCH', {
            lines: parsed.map((l) => ({
              ...(l.lineId ? { lineId: l.lineId } : {}),
              itemId: l.itemId,
              ...(l.description.trim()
                ? { description: l.description.trim() }
                : {}),
              qty: l.q,
              unitPrice: l.p,
            })),
            txnDate,
            dueDate: dueDate || null,
            memo: memo.trim(),
            // Exactly as typed; blank clears it.
            statementMemo,
            syncToken: edit!.syncToken,
            requestId,
          })
        );
      } catch (err) {
        // Same rule as Create: renew only when nothing was written.
        if (shouldRenewAfter(err, unclearRef))
          setRequestId(crypto.randomUUID());
        throw err;
      }
    },
  });

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
            ...(stage ? { stage } : {}),
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
  // Same items as last time: the lines of the newest invoice tied to this
  // stage, any student. Fills the form; staff adjust.
  const [sameNote, setSameNote] = useState<string | null>(null);
  const same = useMutation({
    mutationFn: () =>
      apiFetch<SameItems>(
        `/api/billing/stage-items?stage=${encodeURIComponent(stage!.stage)}`
      ),
    onSuccess: (d) => {
      if (d.lines.length === 0) {
        setSameNote(
          `No invoice has been made from ${STAGE_NAME[stage!.stage]} yet, so there is nothing to copy. Pick the products below.`
        );
        return;
      }
      setLines(
        d.lines.map((l, i) => ({
          key: nextKey() + i,
          itemId: l.itemId,
          description: l.description,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
        }))
      );
      setSameNote(
        `Filled from invoice ${d.from ?? 'the last one'}. Check the lines before you create it.` +
          (d.skipped ? " Lines without a product weren't copied." : '')
      );
    },
    onError: (e) => setSameNote((e as Error).message),
  });
  const nextKey = () => Math.max(0, ...lines.map((x) => x.key)) + 1;

  async function submit(send: boolean) {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setSaving(send ? 'send' : 'close');
    if (edit) {
      await run(() => update.mutateAsync(), {
        pending: 'Saving the changes in QuickBooks…',
        success: (d) => {
          for (const w of d.warnings) toast.warning(w);
          return d.docNumber
            ? `Invoice ${d.docNumber} saved in QuickBooks`
            : 'Invoice saved in QuickBooks';
        },
        // The page reads QuickBooks fresh on refresh.
        onResolved: () => onOpenChange(false),
      });
      setSaving(null);
      return;
    }
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
              {edit
                ? `Edit invoice ${edit.docNumber ?? ''}`.trim()
                : 'Create invoice'}
            </SheetTitle>
            <SheetDescription>
              {edit
                ? `${studentName}’s invoice as QuickBooks has it. Your changes are saved in QuickBooks.`
                : copiedFrom
                  ? `A new invoice for ${studentName}, copied from invoice ${copiedFrom} and created in QuickBooks.`
                  : `A new invoice for ${studentName}, created in QuickBooks.`}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            {stage && (
              <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <Layers className="size-4" />
                </div>
                <p className="flex-1 text-sm leading-relaxed text-foreground">
                  This invoice fills{' '}
                  <span className="font-semibold">
                    {studentName}&rsquo;s {STAGE_NAME[stage.stage]} for{' '}
                    {stage.ayCode}
                  </span>
                  . Its number, status and payment date go into that stage.
                </p>
              </div>
            )}
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
                    placeholder={edit ? 'No number' : 'QuickBooks’ next number'}
                    readOnly={!!edit}
                    disabled={!!edit}
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
                    // Edit: a blank due date would only keep QuickBooks' own.
                    allowClear={!edit?.dueDate}
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
              <ProductLinesEditor
                lines={lines}
                onChange={setLines}
                items={items.data?.items ?? []}
                loading={items.isLoading}
                error={items.isError ? (items.error as Error).message : null}
                // Edit: the invoice's own products, named while the list
                // loads or once inactive in QuickBooks.
                knownNames={editNames}
                showErrors={showErrors}
                belowZero={linesValid && total < 0}
                actions={
                  stage &&
                  !edit && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      loading={same.isPending}
                      loadingText="Copying…"
                      onClick={() => same.mutate()}
                    >
                      {!same.isPending && <CopyPlus className="size-3.5" />}
                      Same items as last time
                    </Button>
                  )
                }
              />
              {sameNote && (
                <p className="text-[13px] text-muted-foreground">{sameNote}</p>
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
            {!edit && (
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
            )}
            <Button
              type="submit"
              loading={saving === 'close'}
              loadingText={
                edit ? 'Saving in QuickBooks…' : 'Creating in QuickBooks…'
              }
              disabled={!!saving}
            >
              {edit ? 'Save changes' : 'Create invoice'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
