import { redirect } from 'next/navigation';

// Legacy /admin bookmark. The Admissions Dashboard was consolidated into the
// Records dashboard — every admissions widget (pipeline, funnel, outdated,
// assessment, referral, time-to-enroll) now renders inside /records alongside
// the internal stage pipeline + document backlog. Send legacy traffic there.
export default function AdminRedirect() {
  redirect('/records');
}
