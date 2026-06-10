import { redirect } from 'next/navigation';

// Records "Compare" was replaced by the purpose-driven Insights surface
// (Retention & Population) — spec docs/superpowers/specs/2026-06-10-module-insights-design.md.
// Old links/bookmarks land on Insights.
export default function RecordsCompareRedirect() {
  redirect('/records/insights');
}
