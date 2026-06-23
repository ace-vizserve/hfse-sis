import { redirect } from 'next/navigation';

// Evaluation "Compare" has been retired — Evaluation and P-Files are
// dashboard-only modules (no Insights surface). Old links/bookmarks
// redirect to the Evaluation dashboard.
export default function EvaluationCompareRedirect() {
  redirect('/evaluation');
}
