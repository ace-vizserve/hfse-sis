import { redirect } from 'next/navigation';

// Academic Summary → Awards redirect stub (Task 7 of 14).
//
// The Awards quick-view has been relocated to /markbook/awards as a standalone
// three-tier analytics page. This stub preserves existing deep-links and bookmarks
// by forwarding query params (level / class / ay) to the new location.
// ROUTE_ACCESS still gates /records/academic-summary/awards to registrar/school_admin/superadmin.

export default async function AcademicSummaryAwardsRedirect({
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
  redirect(`/markbook/awards${query ? `?${query}` : ''}`);
}
