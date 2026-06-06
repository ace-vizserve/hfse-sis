import { redirect } from 'next/navigation';

// The Masterfile surface moved to the Records module and was renamed
// "Academic Summary" (now at /records/academic-summary). This stub preserves
// existing deep-links/bookmarks by forwarding the query params (level / class /
// ay) on to the new location. ROUTE_ACCESS still gates /markbook/masterfile to
// registrar/school_admin/superadmin so allowed roles reach this redirect.
export default async function MasterfileRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['level', 'class', 'ay'] as const) {
    const value = sp[key];
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (value != null) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  redirect(`/records/academic-summary${query ? `?${query}` : ''}`);
}
