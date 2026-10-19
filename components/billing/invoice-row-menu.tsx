'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The ▾ beside an invoice row's action, as QuickBooks has it: View, Send,
// Print, Download, Receive payment, the customer, and the invoice in
// QuickBooks. Print and Download are QuickBooks' own PDF.

export type MenuInvoice = {
  id: string;
  docNumber: string | null;
  studentNumber: string;
  state: 'open' | 'paid' | 'voided';
  balance: number;
};

export const invoicePageHref = (r: MenuInvoice) =>
  `/billing/${encodeURIComponent(r.studentNumber)}/invoices/${encodeURIComponent(r.id)}`;
export const invoicePdfHref = (id: string, download = false) =>
  `/api/billing/invoices/${encodeURIComponent(id)}/pdf${download ? '?download=1' : ''}`;
export const receivePaymentHref = (r: MenuInvoice) =>
  `/billing/${encodeURIComponent(r.studentNumber)}?new=payment&invoice=${encodeURIComponent(r.id)}`;

/** Saves each invoice's QuickBooks PDF, one after another (QuickBooks'
 *  batch Print). Says how many were saved. */
export async function downloadInvoicePdfs(
  rows: Array<{ id: string; docNumber: string | null }>
) {
  const t = toast.loading(
    rows.length === 1
      ? 'Getting the PDF from QuickBooks…'
      : `Getting ${rows.length} PDFs from QuickBooks…`
  );
  let saved = 0;
  const failed: string[] = [];
  for (const r of rows) {
    try {
      const res = await fetch(invoicePdfHref(r.id, true));
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice ${r.docNumber ?? r.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      saved += 1;
    } catch {
      failed.push(r.docNumber ?? r.id);
    }
  }
  toast.dismiss(t);
  if (saved === 0) toast.error('QuickBooks didn’t give the PDF. Try again.');
  else if (failed.length)
    toast.warning(`${saved} saved · not saved: ${failed.join(', ')}`);
  else toast.success(saved === 1 ? 'PDF saved' : `${saved} PDFs saved`);
}

export function InvoiceRowMenu({
  invoice,
  qbUrl,
  onSend,
  showCustomer = true,
}: {
  invoice: MenuInvoice;
  /** The invoice in QuickBooks. */
  qbUrl: string | null;
  onSend: () => void;
  showCustomer?: boolean;
}) {
  const owing = invoice.state !== 'voided' && invoice.balance > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={`More for ${invoice.docNumber ?? 'this invoice'}`}
        >
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href={invoicePageHref(invoice)}>View</Link>
        </DropdownMenuItem>
        {owing && (
          <DropdownMenuItem asChild>
            <Link href={receivePaymentHref(invoice)}>Receive payment</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={invoice.state === 'voided'}
          onSelect={onSend}
        >
          {owing ? 'Send' : 'Send again'}
        </DropdownMenuItem>
        {owing && (
          <DropdownMenuItem onSelect={onSend}>Send reminder</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={invoicePdfHref(invoice.id)} target="_blank" rel="noreferrer">
            Print
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadInvoicePdfs([invoice])}>
          Download PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {showCustomer && (
          <DropdownMenuItem asChild>
            <Link
              href={`/billing/${encodeURIComponent(invoice.studentNumber)}`}
            >
              Open customer
            </Link>
          </DropdownMenuItem>
        )}
        {qbUrl && (
          <DropdownMenuItem asChild>
            <a href={qbUrl} target="_blank" rel="noreferrer">
              Open in QuickBooks
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
