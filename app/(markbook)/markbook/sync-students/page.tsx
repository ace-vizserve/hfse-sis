import { redirect } from 'next/navigation';

// Sync from Admissions moved to SIS Admin (2026-04-23) — the action populates
// the shared student identity consumed by every module, not a Markbook-only
// resource (KD #38, #48). This stub preserves bookmarks + legacy deep links.
// Safe to remove after one sprint of zero traffic.
export default function LegacyMarkbookSyncStudentsPage() {
  redirect('/sis/sync-students');
}
