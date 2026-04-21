import { redirect } from 'next/navigation';

// Legacy /admin/admissions bookmark. The admissions dashboard was consolidated
// into the Records dashboard (/records) — every widget that used to live here
// (pipeline counts, conversion funnel, outdated applications, applications by
// level, document completion, assessment outcomes, referral sources, avg
// time-to-enroll) now renders inside /records alongside the internal stage
// pipeline + doc backlog + expiring docs + activity feed. One consolidated
// dashboard instead of two overlapping ones.
export default function AdmissionsRedirect() {
  redirect('/records');
}
