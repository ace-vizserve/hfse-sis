import { notFound, redirect } from 'next/navigation';

import { ClassroomSettingsForm } from '@/components/classroom/classroom-settings-form';
import { getViewContext } from '@/lib/auth/view-context';
import { getClassroomNote, loadClassroomAccess } from '@/lib/classroom/queries';
import { createClient } from '@/lib/supabase/server';

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
