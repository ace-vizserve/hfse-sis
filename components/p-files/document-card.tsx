'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Mail,
  Upload,
  XCircle,
} from 'lucide-react';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { RejectDialog } from '@/components/p-files/document-validation/reject-dialog';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HistoryDialog } from '@/components/p-files/history-dialog';
import type { DocumentStatus, SlotMeta } from '@/lib/p-files/document-config';
import { classifyUrgency, type SlotUrgencyKind } from '@/lib/p-files/urgency';

type DocumentCardProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  status: DocumentStatus;
  url?: string | null;
  expiryDate?: string | null;
  expires: boolean;
  meta: SlotMeta | null;
  ayCode: string;
  /** Whether the viewing role can upload / replace. Admin viewers read-only. */
  canWrite?: boolean;
  /** Student full name — used in the reject-dialog description. */
  studentName?: string;
  /** Parent / guardian emails on file — drives Notify dialog recipient list. */
  recipients?: {
    motherEmail: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
  };
  /** Latest reminder timestamp (ISO). Drives the "Reminded N days ago" badge. */
  lastReminderAt?: string | null;
  /** Active promise (if any) — promised_until ≥ today. Drives the "Promised by [date]" badge. */
  activePromise?: { promisedUntil: string; note: string | null } | null;
};

// Card-level treatment: cards stay neutral white in every state. The
// gradient status badge in the header carries the at-a-glance signal —
// keeping the canvas calm makes the badge pop. Missing keeps a dashed
// border (signals "absent slot") since there's no badge that means
// "doesn't exist".
function shellByUrgency(kind: SlotUrgencyKind): string {
  if (kind === 'missing') return 'border-dashed border-border bg-card';
  return 'border-border/60 bg-card';
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  switch (status) {
    case 'valid':
      return (
        <Badge variant="success">
          <CheckCircle2 /> On file
        </Badge>
      );
    case 'uploaded':
      return (
        <Badge variant="warning">
          <Upload /> Pending review
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="blocked">
          <Clock /> Expired
        </Badge>
      );
    case 'rejected':
      return (
        <Badge variant="blocked">
          <XCircle /> Rejected
        </Badge>
      );
    case 'to-follow':
      return (
        <Badge variant="default">
          <CalendarClock /> To follow
        </Badge>
      );
    case 'missing':
      return (
        <Badge
          variant="outline"
          className="border-dashed text-muted-foreground"
        >
          Missing
        </Badge>
      );
    case 'na':
      return <Badge variant="secondary">N/A</Badge>;
  }
}

function daysFromExpiry(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
}

// Sharp, dominant urgency line — only rendered when the slot is actionable
// or close to expiring. Settled cards skip this line entirely so the
// hierarchy stays clean.
function urgencyLine(
  kind: SlotUrgencyKind,
  expiryDate: string | null | undefined,
  hasFileUrl: boolean
): { text: string; tone: string } | null {
  const days = daysFromExpiry(expiryDate);
  switch (kind) {
    case 'expired': {
      if (days === null) return { text: 'Expired', tone: 'text-destructive' };
      const overdue = Math.abs(days);
      return {
        text:
          overdue === 0
            ? 'Expired today'
            : `Expired ${overdue} day${overdue === 1 ? '' : 's'} ago`,
        tone: 'text-destructive',
      };
    }
    case 'rejected':
      return { text: 'Rejected — needs replacement', tone: 'text-destructive' };
    case 'missing':
      // A file may exist even when status reads 'missing' (e.g. a
      // parent-portal upload that hasn't had its status set yet) — say so
      // honestly instead of implying nothing was ever uploaded.
      return hasFileUrl
        ? {
            text: 'On file — awaiting status update',
            tone: 'text-muted-foreground',
          }
        : {
            text: 'Missing — never uploaded',
            tone: 'text-muted-foreground',
          };
    case 'to-follow':
      return { text: 'To follow — parent committed', tone: 'text-primary' };
    case 'expiring-30':
      if (days === 0)
        return { text: 'Expires today', tone: 'text-brand-amber' };
      return { text: `Expires in ${days} days`, tone: 'text-brand-amber' };
    case 'expiring-60':
      return { text: `Expires in ${days} days`, tone: 'text-muted-foreground' };
    default:
      return null;
  }
}

function reminderBadgeText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 30) return null;
  if (days === 0) return 'Reminded today';
  return `Reminded ${days}d ago`;
}

function promiseBadgeText(
  promisedUntil: string | null | undefined
): string | null {
  if (!promisedUntil) return null;
  const formatted = new Date(promisedUntil).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
  });
  return `Promised by ${formatted}`;
}

const ACTIONABLE_STATUSES: DocumentStatus[] = [
  'expired',
  'rejected',
  'missing',
  'to-follow',
];

function isExpiringSoon(
  status: DocumentStatus,
  expiryDate: string | null | undefined
): boolean {
  if (status !== 'valid' || !expiryDate) return false;
  const diffDays = (new Date(expiryDate).getTime() - Date.now()) / 86_400_000;
  return diffDays >= 0 && diffDays <= 60;
}

