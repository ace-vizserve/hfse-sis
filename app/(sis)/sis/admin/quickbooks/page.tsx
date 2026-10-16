import { redirect } from 'next/navigation';

// The QuickBooks connection moved to Billing → Settings (Billing Phase 5).
// Kept as a redirect so old links and bookmarks still land somewhere useful;
// the `/sis/admin/quickbooks` ROUTE_ACCESS row keeps it superadmin-only.
export default async function QuickBooksAdminRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    )
  ).toString();
  redirect(`/billing/settings${params ? `?${params}` : ''}`);
}
