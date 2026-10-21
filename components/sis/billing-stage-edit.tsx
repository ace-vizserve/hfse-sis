'use client';

import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { StageStatusBadge } from '@/components/sis/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import {
  showsOpenInvoice,
  stageInvoiceHref,
  type StageBilling,
} from '@/lib/billing/stage-card';
import {
  BILLING_EDIT_CHOICES,
  billingEditShape,
  canCancelStage,
  canSaveChoice,
  cancelPayload,
  choosePayload,
  chooseSubtitle,
  initialChoice,
  invoicedSummary,
  remarksPayload,
  type StagePayload,
  type StaffStageStatus,
  type StartDateEdit,
  voidableOnCancel,
} from '@/lib/billing/stage-edit';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { QBO_OWNED_FIELD_KEYS } from '@/lib/qbo/stage-lock';
import { apiFetch, ApiError, jsonInit } from '@/lib/query/fetcher';
import {
  findStageCompletionBlockers,
  STAGE_LABELS,
  stageCompletionMessage,
} from '@/lib/schemas/sis';

// The body of the Edit dialog for Registration and Fees while QuickBooks is
// connected (mockup boards "Edit" and "Edit, invoiced", spec 2026-10-21). The
// rules — which shape, which cards, what each save sends — live in
// lib/billing/stage-edit.ts; this only lays them out.

const OWNED: ReadonlySet<string> = new Set(QBO_OWNED_FIELD_KEYS);

