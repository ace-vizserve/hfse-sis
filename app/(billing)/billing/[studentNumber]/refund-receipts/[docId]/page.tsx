import { SalesDocView } from '@/components/billing/sales-doc-view';

// One refund receipt, read live from QuickBooks.
export default function BillingRefundReceiptPage({
  params,
}: {
  params: Promise<{ studentNumber: string; docId: string }>;
}) {
  return <SalesDocView kind="refund_receipt" params={params} />;
}
