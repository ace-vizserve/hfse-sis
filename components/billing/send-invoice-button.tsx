'use client';

import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Emails the invoice through QuickBooks. "Send" before it was ever sent,
// "Send again" after. useWriteAction refreshes the page itself.
export function SendInvoiceButton({
  qboInvoiceId,
  label,
  disabledReason,
  variant = 'outline',
  className,
}: {
  qboInvoiceId: string;
  label: 'Send' | 'Send again';
  /** Set when it can't be sent (no email, voided) — the button is disabled and says why. */
  disabledReason?: string | null;
  variant?: 'default' | 'outline';
  className?: string;
}) {
  const run = useWriteAction();
  // One request id per send. A sent email takes a fresh one for the next
  // click; a failure keeps it unless our route said nothing was sent, so a
  // retry after a lost answer is replayed by QuickBooks, not emailed twice.
  const requestId = useRef<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      requestId.current ??= crypto.randomUUID();
      try {
        const r = await apiFetch<{ sentTo: string | null }>(
          `/api/billing/invoices/${encodeURIComponent(qboInvoiceId)}/send`,
          jsonInit('POST', { requestId: requestId.current })
        );
        requestId.current = null;
        return r;
      } catch (err) {
        if (shouldRenewRequestId(err)) requestId.current = null;
        throw err;
      }
    },
  });
  return (
    <Button
      variant={variant}
      className={className}
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
