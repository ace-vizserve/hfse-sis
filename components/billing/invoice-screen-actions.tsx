'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  downloadInvoicePdfs,
  invoicePdfHref,
} from '@/components/billing/invoice-row-menu';
import { SendInvoiceButton } from '@/components/billing/send-invoice-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { stashInvoiceCopy, type InvoiceCopy } from '@/lib/billing/invoice-copy';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The invoice screen's menus, as QuickBooks has them. What the SIS can do for
// a linked student's invoice runs here (Print or download, Make a copy, Void
// an unpaid invoice, Send); the rest opens the invoice in QuickBooks, where
// QuickBooks does it (editing the lines, Delete, recurring, credit memos).

const QbLink = ({ href, children }: { href: string; children: string }) => (
  <DropdownMenuItem asChild>
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
    </a>
  </DropdownMenuItem>
);

/** Top bar's Manage: QuickBooks' Manage panel (Customization, Payment
 *  options, Design, Scheduling) is invoice-form setup, kept in QuickBooks. */
export function InvoiceManageMenu({
  qbUrl,
  qbSettingsUrl,
}: {
  qbUrl: string;
  qbSettingsUrl: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <Settings className="size-4" />
          Manage
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <QbLink href={qbUrl}>Customization</QbLink>
        <QbLink href={qbUrl}>Payment options</QbLink>
        <QbLink href={qbUrl}>Design</QbLink>
        <QbLink href={qbUrl}>Scheduling</QbLink>
        <DropdownMenuSeparator />
        <QbLink href={qbSettingsUrl}>Edit default settings</QbLink>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InvoiceFooterBar({
  invoiceId,
  docNumber,
  studentNumber,
  qbUrl,
  qbCreditMemoUrl,
  copy,
  voidable,
  voidBlocked,
  sendLabel,
  sendBlocked,
}: {
  invoiceId: string;
  docNumber: string | null;
  studentNumber: string;
  qbUrl: string;
  qbCreditMemoUrl: string;
  /** The lines Make a copy carries into Create invoice; null when unreadable. */
  copy: InvoiceCopy | null;
  /** Unpaid and not voided: Void runs here. */
  voidable: boolean;
  /** Why Void must be done in QuickBooks (paid / part-paid), else null. */
  voidBlocked: string | null;
  sendLabel: 'Send' | 'Send again';
  sendBlocked: string | null;
}) {
  const router = useRouter();
  const run = useWriteAction();
  const [confirmVoid, setConfirmVoid] = useState(false);
  const requestId = useRef<string | null>(null);
  const doVoid = useMutation({
    mutationFn: async () => {
      requestId.current ??= crypto.randomUUID();
      try {
        const r = await apiFetch<{
          docNumber: string | null;
          warnings: string[];
        }>(
          `/api/billing/invoices/${encodeURIComponent(invoiceId)}/void`,
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
  const name = docNumber ? `invoice ${docNumber}` : 'this invoice';

  return (
    <footer className="shrink-0 border-t border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <span aria-hidden className="hidden w-48 lg:block" />
        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost">Print or download</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48">
              <DropdownMenuItem asChild>
                <a
                  href={invoicePdfHref(invoiceId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Print
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void downloadInvoicePdfs([{ id: invoiceId, docNumber }])
                }
              >
                Download
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild variant="ghost">
            <a href={qbUrl} target="_blank" rel="noreferrer">
              Make recurring
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost">
                More actions
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-60">
              <DropdownMenuItem
                disabled={!copy}
                onSelect={() => {
                  if (!copy) return;
                  stashInvoiceCopy(studentNumber, copy);
                  router.push(
                    `/billing/${encodeURIComponent(studentNumber)}?new=invoice`
                  );
                }}
              >
                Make a copy
              </DropdownMenuItem>
              <QbLink href={qbCreditMemoUrl}>Create a credit memo</QbLink>
              <QbLink href={qbUrl}>Delete</QbLink>
              <QbLink href={qbUrl}>Create shipping label</QbLink>
              {voidable ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setConfirmVoid(true)}
                >
                  Void
                </DropdownMenuItem>
              ) : voidBlocked ? (
                <QbLink href={qbUrl}>Void</QbLink>
              ) : null}
              <QbLink href={qbUrl}>Transaction journal</QbLink>
              <DropdownMenuItem asChild>
                <a href="#invoice-activity">Audit history</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a href={qbUrl} target="_blank" rel="noreferrer">
              Edit in QuickBooks
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <div className="flex items-center">
            <SendInvoiceButton
              qboInvoiceId={invoiceId}
              label={sendLabel}
              disabledReason={sendBlocked}
              variant="default"
              className="rounded-r-none"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  aria-label="More ways to send"
                  className="rounded-l-none border-l border-white/25"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <a
                    href={invoicePdfHref(invoiceId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print or preview
                  </a>
                </DropdownMenuItem>
                <QbLink href={qbUrl}>Share invoice link</QbLink>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              QuickBooks keeps the invoice but sets its amounts to zero, and the
              parents no longer owe it. The student&rsquo;s Registration / Fees
              stage is worked out again without it. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                run(() => doVoid.mutateAsync(), {
                  pending: 'Voiding in QuickBooks…',
                  success: (d) => {
                    for (const w of d.warnings) toast.warning(w);
                    return d.docNumber
                      ? `Invoice ${d.docNumber} voided`
                      : 'Invoice voided';
                  },
                })
              }
            >
              Void
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </footer>
  );
}