export function BillingStageEdit({
  ayCode,
  enroleeNumber,
  stageKey,
  initialStatus,
  initialRemarks,
  initialExtras,
  hasLiveInvoice,
  billing,
  invoiceNumber,
  studentNumber,
  canOpenBilling,
  onDone,
}: {
  ayCode: string;
  enroleeNumber: string;
  stageKey: 'registration' | 'fees';
  initialStatus: string | null;
  initialRemarks: string | null;
  initialExtras: Record<string, string | null>;
  /** A live (not voided) invoice is tied to the stage. */
  hasLiveInvoice: boolean;
  /** The tied invoices, summed up as the stage card reads them. */
  billing: StageBilling | null;
  /** The tied (or last) invoice's number. */
  invoiceNumber: string | null;
  studentNumber: string | null;
  /** admissions / school_admin / superadmin — may open Billing. */
  canOpenBilling: boolean;
  onDone: () => void;
}) {
  const label = STAGE_LABELS[stageKey];
  const shape = billingEditShape(hasLiveInvoice && !!billing);
  const [choice, setChoice] = useState<StaffStageStatus | ''>(
    initialChoice(initialStatus)
  );
  const [remarks, setRemarks] = useState<string | null>(initialRemarks);
  const initialStart = initialExtras.startDate ?? null;
  const [startDate, setStartDate] = useState<string>(
    (initialStart ?? '').slice(0, 10)
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState<'save' | 'cancel' | null>(null);
  // Cancel this stage can void the unpaid invoice too, through Billing's own
  // void (one request id per confirm, kept once an answer was unclear).
  const voidable = canOpenBilling ? voidableOnCancel(billing) : null;
  const [voidToo, setVoidToo] = useState(true);
  const voidRequestId = useRef<string | null>(null);
  const voidUnclear = useRef(false);

  const startEdit: StartDateEdit | undefined =
    stageKey === 'fees'
      ? { before: initialStart, now: startDate || null }
      : undefined;

  // The status the row will hold after a plain save, checked against the
  // same field rules the route applies (QuickBooks' own fields never block).
  const savedStatus = shape === 'choose' ? choice || null : initialStatus;
  const blockers = savedStatus
    ? findStageCompletionBlockers(stageKey, savedStatus, {
        ...initialExtras,
        ...(startEdit ? { startDate: startEdit.now } : {}),
      }).filter((b) => !OWNED.has(b.fieldKey))
    : [];

  const save = useMutation({
    mutationFn: (payload: StagePayload) =>
      apiFetch<{ changed?: number }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stageKey}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', payload)
      ),
  });
  const run = useWriteAction();

  async function voidLead(qboInvoiceId: string) {
    voidRequestId.current ??= crypto.randomUUID();
    try {
      await apiFetch(
        `/api/billing/invoices/${encodeURIComponent(qboInvoiceId)}/void`,
        jsonInit('POST', { requestId: voidRequestId.current })
      );
      voidRequestId.current = null;
      voidUnclear.current = false;
    } catch (err) {
      if (shouldRenewAfter(err, voidUnclear)) voidRequestId.current = null;
      throw err;
    }
  }

  async function send(
    payload: StagePayload,
    kind: 'save' | 'cancel',
    voidFirst?: { qboInvoiceId: string; number: string }
  ) {
    setBusy(kind);
    await run(
      async () => {
        // Void first: if QuickBooks refuses, the stage is left as it was.
        if (voidFirst) await voidLead(voidFirst.qboInvoiceId);
        return save.mutateAsync(payload);
      },
      {
        pending:
          kind === 'cancel'
            ? voidFirst
              ? `Voiding ${voidFirst.number} and cancelling ${label.toLowerCase()}…`
              : `Cancelling ${label.toLowerCase()}…`
            : `Saving ${label.toLowerCase()}…`,
        success:
          kind === 'cancel'
            ? voidFirst
              ? `${voidFirst.number} voided and ${label} cancelled`
              : `${label} cancelled`
            : shape === 'invoiced' && !payload.extras
              ? 'Remarks saved'
              : `${label} saved`,
        error: (e: unknown) =>
          (e instanceof ApiError && e.body && typeof e.body === 'object'
            ? (e.body as { error?: string }).error
            : undefined) ?? 'Failed to save',
        onResolved: () => onDone(),
      }
    );
    setBusy(null);
  }

  const remarksField = (
    <div className="space-y-2">
      <p
        id="billing-remarks-label"
        className="text-sm font-medium text-foreground"
      >
        Remarks{' '}
        <span className="font-normal text-muted-foreground">(internal)</span>
      </p>
      <RichTextEditor
        value={remarks ?? ''}
        onChange={(v) => setRemarks(v === '' ? null : v)}
        rows={4}
        placeholder="Notes for the team"
        maxLength={4000}
        aria-label="Remarks (internal)"
      />
    </div>
  );

  // Fees keeps its start date: Paid waits for it (stage-lock paidOnStartDate).
  const startField = startEdit ? (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Start date</p>
      <DatePicker
        value={startDate}
        onChange={setStartDate}
        placeholder="Pick the start date"
      />
    </div>
  ) : null;

  const blockerLine =
    blockers.length > 0 ? (
      <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" />
        {stageCompletionMessage(stageKey, savedStatus ?? '', blockers)}
      </p>
    ) : null;

  const header = (subtitle: string) => (
    <DialogHeader className="shrink-0">
      <DialogTitle className="font-serif text-lg font-semibold">
        {label} · {ayCode}
      </DialogTitle>
      <DialogDescription>{subtitle}</DialogDescription>
    </DialogHeader>
  );

  if (shape === 'choose') {
    return (
      <>
        {header(chooseSubtitle(initialStatus, invoiceNumber))}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div className="space-y-2">
            <p
              id="billing-next-label"
              className="text-sm font-medium text-foreground"
            >
              What’s next for this stage?
            </p>
            <RadioGroup
              value={choice}
              onValueChange={(v) => setChoice(v as StaffStageStatus)}
              aria-labelledby="billing-next-label"
              className="gap-2"
            >
              {BILLING_EDIT_CHOICES.map((c) => (
                <label
                  key={c.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline px-3 py-2.5 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-brand-indigo-soft has-[[data-state=checked]]:bg-accent"
                >
                  <RadioGroupItem value={c.value} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium text-foreground">
                      {c.value}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {c.help}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
          {startField}
          {remarksField}
          {blockerLine}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDone}
            disabled={busy !== null}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            loading={busy === 'save'}
            loadingText="Saving…"
            disabled={!canSaveChoice(choice) || blockers.length > 0}
            onClick={() => {
              if (!choice) return;
              void send(
                choosePayload({ choice, remarks, startDate: startEdit }),
                'save'
              );
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </>
    );
  }

  // Invoiced: a live invoice is tied, so the status follows QuickBooks.
  const summary = invoicedSummary(billing as StageBilling, invoiceNumber);
  const lead = showsOpenInvoice(initialStatus, billing) ? billing?.lead : null;
  const openHref =
    canOpenBilling && lead && studentNumber
      ? stageInvoiceHref(studentNumber, lead.qboInvoiceId)
      : null;
  const startChanged =
    !!startEdit &&
    !!remarksPayload({
      initialStatus,
      remarks,
      startDate: startEdit,
    }).extras;

  return (
    <>
      {header('This status follows the invoice in QuickBooks.')}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section
          aria-label="Invoice"
          className="space-y-3 rounded-lg border border-hairline bg-muted/40 px-4 py-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StageStatusBadge status={initialStatus} stage={stageKey} />
            {openHref && (
              <Link
                href={openHref}
                className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-brand-indigo underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Open invoice in Billing
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">Invoice</dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">
                {summary.number}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">
                {summary.money.label}
              </dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">
                {summary.money.value}
              </dd>
            </div>
            {summary.due && (
              <div className="space-y-0.5">
                <dt className="text-xs text-muted-foreground">Due</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {summary.due}
                </dd>
              </div>
            )}
          </dl>
          <p className="text-xs text-ink-3">
            To change the lines, use Edit invoice in Billing. To bill again,
            void it there first.
          </p>
        </section>
        {startField}
        {remarksField}
        {blockerLine}
      </div>
      {confirmCancel ? (
        <div
          role="alert"
          className="flex shrink-0 flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Cancel {label} for this applicant?
            </p>
            {voidable ? (
              <>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="cancel-void-too"
                    checked={voidToo}
                    onCheckedChange={(v) => setVoidToo(v === true)}
                    disabled={busy !== null}
                    className="mt-0.5"
                  />
                  <label
                    htmlFor="cancel-void-too"
                    className="text-sm text-foreground"
                  >
                    Also void invoice {summary.number} in QuickBooks
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {voidToo
                    ? 'The parent will no longer owe it.'
                    : `Invoice ${summary.number} stays open and the parent still owes it.`}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {summary.money.label !== 'Owed'
                  ? `This only marks the stage Cancelled. Invoice ${summary.number} stays paid in QuickBooks. Any refund is done in QuickBooks.`
                  : billing && billing.owed !== billing.total
                    ? `This only marks the stage Cancelled. Invoice ${summary.number} has a payment on it, so it stays open in QuickBooks. Void or refund it in QuickBooks.`
                    : `This only marks the stage Cancelled. Invoice ${summary.number} stays open in QuickBooks and the parent still owes it.`}
              </p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmCancel(false)}
              disabled={busy !== null}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              loading={busy === 'cancel'}
              loadingText="Cancelling…"
              onClick={() =>
                void send(
                  cancelPayload(remarks),
                  'cancel',
                  voidable && voidToo
                    ? { ...voidable, number: summary.number }
                    : undefined
                )
              }
            >
              {voidable && voidToo
                ? `Void and cancel ${label}`
                : `Cancel ${label}`}
            </Button>
          </div>
        </div>
      ) : (
        <DialogFooter className="shrink-0 gap-2 border-t border-border pt-4 sm:justify-between">
          {canCancelStage(initialStatus) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-destructive/40 bg-background text-destructive hover:border-destructive/60 hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setConfirmCancel(true)}
              disabled={busy !== null}
            >
              Cancel this stage
            </Button>
          ) : (
            <span aria-hidden />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDone}
              disabled={busy !== null}
            >
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              loading={busy === 'save'}
              loadingText="Saving…"
              disabled={blockers.length > 0}
              onClick={() =>
                void send(
                  remarksPayload({
                    initialStatus,
                    remarks,
                    startDate: startEdit,
                  }),
                  'save'
                )
              }
            >
              {startChanged ? 'Save changes' : 'Save remarks'}
            </Button>
          </div>
        </DialogFooter>
      )}
    </>
  );
}
