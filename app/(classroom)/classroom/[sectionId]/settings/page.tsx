import { notFound, redirect } from 'next/navigation';

import { ClassroomSettingsForm } from '@/components/classroom/classroom-settings-form';
import { getClassroomNote, loadClassroomAccess } from '@/lib/classroom/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Settings — the two Phase 6 preferences, and nothing policy-shaped (no
// grading/attendance/lock/ranking behaviour lives here — see the design
// spec's "Explicitly NOT built" table). Every capability may open this tab:
// the student-order preference is a personal display toggle, and the note
// is scoped to the caller's OWN row by RLS (migration 094), so there is
// nothing here a subject-teacher viewer could see that they shouldn't.
export default async function ClassroomSettingsPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  // The one role in force — see the section layout for the full note.
  const view = await getSessionUser();
  if (!view) redirect('/login');
  const { id: userId, role } = view;

  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  // Unreachable today — the layout refuses this first. Kept as the tab's own
  // gate so a future change to the layout cannot quietly open it.
  if (!capability) notFound();

  // Cookie-scoped client, deliberately — RLS (migration 094) is what
  // guarantees this only ever returns the CALLER's own note, not a service
  // client with a manual filter. See lib/classroom/queries.ts::getClassroomNote.
  const supabase = await createClient();
  const note = await getClassroomNote(supabase, sectionId);

  return (
    <div className="space-y-6">
      <ClassroomSettingsForm
        sectionId={sectionId}
        initialContent={note?.content ?? ''}
      />
    </div>
  );
}
