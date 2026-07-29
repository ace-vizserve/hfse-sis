import { redirect } from 'next/navigation';

// This section-detail page was superseded by the Classroom module's class
// page (design doc 2026-07-28-classroom-workspace-design.md, Phase 7) — the
// classroom page is its evolution: same roster + stat cards + cross-module
// links, plus scope-aware Attendance/Grades/Write-ups/Students sub-routes and
// setup-state signals this page never had. This stub preserves existing
// deep-links/bookmarks. It never took query params (verified — no
// `searchParams` in the prior implementation), so there is nothing to
// forward. ROUTE_ACCESS still gates `/markbook` broadly (teacher and up), so
// every role that could reach this page can reach the redirect target too
// (`/classroom` allows teacher | academic_coordinator | school_admin |
// superadmin — a superset of every role Markbook's own gate allows).
//
// The three module SECTION-LIST pages (`/markbook/sections`,
// `/attendance/sections`, `/evaluation/sections`) are deliberately NOT
// redirected — they stay alive as a fallback per the design doc: "Retire the
// three list pages only after the classroom list demonstrably covers their
// use." Only this per-section DETAIL page was genuinely superseded.
export default async function SectionRosterRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/classroom/${id}`);
}
