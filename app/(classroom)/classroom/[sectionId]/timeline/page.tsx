import { notFound, redirect } from 'next/navigation';

import { ClassroomTimeline } from '@/components/classroom/classroom-timeline';
import {
  getClassroomTimeline,
  loadClassroomAccess,
} from '@/lib/classroom/queries';
import { TIMELINE_ROW_LIMIT } from '@/lib/classroom/timeline';
import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import { getViewContext } from '@/lib/auth/view-context';
import { sgToday } from '@/lib/dates';

// Timeline — "what happened in this class," a filtered view of audit_log.
// Every capability may open this tab (Phase 5 brief) — unlike Attendance and
// Write-ups, the data here is not gated by is_adviser_for_section, so there
// is no canReadX check to re-run beyond "does this viewer have a capability
// on this section at all." See lib/classroom/queries.ts::getClassroomTimeline
// for how the query is scoped to this section, and lib/classroom/timeline.ts
// for what is deliberately excluded (per-mark attendance) and why.
//
// This page is a thin shell: fetch, resolve actor names, hand off. The
// grouping and run-collapsing rules live in lib/classroom/timeline.ts (pure,
// unit-tested) and the rendering in components/classroom/classroom-timeline.tsx.
export default async function ClassroomTimelinePage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  // `activeRole`, not `role` — a page renders through the lens. See the
  // section layout for the full note.
  const view = await getViewContext();
  if (!view) redirect('/login');
  const { id: userId, activeRole } = view;

  const { capability } = await loadClassroomAccess(
    activeRole,
    userId,
    sectionId
  );
  if (!capability) notFound();

  const [rows, staffEntries] = await Promise.all([
    getClassroomTimeline(sectionId),
    // audit_log stores the actor's EMAIL, which is what the page used to print
    // — the same address on forty consecutive rows. Resolve it to the display
    // name the rest of the app shows; the map is cached (lib/auth/staff-list.ts)
    // and an unknown email falls back to itself in the component.
    getStaffDisplayEntries(),
  ]);

  const actorNames = Object.fromEntries(staffEntries);

  return (
    <ClassroomTimeline
      events={rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actor_email,
        context: r.context,
        createdAt: r.created_at,
      }))}
      actorNames={actorNames}
      // Resolved server-side so "Today" can't disagree with the SGT day the
      // grouping used — deriving it in the browser would put a user in another
      // timezone on a different day to the headings.
      todaySg={sgToday()}
      limit={TIMELINE_ROW_LIMIT}
    />
  );
}
