import { redirect } from 'next/navigation';

// Staff accounts moved into the merged staff directory (SIS Admin IA
// Phase 4, KD #154) — /sis/admin/staff renders both the Accounts cut and
// the pre-existing Assignments cut on one page. This stub redirects legacy
// deep links / bookmarks to the new home. The ROUTE_ACCESS row for this
// prefix stays superadmin-only so the gate fires before the redirect (mirrors
// the discount-codes stub pattern at app/(records)/records/discount-codes).
export default function LegacyUsersAdminPage() {
  redirect('/sis/admin/staff?view=accounts');
}
