import { redirect } from 'next/navigation';

// Discount-code catalogue moved to SIS Admin (2026-04-22). This stub
// redirects legacy deep links to the new home at
// /sis/admin/discount-codes. The old path stays in ROUTE_ACCESS so the
// gate fires before the redirect.
export default async function LegacyRecordsDiscountCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.ay ? `?ay=${encodeURIComponent(sp.ay)}` : '';
  redirect(`/sis/admin/discount-codes${qs}`);
}
