// `notFound` is no longer imported here: the refusal below goes through
// `wrongViewNoticeOrNotFound`, which throws it on the no-second-view path.
import { redirect } from 'next/navigation';

import { wrongViewNoticeOrNotFound } from '@/components/auth/wrong-view-notice';
import { ClassroomSettingsForm } from '@/components/classroom/classroom-settings-form';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
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
  // Unreachable today — the layout refuses this first. Converted with its six
  // siblings so the Classroom tabs answer a wrong view the same way; see
  // `wrongViewNoticeOrNotFound` for why all seven moved together.
  if (!capability) {
    return wrongViewNoticeOrNotFound({
      view,
      heading: 'Not one of your classes.',
      body: `You're viewing as ${ROLE_LABEL[view.activeRole!]}, and this isn't a class you teach or advise.`,
      backHref: '/classroom',
      backLabel: 'Back to your classes',
    });
  }

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
