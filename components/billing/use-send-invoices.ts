'use client';

import { useMutation } from '@tanstack/react-query';
import * as React from 'react';

import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

/** What Send needs of an invoice. */
export type SendableInvoice = { id: string; docNumber: string | null };

/** Emails invoices through QuickBooks one after another (the send route
 *  takes one invoice); says how many went. Each invoice keeps its request id
 *  until our route says nothing was sent (`shouldRenewRequestId`), exactly as
 *  the single Send button does — so a retry after a lost or unclear answer
 *  is replayed by QuickBooks, never emailed twice. */
export function useSendInvoices() {
  const run = useWriteAction();
  const ids = React.useRef(new Map<string, string>());
  const send = useMutation({
    mutationFn: async (rows: SendableInvoice[]) => {
      let sent = 0;
      const failed: string[] = [];
      const unclear: string[] = [];
      for (const r of rows) {
        let id = ids.current.get(r.id);
        if (!id) {
          id = crypto.randomUUID();
          ids.current.set(r.id, id);
        }
        try {
          await apiFetch(
            `/api/billing/invoices/${encodeURIComponent(r.id)}/send`,
            jsonInit('POST', { requestId: id })
          );
          ids.current.delete(r.id);
          sent += 1;
        } catch (err) {
          const name = r.docNumber ?? r.id;
          if (shouldRenewRequestId(err)) {
            ids.current.delete(r.id);
            failed.push(name);
          } else unclear.push(name);
        }
      }
      if (sent === 0 && unclear.length === 0)
        throw new Error(
          `QuickBooks didn't send ${failed.length === 1 ? failed[0] : `any of the ${failed.length} invoices`}. Check the customer has an email address.`
        );
      return { sent, failed, unclear };
    },
  });
  return (rows: SendableInvoice[]) =>
    run(() => send.mutateAsync(rows), {
      pending:
        rows.length === 1
          ? 'Emailing through QuickBooks…'
          : `Emailing ${rows.length} invoices through QuickBooks…`,
      success: (d) =>
        [
          d.sent === 1 ? '1 invoice emailed' : `${d.sent} invoices emailed`,
          d.failed.length ? `not sent: ${d.failed.join(', ')}` : null,
          d.unclear.length
            ? `no answer from QuickBooks for ${d.unclear.join(', ')} — they may have gone; Send again is safe`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
    });
}
