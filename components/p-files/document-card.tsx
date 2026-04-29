'use client';

import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Mail,
  Upload,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HistoryDialog } from '@/components/p-files/history-dialog';
import { NotifyDialog } from '@/components/p-files/notify-dialog';
import { PromiseDialog } from '@/components/p-files/promise-dialog';
import { UploadDialog } from '@/components/p-files/upload-dialog';
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
  /** Whether the viewing role can upload / replace. Admin viewers read-only. */
  canWrite?: boolean;
  /** Parent / guardian emails on file — drives Notify dialog recipient list. */
  recipients?: { motherEmail: string | null; fatherEmail: string | null; guardianEmail: string | null };
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
    case 'missing':
      return (
        <Badge variant="outline" className="border-dashed text-muted-foreground">
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
): { text: string; tone: string } | null {
  const days = daysFromExpiry(expiryDate);
  switch (kind) {
    case 'expired': {
      if (days === null) return { text: 'Expired', tone: 'text-destructive' };
      const overdue = Math.abs(days);
      return {
        text: overdue === 0 ? 'Expired today' : `Expired ${overdue} day${overdue === 1 ? '' : 's'} ago`,
        tone: 'text-destructive',
      };
    }
    case 'rejected':
      return { text: 'Rejected — needs replacement', tone: 'text-destructive' };
    case 'missing':
      return { text: 'Missing — never uploaded', tone: 'text-muted-foreground' };
    case 'expiring-30':
      if (days === 0) return { text: 'Expires today', tone: 'text-brand-amber' };
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

function promiseBadgeText(promisedUntil: string | null | undefined): string | null {
  if (!promisedUntil) return null;
  const formatted = new Date(promisedUntil).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
  });
  return `Promised by ${formatted}`;
}

const ACTIONABLE_STATUSES: DocumentStatus[] = ['expired', 'rejected', 'missing'];

function isExpiringSoon(status: DocumentStatus, expiryDate: string | null | undefined): boolean {
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
  canWrite = false,
  recipients,
  lastReminderAt,
  activePromise,
}: DocumentCardProps) {
  const hasFile = status !== 'missing' && status !== 'na';
  const canUpload = canWrite && status !== 'na';
  const reminderText = reminderBadgeText(lastReminderAt);
  const promiseText = promiseBadgeText(activePromise?.promisedUntil);
  const showNotify =
    canWrite && (ACTIONABLE_STATUSES.includes(status) || isExpiringSoon(status, expiryDate));
  const showPromise = canWrite && ACTIONABLE_STATUSES.includes(status);

  const urgencyKind = classifyUrgency({ key: slotKey, status, expiryDate: expiryDate ?? null });
  const urgency = urgencyLine(urgencyKind, expiryDate);
  const shellClass = shellByUrgency(urgencyKind);
  const expiryFormatted =
    expires && expiryDate
      ? new Date(expiryDate).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })
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
            <p className={`font-mono text-[11px] font-semibold uppercase tracking-[0.12em] tabular-nums ${urgency.tone}`}>
              {urgency.text}
            </p>
          )}
          {expiryFormatted && (
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {urgency ? `Expiry ${expiryFormatted}` : `Expires ${expiryFormatted}`}
            </p>
          )}
          {expires && !expiryDate && status !== 'missing' && status !== 'na' && (
            <p className="font-mono text-[10px] text-destructive">No expiry date set</p>
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
        {showNotify && recipients && (
          <NotifyDialog
            enroleeNumber={enroleeNumber}
            slotKey={slotKey}
            label={label}
            recipients={recipients}
            lastReminderAt={lastReminderAt}
          />
        )}
        {showPromise && (
          <PromiseDialog enroleeNumber={enroleeNumber} slotKey={slotKey} label={label} />
        )}
        {canUpload && (
          <UploadDialog
            enroleeNumber={enroleeNumber}
            slotKey={slotKey}
            label={label}
            expires={expires}
            meta={meta}
            isReplacement={hasFile}
          />
        )}
        {url && (
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`View ${label} file`}>
              <Download className="size-3" />
              View
            </a>
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
    </div>
  );
}
