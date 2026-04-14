import { redirect } from 'next/navigation';

// The former admin tool-launcher page has been merged into the root `/`
// dashboard. This redirect preserves any existing /admin bookmarks and keeps
// the single-dashboard mental model — everything an admin needs now lives on
// `/`, gated by role. Nested admin routes (/admin/sections, /admin/admissions,
// /admin/sync-students, /admin/audit-log) are unaffected.
export default function AdminRedirect() {
  redirect('/');
}
