'use client';

import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FilePlus2, Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  CreateInvoiceSheet,
  LinkInvoiceSheet,
} from '@/components/sis/qbo-invoice-sheets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd, formatSyncedAt } from '@/lib/qbo/format';
import type { StageInvoiceView } from '@/lib/qbo/stage-invoices';
import {
  needsStartDate,
  type QboStageKey,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The QuickBooks block on the Registration and Fees tiles. One quiet line of
// facts, then the tile's two actions. Spec "Screens" — the Edit stage pencil
// above stays exactly as it is.
export function QboInvoiceStrip({
  ayCode,
  enroleeNumber,
  stage,
  stageSnapshot,
  invoice,
  connected,
  canInvoice,
}: {
  ayCode: string;
  enroleeNumber: string;
  stage: QboStageKey;
  stageSnapshot: StageSnapshot;
  invoice: StageInvoiceView | null;
  connected: boolean;
  canInvoice: boolean;
}) {
  const [sheet, setSheet] = useState<'create' | 'link' | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const run = useWriteAction();
  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<{ stageWarning: string | null }>(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/stage/${stage}/invoice/refresh`,
        jsonInit('POST', { ayCode })
      ),
  });

  if (!connected) {
    return (
      <p className="ml-1 border-t border-hairline pt-2.5 text-[11px] text-muted-foreground">
        QuickBooks not connected
      </p>
    );
  }

  const open = (which: 'create' | 'link') => {
    setSheetKey((k) => k + 1);
    setSheet(which);
  };
  const startDateMissing = needsStartDate(
    stage,
    stageSnapshot,
    invoice?.state ?? null
  );

  return (
    <div className="ml-1 space-y-2.5 border-t border-hairline pt-2.5">
      {invoice && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground">
          <a
            href={invoice.qbUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono font-semibold tabular-nums text-brand-indigo underline-offset-2 hover:underline"
          >
            {invoice.docNumber ?? 'Invoice'}
            <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">(opens in QuickBooks)</span>
          </a>
          <span className="tabular-nums">{formatSgd(invoice.total)}</span>
          {invoice.state === 'paid' ? (
            <Badge
              variant="outline"
              className="h-5 border-brand-mint bg-brand-mint/30 text-ink"
            >
              Paid in full
            </Badge>
          ) : invoice.state === 'voided' ? (
            <Badge
              variant="outline"
              className="h-5 border-destructive/40 bg-destructive/10 text-destructive"
            >
              Voided
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="h-5 border-brand-amber/40 bg-brand-amber/10 tabular-nums text-ink"
            >
              Balance {formatSgd(invoice.balance)}
            </Badge>
          )}
          <span className="text-muted-foreground">
            {formatSyncedAt(invoice.syncedAt)}
          </span>
        </div>
      )}

      {startDateMissing && (
        <p className="rounded-md border border-brand-amber/40 bg-brand-amber/10 px-2 py-1.5 text-[11px] text-ink">
          Paid in QuickBooks. Add the start date with the pencil above to mark
          Fees as Paid.
        </p>
      )}

      {canInvoice && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => open('create')}>
            <FilePlus2 className="size-3.5" />
            {invoice ? 'New invoice' : 'Create invoice'}
          </Button>
          {invoice ? (
            <Button
              size="sm"
              variant="outline"
              loading={refresh.isPending}
              loadingText="Refreshing…"
              onClick={() =>
                run(() => refresh.mutateAsync(), {
                  pending: 'Checking QuickBooks…',
                  success: (d) =>
                    d.stageWarning ?? 'Up to date with QuickBooks',
                })
              }
            >
              <RefreshCw className="size-3.5" />
              Refresh from QuickBooks
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => open('link')}>
              <Link2 className="size-3.5" />
              Link QB invoice
            </Button>
          )}
        </div>
      )}

      {sheet === 'create' && (
        <CreateInvoiceSheet
          key={`c${sheetKey}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          stage={stage}
        />
      )}
      {sheet === 'link' && (
        <LinkInvoiceSheet
          key={`l${sheetKey}`}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          stage={stage}
        />
      )}
    </div>
  );
}
