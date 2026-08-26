import { redirect } from 'next/navigation';

import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getSessionUser } from '@/lib/supabase/server';

// One teacher — everything they hold in a given year, and who is standing in on
// any of it.
//
// This exists because a teacher's classes previously lived only inside a
// slide-out drawer on the staff table: no address of its own, so it could not
// be linked, bookmarked or sent to anyone. The drawer stays for quick edits
// from the table; the page beneath this is the durable view.
//
// ⚠ THIS LAYOUT IS THE CAPABILITY GUARD AND NOTHING ELSE. It used to render the
// header and the three stat cards as well, which was fine while the page always
// meant "the current year". It stopped being fine when the year became a
// choice: a Next.js layout does not receive `searchParams`, so it could not see
// `?ay=` and would have gone on describing the current year above a page
// describing AY2025 — a header and its own content disagreeing, which is worse
// than either being wrong alone. The chrome moved down into the page, where the
// selected year is known.
//
// The guard stays here because it applies to every route beneath, present and
// future, and a URL can be typed.
export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser?.role) redirect('/login');

  const capabilities = await getCapabilitiesForRole(sessionUser.role);
  // The parent layout already refused anyone below academic_coordinator. This
  // is the capability the page's own data turns on.
  if (!can(capabilities, 'staff.read')) redirect('/sis');

  return <>{children}</>;
}
