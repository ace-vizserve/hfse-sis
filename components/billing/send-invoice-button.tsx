'use client';

import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Emails the invoice through QuickBooks. "Send" before it was ever sent,
// "Send again" after. useWriteAction refreshes the page itself.
export function SendInvoiceButton({
  qboInvoiceId,
  label,
  disabledReason,
}: {
  qboInvoiceId: string;
  label: 'Send' | 'Send again';
  /** Set when it can't be sent (no email, voided) — the button is disabled and says why. */
  disabledReason?: string | null;
}) {
  const run = useWriteAction();
  const send = useMutation({
    mutationFn: () =>
      apiFetch<{ sentTo: string | null }>(
        `/api/billing/invoices/${encodeURIComponent(qboInvoiceId)}/send`,
        jsonInit('POST', {})
      ),
  });
  return (
    <Button
      variant="outline"
      disabled={!!disabledReason}
      title={disabledReason ?? undefined}
      loading={send.isPending}
      loadingText="Sending…"
      onClick={() =>
        run(() => send.mutateAsync(), {
          pending: 'Emailing through QuickBooks…',
          success: (d) => (d.sentTo ? `Emailed to ${d.sentTo}` : 'Emailed'),
        })
      }
    >
      <Send className="size-4" />
      {label}
    </Button>
  );
}
