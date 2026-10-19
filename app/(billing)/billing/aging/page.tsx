import { redirect } from 'next/navigation';

// A/R aging now opens as QuickBooks' Accounts receivable aging summary in
// Billing → Reports. Old links (and their ?asOf=) keep working.
export default async function BillingAgingRedirect({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { asOf } = await searchParams;
  redirect(
    asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
      ? `/billing/reports/aging-summary?period=custom&asOf=${asOf}`
      : '/billing/reports/aging-summary'
  );
}
