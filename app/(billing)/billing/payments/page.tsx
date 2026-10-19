import { redirect } from 'next/navigation';

// Payments live in Sales transactions, as in QuickBooks.
export default function BillingPaymentsPage() {
  redirect('/billing/sales?type=payments');
}