export function DocumentCard({
  enroleeNumber,
  slotKey,
  label,
  status,
  url,
  expiryDate,
  expires,
  meta,
  ayCode,
  canWrite = false,
  studentName = '',
  recipients,
  lastReminderAt,
  activePromise,
}: DocumentCardProps) {
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const hasFile = status !== 'missing' && status !== 'na';
  const showValidate = canWrite && status === 'uploaded';
  const showReclassify = canWrite && status === 'valid';

  const docUrl = `/api/sis/students/${encodeURIComponent(enroleeNumber)}/document/${encodeURIComponent(slotKey)}?ay=${encodeURIComponent(ayCode)}`;

  // The settled card re-renders from the server (Model A), so there is no
  // inline status to flip optimistically — which is exactly why the toast has
  // to hold until that re-render lands. The route's bespoke `body.error`
  // message is preserved via ApiError.message.
  const approveMutation = useMutation({
    mutationFn: () => apiFetch(docUrl, jsonInit('PATCH', { status: 'Valid' })),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      apiFetch(
        docUrl,
        jsonInit('PATCH', { status: 'Rejected', rejectionReason: reason })
      ),
  });

  const run = useWriteAction();
  const [approving, setApproving] = React.useState(false);

  async function handleApprove() {
    setApproving(true);
    await run(() => approveMutation.mutateAsync(), {
      pending: `Approving ${label}…`,
      success: `${label} approved.`,
      error: (e) =>
        e instanceof Error ? e.message : 'Could not approve the document.',
    });
    setApproving(false);
  }

  async function handleReject(reason: string) {
    await run(() => rejectMutation.mutateAsync(reason), {
      pending: `Rejecting ${label}…`,
      success: `${label} rejected.`,
      error: (e) =>
        e instanceof Error ? e.message : 'Could not reject the document.',
      // Only close on success — a failure leaves the dialog open for a retry,
      // which is what the swallowed `.catch()` here used to preserve.
      onResolved: () => setRejectOpen(false),
    });
  }
  // Kept: these read as badges on the card ("reminded 4 days ago", "promised
  // by 12 Aug"), which is record, not action.
  const reminderText = reminderBadgeText(lastReminderAt);
  const promiseText = promiseBadgeText(activePromise?.promisedUntil);

  const urgencyKind = classifyUrgency({
    key: slotKey,
    status,
    expiryDate: expiryDate ?? null,
    hasFile: !!url,
  });
  const urgency = urgencyLine(urgencyKind, expiryDate, !!url);
  const shellClass = shellByUrgency(urgencyKind);
  const expiryFormatted =
    expires && expiryDate
      ? new Date(expiryDate).toLocaleDateString('en-SG', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : null;

  return (
    <div
      id={`slot-${slotKey}`}
      className={`group relative flex h-full scroll-mt-20 flex-col gap-3 rounded-xl border ${shellClass} px-5 py-4 shadow-xs transition-shadow hover:shadow-sm target:ring-2 target:ring-brand-indigo/40`}
    >
      {/* ── Header: label + status pill ─────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-serif text-[15px] font-semibold leading-tight tracking-tight text-foreground">
            {label}
          </p>
          {urgency && (
            <p
              className={`font-mono text-[11px] font-semibold uppercase tracking-[0.12em] tabular-nums ${urgency.tone}`}
            >
              {urgency.text}
            </p>
          )}
          {expiryFormatted && (
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {urgency
                ? `Expiry ${expiryFormatted}`
                : `Expires ${expiryFormatted}`}
            </p>
          )}
          {expires &&
            !expiryDate &&
            status !== 'missing' &&
            status !== 'na' && (
              <p className="font-mono text-[10px] text-destructive">
                No expiry date set
              </p>
            )}
        </div>
        <StatusBadge status={status} />
      </div>

      {/* ── Outreach pills (Reminded / Promised) ────────────────── */}
      {(reminderText || promiseText) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {reminderText && (
            <Badge variant="warning">
              <Mail /> {reminderText}
            </Badge>
          )}
          {promiseText && (
            <Badge variant="default">
              <CalendarClock /> {promiseText}
            </Badge>
          )}
        </div>
      )}

      {/* ── Spacer so action row stays pinned to the bottom in
          equal-height grid rows ───────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Action row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {showValidate && (
          <>
            <Button
              size="sm"
              variant="default"
              loading={approving}
              loadingText="Approving…"
              onClick={() => void handleApprove()}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={approving}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
          </>
        )}
        {/* Reminding the parent, recording a promised date and uploading a
            file are NOT here. They live in the action queue at the top of the
            page and nowhere else.

            They used to be in both places, under different names — "Notify"
            up there and "Notify parent" down here, "Promise" and "Mark as
            promised", "Upload" and "Replace" — so every actionable document
            was two rows with two vocabularies for the same three dialogs.
            The queue is where you work; this card is the record.

            Approve / Reject below stay: approving a file a parent has already
            sent is a different act from chasing one that hasn't arrived, it is
            done while looking at the file, and the queue does not offer it. */}
        {url && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
          >
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${label} file`}
            >
              <Download className="size-3" />
              View
            </a>
          </Button>
        )}
        {/* Rejecting a document already on file is a correction, and a rare
            one. It was a red-tinted button sitting beside the everyday actions,
            which gave it more weight than it earns. Quiet by default; the
            confirm dialog is where the consequence is spelled out. */}
        {showReclassify && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => setRejectOpen(true)}
          >
            Reject
          </Button>
        )}
        {hasFile && (
          <HistoryDialog
            enroleeNumber={enroleeNumber}
            slotKey={slotKey}
            label={label}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-8 text-muted-foreground hover:text-foreground"
                aria-label={`History for ${label}`}
              >
                <Clock className="size-3.5" />
              </Button>
            }
          />
        )}
      </div>

      {(showValidate || showReclassify) && (
        <RejectDialog
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          slotLabel={label}
          studentName={studentName}
          onConfirm={handleReject}
        />
      )}
    </div>
  );
}
