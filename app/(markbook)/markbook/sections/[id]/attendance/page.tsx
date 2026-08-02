import { redirect } from 'next/navigation';

// Superseded by the Classroom module's Attendance tab, exactly as this route's
// parent (`/markbook/sections/[id]`) was — that stub landed in Phase 7 of the
// classroom design doc and this sub-route was simply missed at the time.
//
// It is retired rather than guarded. The page it replaced had NO session or
// role check of any kind (only `if (!section) notFound()`) while sitting under
// the `/markbook` prefix, which admits `teacher` — so it was an unguarded
// surface, and it rendered every student's name as a link to
// `/records/students/...`, which is registrar-and-above and would have bounced
// the very teachers who could open the page. Nothing in the app linked here
// any more (its own "Back" link pointed at the parent redirect stub), so
// deleting the surface fixes both problems without preserving dead UI.
//
// The Classroom tab is scope-aware where this page was not: `canReadAttendance`
// admits adviser + oversight only, mirroring `is_adviser_for_section` in
// migration 005. A subject teacher who could previously open this page and see
// empty rows now gets a 404, which is the honest answer.
//
// The term is dropped deliberately: this page took `?term_id=`, but the
// Classroom tab resolves its own term via `resolveSelectedTermId`, and a
// stale bookmarked term id from another AY would resolve to nothing there.
export default async function SectionAttendanceRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/classroom/${id}/attendance`);
}
