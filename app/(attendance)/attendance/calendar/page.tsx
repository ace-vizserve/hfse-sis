import { redirect } from 'next/navigation';

// Calendar admin moved to SIS Admin (2026-04-22). This stub redirects legacy
// deep links to the new home at /sis/calendar. The old path stays in
// ROUTE_ACCESS so the gate fires before the redirect — teachers hitting
// a stale bookmark get the same denial they used to.
export default async function LegacyAttendanceCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ term_id?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.term_id ? `?term_id=${encodeURIComponent(sp.term_id)}` : '';
  redirect(`/sis/calendar${qs}`);
}
