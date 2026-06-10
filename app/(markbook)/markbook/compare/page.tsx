import { redirect } from 'next/navigation';

// Markbook "Compare" was replaced by the Academic Performance Insights surface —
// spec docs/superpowers/specs/2026-06-10-module-insights-design.md.
// Old links/bookmarks land on Insights.
export default function MarkbookCompareRedirect() {
  redirect('/markbook/insights');
}
