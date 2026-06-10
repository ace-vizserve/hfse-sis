import { redirect } from 'next/navigation';

// Admissions "Compare" was replaced by the purpose-driven Insights surface
// (Enrollment Health) — spec docs/superpowers/specs/2026-06-10-module-insights-design.md.
// Old links/bookmarks land on Insights. The compare params don't map across,
// so we redirect to the bare insights route.
export default function AdmissionsCompareRedirect() {
  redirect('/admissions/insights');
}
