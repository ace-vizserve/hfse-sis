import { redirect } from 'next/navigation';

// P-Files "Compare" has been retired — Evaluation and P-Files are
// dashboard-only modules (no Insights surface). Old links/bookmarks
// redirect to the P-Files dashboard.
export default function PFilesCompareRedirect() {
  redirect('/p-files');
}
