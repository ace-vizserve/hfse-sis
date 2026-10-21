'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Pencil, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  CreateInvoiceSheet,
  type InvoiceEdit,
} from '@/components/billing/create-invoice-sheet';
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
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  stashCreditNoteStart,
  stashInvoiceCopy,
  type CreditNoteStart,
  type InvoiceCopy,
} from '@/lib/billing/invoice-copy';
import { shouldRenewAfter } from '@/lib/billing/request-id';
import type { StageTarget } from '@/lib/billing/tie';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// The invoice page's actions, with QuickBooks' menus item for item: Edit
// invoice, Print ▾, More actions ▾ and Send ▾. What the SIS can do for a
// linked student's invoice runs here (Edit an open invoice, Print / Download
// PDF, Make a copy, Void an unpaid invoice, Send); the rest opens the invoice
// in QuickBooks, where QuickBooks does it (Delete, recurring, credit memos,
// the invoice form's setup).

const QbLink = ({ href, children }: { href: string; children: string }) => (
  <DropdownMenuItem asChild>
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
    </a>
  </DropdownMenuItem>
);

export function InvoiceScreenActions({
  invoiceId,
  docNumber,
  studentNumber,
  qbUrl,
  creditNote,
  qbSettingsUrl,
  qbCompanyUrl,
  copy,
  voidable,
  voidBlocked,
  sendLabel,
  sendBlocked,
  edit,
  studentName,
  customerEmail,
  stage,
}: {
  invoiceId: string;
  docNumber: string | null;
  studentNumber: string;
  /** Edit invoice's starting point; null when it can't be edited here. */
  edit: InvoiceEdit | null;
  studentName: string;
  customerEmail: string | null;
  /** The Registration / Fees stage this invoice fills, if any. */
  stage: StageTarget | null;
  qbUrl: string;
  /** "Create a credit note" (QuickBooks' More actions): this invoice's
   *  lines and statement message start the Credit note form; null when the
   *  invoice can't be read or is voided. */
  creditNote: CreditNoteStart | null;
  /** QuickBooks' Sales settings (the invoice form's defaults). */
  qbSettingsUrl: string;
  /** QuickBooks' Company settings (the name and address on the invoice). */
  qbCompanyUrl: string;
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
  // Kept once an attempt was unclear: see shouldRenewAfter.
  const unclearRef = useRef(false);
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
        unclearRef.current = false;
        return r;
      } catch (err) {
        if (shouldRenewAfter(err, unclearRef)) requestId.current = null;
        throw err;
      }
    },
  });
  const name = docNumber ? `invoice ${docNumber}` : 'this invoice';
  // Each open starts from the invoice as the page last read it (a new key);
  // the sheet stays mounted when it closes, so its save can finish the
  // page refresh it started.
  const [editKey, setEditKey] = useState(0);
  const [editing, setEditing] = useState(false);

  return (
    <>
      {edit && (
        <Button
          variant="outline"
          onClick={() => {
            setEditKey((k) => k + 1);
            setEditing(true);
          }}
        >
          <Pencil className="size-4" />
          Edit invoice
        </Button>
      )}
      {edit && editKey > 0 && (
        <CreateInvoiceSheet
          key={`e${editKey}-${edit.syncToken}`}
          open={editing}
          onOpenChange={setEditing}
          studentNumber={studentNumber}
          studentName={studentName}
          customerEmail={customerEmail}
          stage={stage}
          existing={[]}
          edit={edit}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Printer className="size-4" />
            Print
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
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
            Download PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            More actions
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
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
          <DropdownMenuItem
            disabled={!creditNote}
            onSelect={() => {
              if (!creditNote) return;
              stashCreditNoteStart(studentNumber, creditNote);
              router.push(
                `/billing/${encodeURIComponent(studentNumber)}?new=credit-note&from=invoice`
              );
            }}
          >
            Create a credit note
          </DropdownMenuItem>
          {voidable && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmVoid(true)}
            >
              Void
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href="#invoice-activity">Audit history</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            In QuickBooks
          </DropdownMenuLabel>
          <QbLink href={qbUrl}>Open in QuickBooks</QbLink>
          <QbLink href={qbUrl}>Make recurring</QbLink>
          {voidBlocked && <QbLink href={qbUrl}>Void</QbLink>}
          <QbLink href={qbUrl}>Delete</QbLink>
          <QbLink href={qbUrl}>Create shipping label</QbLink>
          <QbLink href={qbUrl}>Transaction journal</QbLink>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Invoice form setup</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <QbLink href={qbUrl}>Customization</QbLink>
              <QbLink href={qbUrl}>Payment options</QbLink>
              <QbLink href={qbUrl}>Design</QbLink>
              <QbLink href={qbUrl}>Scheduling</QbLink>
              <DropdownMenuSeparator />
              <QbLink href={qbSettingsUrl}>Edit default settings</QbLink>
              <QbLink href={qbCompanyUrl}>Edit company</QbLink>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <ButtonGroup aria-label="Send">
        <SendInvoiceButton
          qboInvoiceId={invoiceId}
          label={sendLabel}
          disabledReason={sendBlocked}
          variant="outline"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="More ways to send"
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
      </ButtonGroup>

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
    </>
  );
}
