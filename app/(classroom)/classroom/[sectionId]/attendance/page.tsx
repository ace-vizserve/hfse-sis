import { notFound, redirect } from 'next/navigation';

import { SectionSummaryCard } from '@/components/attendance/section-summary-card';
import { getSectionAttendanceSummary } from '@/lib/attendance/queries';
import { canReadAttendance } from '@/lib/classroom/scope';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Attendance — adviser/oversight only. Belt-and-braces: this page checks
// canReadAttendance ITSELF (not just the layout, which only asserts "any
// capability at all" — see lib/classroom/queries.ts). getSectionAttendanceSummary
// reads via the service client, which bypasses RLS, so this check is the
// real security boundary for a subject teacher typing this URL directly.
//
// Deliberately no embedded grid — the marking sheet assumes full viewport
// width (sticky columns, marking palette, up to 50 students). This is a
// summary + a link to the real writer at /attendance/[sectionId].
//
// The card itself is shared with the Markbook section page — see
// components/attendance/section-summary-card.tsx for what it says and why.
export default async function ClassroomAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  // The one role in force — see the
  // section layout for the full note; the shape is identical on every
  // classroom tab.
  const view = await getSessionUser();
  if (!view) redirect('/login');
  const { id: userId, role } = view;

  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  // ⚠ REACHABLE, unlike the `!capability` gate the layout answers first: a
  // viewer holding only `subject` capability on this class PASSES the layout
  // and is turned away here — a teacher who teaches a subject in a class she
  // does not advise. Attendance belongs to the form adviser.
  if (!capability || !canReadAttendance(capability)) notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from('sections')
    .select('id, academic_year_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) notFound();

  const terms = await getTermsForAy(section.academic_year_id);
  const selectedTermId = resolveSelectedTermId(terms, sp.term_id);
  const selectedTerm = terms.find((t) => t.id === selectedTermId) ?? null;

  const summary = selectedTermId
    ? await getSectionAttendanceSummary(sectionId, selectedTermId)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Attendance summary
        </h2>
        {selectedTerm && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {selectedTerm.label}
          </span>
        )}
      </div>

      {!summary ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No term configured for this academic year.
        </div>
      ) : (
        <SectionSummaryCard
          summary={summary}
          termLabel={selectedTerm?.label ?? null}
          href={`/attendance/${sectionId}${
            selectedTermId ? `?term_id=${selectedTermId}` : ''
          }`}
          linkLabel="Open the attendance sheet"
        />
      )}
    </div>
  );
}
