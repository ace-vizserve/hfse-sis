import { redirect } from 'next/navigation';

import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { getSessionUser } from '@/lib/supabase/server';

// The event builder is a full-screen tool with its own top bar: no SIS sidebar.
// Query client, tooltips and the toaster come from the root layout. The layout
// reads the session, so it blocks (KD #35) and declares it.
export const instant = false;

export default async function EventBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const view = await getSessionUser();
  if (!view) redirect('/login');
  if (
    !view.role ||
    !(ENROLMENT_PLACEMENT_WRITERS as readonly string[]).includes(view.role)
  ) {
    redirect('/');
  }
  return <>{children}</>;
}
