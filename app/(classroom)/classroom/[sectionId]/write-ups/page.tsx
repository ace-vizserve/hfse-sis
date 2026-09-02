import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight, MessageSquare } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StudentRecordLink } from '@/components/ui/student-record-link';
import { canOpenStudentRecord, canReadWriteups } from '@/lib/classroom/scope';
import { getTermsForAy, loadClassroomAccess } from '@/lib/classroom/queries';
import { resolveSelectedTermId } from '@/lib/classroom/terms';
import { isWriteupComplete } from '@/lib/classroom/writeups';
import { isEmptyRichText } from '@/lib/rich-text';
import { getSectionRoster } from '@/lib/evaluation/queries';
import { wrongViewNoticeOrNotFound } from '@/components/auth/wrong-view-notice';
import { ROLE_LABEL } from '@/lib/auth/role-labels';
import { getViewContext } from '@/lib/auth/view-context';
import { createClient } from '@/lib/supabase/server';

// Write-ups — adviser/oversight only. Belt-and-braces: this page checks
// canReadWriteups ITSELF (see lib/classroom/queries.ts and the attendance
// page's identical note — getSectionRoster reads via the service client,
// which bypasses RLS).
//
// Counting rule (KD #120/#126): a write-up counts as done only when
// `submitted === true` AND the content is non-empty — see
// lib/classroom/writeups.ts::isWriteupComplete, which is the single
// predicate this page's "N of M" figure is built from.
//
// T4 has no FCA write-up at all (KD #49) — rather than a misleading 0-of-N
// bar, that case gets its own plain message and no roster/progress render.
export default async function ClassroomWriteupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ term_id?: string }>;
}) {
  const { sectionId } = await params;
  const sp = await searchParams;

  // `activeRole`, not `role` — a page renders through the lens. See the
  // section layout for the full note.
  const view = await getViewContext();
  if (!view) redirect('/login');
  const { id: userId, activeRole } = view;

  const { capability, substantiveCapability } = await loadClassroomAccess(
    activeRole,
    userId,
    sectionId
  );
  // substantiveCapability, not capability: write-ups stay with the regular
  // adviser while they are away, so a substitute covering this class is turned
  // away here even though they can take its attendance and enter its marks.
  //
  // ⚠ REACHABLE past the layout, for two different people: a subject teacher on
  // this class, and a substitute covering its adviser. Both pass the layout's
  // "any capability" floor. For anyone holding a second view that is a setting
  // rather than a dead end (role-switcher Phase 3c).
  if (!capability || !canReadWriteups(substantiveCapability)) {
    return wrongViewNoticeOrNotFound({
      view,
      heading: 'The form adviser writes these.',
      body: `You're viewing as ${ROLE_LABEL[view.activeRole!]}, and this class's write-ups stay with its own form adviser — including while somebody else is covering the class.`,
      backHref: `/classroom/${sectionId}`,
      backLabel: 'Back to the class',
    });
  }

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
  const isT4 = selectedTerm?.term_number === 4;

  const evaluationHref = `/evaluation/sections/${sectionId}${
    selectedTermId ? `?term_id=${selectedTermId}` : ''
  }`;

  if (isT4) {
    return (
      <div className="space-y-4">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Write-ups
        </h2>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <p>
            Term 4 doesn&rsquo;t carry a form-class adviser comment — the final
            report card has no write-up section.
          </p>
        </div>
      </div>
    );
  }

  const roster = selectedTermId
    ? await getSectionRoster(sectionId, selectedTermId)
    : [];
  const completedCount = roster.filter(isWriteupComplete).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Write-ups
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
            {roster.length > 0
              ? `${completedCount} of ${roster.length} submitted`
              : ''}
          </span>
        </h2>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={evaluationHref}>
            <MessageSquare className="h-4 w-4" />
            Open in Evaluation
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>

      {!selectedTermId ? (
        <EmptyPanel text="No term configured for this academic year." />
      ) : roster.length === 0 ? (
        <EmptyPanel text="No students on the roster yet." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {roster.map((r) => {
            const done = isWriteupComplete(r);
            // Asked on the writing, not the string. The write-up is composed
            // in a formatting editor, so an adviser who opened a student's box
            // and typed nothing leaves an empty paragraph behind — truthy, and
            // seven characters long. This row would have read "Draft" for a
            // student nobody has started.
            const hasDraft = !done && !isEmptyRichText(r.writeup);
            return (
              <div
                key={r.section_student_id}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {r.index_number}
                  </span>
                  <StudentRecordLink
                    studentNumber={r.student_number}
                    canOpen={canOpenStudentRecord(capability)}
                  >
                    {r.student_name}
                  </StudentRecordLink>
                </div>
                {done ? (
                  <Badge variant="success">Submitted</Badge>
                ) : hasDraft ? (
                  <Badge variant="warning">Draft</Badge>
                ) : (
                  <Badge variant="secondary">Not started</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
