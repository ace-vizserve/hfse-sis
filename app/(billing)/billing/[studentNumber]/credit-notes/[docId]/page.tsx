import { SalesDocView } from '@/components/billing/sales-doc-view';

// One credit note (QuickBooks' CreditMemo), read live from QuickBooks.
export default function BillingCreditNotePage({
  params,
}: {
  params: Promise<{ studentNumber: string; docId: string }>;
}) {
  return <SalesDocView kind="credit_memo" params={params} />;
}
