'use client';

import Link from 'next/link';
import { ArrowRight, CalendarClock, Mail, Upload } from 'lucide-react';

import { NotifyDialog } from '@/components/p-files/notify-dialog';
import { PromiseDialog } from '@/components/p-files/promise-dialog';
import { UploadDialog } from '@/components/p-files/upload-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DOCUMENT_SLOTS, type DocumentStatus, type SlotMeta } from '@/lib/p-files/document-config';
import { classifyUrgency, urgencyDescriptor, type SlotUrgencyKind } from '@/lib/p-files/urgency';

export type ActionQueueRow = {
  slotKey: string;
  slotLabel: string;
  status: DocumentStatus;
  expiryDate: string | null;
  url: string | null;
  meta: SlotMeta | null;
  expires: boolean;
  lastReminderAt: string | null;
};

type Recipients = {
  motherEmail: string | null;
  fatherEmail: string | null;
  guardianEmail: string | null;
};

const URGENCY_TONE: Record<SlotUrgencyKind, { dot: string; label: string }> = {
  expired: { dot: 'bg-destructive', label: 'text-destructive' },
  rejected: { dot: 'bg-destructive', label: 'text-destructive' },
  missing: { dot: 'bg-muted-foreground', label: 'text-muted-foreground' },
  'expiring-30': { dot: 'bg-brand-amber', label: 'text-brand-amber' },
  'expiring-60': { dot: 'bg-brand-amber', label: 'text-brand-amber' },
  'expiring-90': { dot: 'bg-brand-amber', label: 'text-brand-amber' },
  uploaded: { dot: 'bg-brand-amber', label: 'text-brand-amber' },
  'to-follow': { dot: 'bg-accent', label: 'text-brand-indigo-deep' },
  valid: { dot: 'bg-brand-mint', label: 'text-ink' },
  na: { dot: 'bg-border', label: 'text-muted-foreground' },
};

export function ActionQueueCard({
  enroleeNumber,
  rows,
  recipients,
  canWrite,
  totalActionable,
}: {
  enroleeNumber: string;
  rows: ActionQueueRow[];
  recipients: Recipients;
  canWrite: boolean;
  totalActionable: number;
}) {
  if (rows.length === 0) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Action queue
          </CardDescription>
          <CardTitle className="font-serif text-xl">Nothing needs attention.</CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-mint to-brand-mint-deep text-ink shadow-brand-tile-mint">
              <CalendarClock className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            All documents are valid and outside the 60-day expiry window. Nothing to remind, nothing
            to chase.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Action queue
        </CardDescription>
        <CardTitle className="font-serif text-xl">
          {totalActionable} document{totalActionable === 1 ? '' : 's'} need{totalActionable === 1 ? 's' : ''} attention
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <CalendarClock className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const kind = classifyUrgency({
            key: row.slotKey,
            status: row.status,
            expiryDate: row.expiryDate,
          });
          const tone = URGENCY_TONE[kind];
          const config = DOCUMENT_SLOTS.find((s) => s.key === row.slotKey);
          const isReplacement = row.status !== 'missing' && row.status !== 'na';
          return (
            <li key={row.slotKey} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${tone.dot}`}
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-serif text-[15px] font-semibold tracking-tight text-foreground">
                    {row.slotLabel}
                  </p>
                  <p className={`font-mono text-[11px] tabular-nums ${tone.label}`}>
                    {urgencyDescriptor({
                      key: row.slotKey,
                      status: row.status,
                      expiryDate: row.expiryDate,
                    })}
                  </p>
                </div>
              </div>
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  <NotifyDialog
                    enroleeNumber={enroleeNumber}
                    slotKey={row.slotKey}
                    label={row.slotLabel}
                    recipients={recipients}
                    lastReminderAt={row.lastReminderAt}
                    trigger={
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                        <Mail className="size-3" />
                        Notify
                      </Button>
                    }
                  />
                  {(row.status === 'expired' || row.status === 'rejected' || row.status === 'missing') && (
                    <PromiseDialog
                      enroleeNumber={enroleeNumber}
                      slotKey={row.slotKey}
                      label={row.slotLabel}
                      trigger={
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                          <CalendarClock className="size-3" />
                          Promise
                        </Button>
                      }
                    />
                  )}
                  <UploadDialog
                    enroleeNumber={enroleeNumber}
                    slotKey={row.slotKey}
                    label={row.slotLabel}
                    expires={config?.expires ?? row.expires}
                    meta={config?.meta ?? row.meta}
                    isReplacement={isReplacement}
                    trigger={
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                        <Upload className="size-3" />
                        Upload
                      </Button>
                    }
                  />
                  <Link
                    href={`#slot-${row.slotKey}`}
                    aria-label={`Jump to ${row.slotLabel}`}
                    className="ml-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ) : (
                <Badge
                  variant="outline"
                  className="h-6 border-border bg-muted px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Read-only
                </Badge>
              )}
            </li>
          );
        })}
      </ul>

      {totalActionable > rows.length && (
        <div className="border-t border-border bg-muted/30 px-6 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Showing top {rows.length} of {totalActionable} · scroll for the rest
          </p>
        </div>
      )}
    </Card>
  );
}
