'use client';

import Link from 'next/link';

import { HoverHint } from '@/components/ui/hover-hint';
import {
  ASSIGNMENT_ROLE_LABELS,
  type AssignmentRole,
} from '@/lib/schemas/teacher-assignment';
import { cn } from '@/lib/utils';

/**
 * Assignment chips, split out of `staff-visuals.tsx`.
 *
 * `staff-visuals` is dual-use: its avatars and role chips are rendered from
 * server components (`account/about-card`, `sections/adviser-cell`,
 * `classroom/classroom-staff-panel`) as well as client ones. Marking that
 * whole module `'use client'` — which the chips need, because their hints are
 * a Radix tooltip — would have pulled it into the browser bundle on those
 * server surfaces too.
 *
 * Splitting costs nothing here: `AssignmentChips` and `assignmentSummaryText`
 * are imported only by `staff-table.tsx` and `staff-accounts-client.tsx`, both
 * already client components. The chips also carry `onClick` handlers, so they
 * could never have been rendered from a server component in the first place.
 */

export type AssignmentChipAdviser = {
  assignmentId: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
  role: AssignmentRole;
};

export type AssignmentChipSubject = {
  assignmentId: string;
  subjectCode: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
  role: AssignmentRole;
};

// A co-adviser and a co-teacher hold the class as genuinely as the primary
// does, so the chip keeps its colour — amber for advising, muted for a
// subject — and says "CO" rather than changing tone.
//
// ⚠ Deliberately NOT a filled-vs-hollow treatment. That pairing already means
// something else here: `lib/relief/display.ts` uses filled amber for "covering
// now" and hollow amber for "booked but holding nothing". Reusing it for co
// roles would make one visual answer two unrelated questions.
function CoPrefix({ role }: { role: AssignmentRole }) {
  if (role !== 'co_adviser' && role !== 'co_teacher') return null;
  return (
    <>
      CO<span className="opacity-50">&thinsp;·&thinsp;</span>
    </>
  );
}

/**
 * The same assignments as plain words.
 *
 * The chips are a picture — a `cell` with no accessor — so anything that needs
 * TEXT (the CSV export, the Accounts tab's search) has to build it separately,
 * and building it twice is how the two drifted apart before. Spells the co
 * roles out rather than using the chip's compact "CO" marker: someone typing
 * "co-teacher" into a search box should find them, and a spreadsheet column
 * reading "CO · ENG" would need the reader to know the chip convention.
 */
export function assignmentSummaryText(
  adviserSections: AssignmentChipAdviser[],
  subjectAssignments: AssignmentChipSubject[]
): string {
  if (adviserSections.length === 0 && subjectAssignments.length === 0)
    return 'No assignments';
  const parts: string[] = [];
  for (const a of adviserSections) {
    const label = a.role === 'co_adviser' ? 'Co-adviser' : 'FCA';
    parts.push(`${label}: ${a.levelCode} ${a.sectionName}`);
  }
  for (const s of subjectAssignments) {
    const prefix = s.role === 'co_teacher' ? 'Co-teacher ' : '';
    parts.push(`${prefix}${s.subjectCode}: ${s.levelCode} ${s.sectionName}`);
  }
  return parts.join('; ');
}

export function AssignmentChips({
  adviserSections,
  subjectAssignments,
  maxSubjects = 3,
  align = 'start',
  className,
}: {
  adviserSections: AssignmentChipAdviser[];
  subjectAssignments: AssignmentChipSubject[];
  maxSubjects?: number;
  // Alignment of the chip row within its container — 'start' matches a
  // left-aligned column header (StaffTable's "Assignments" cell); 'end' is
  // for a trailing chip cluster in a right-flushed row layout. Was
  // hardcoded to justify-end; made a prop so each caller can match its own
  // layout instead of inheriting the first caller's assumption.
  align?: 'start' | 'end';
  className?: string;
}) {
  const hasAny = adviserSections.length > 0 || subjectAssignments.length > 0;
  if (!hasAny) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md border border-hairline bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground',
          className
        )}
      >
        No assignments
      </span>
    );
  }

  const visible = subjectAssignments.slice(0, maxSubjects);
  const extra = subjectAssignments.length - visible.length;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1',
        align === 'end' ? 'justify-end' : 'justify-start',
        className
      )}
    >
      {adviserSections.map((a) => (
        <HoverHint
          key={a.assignmentId}
          hint={`${ASSIGNMENT_ROLE_LABELS[a.role]} — ${a.levelCode} ${a.sectionName}`}
          focusable={false}
        >
          <Link
            href={`/sis/sections/${a.sectionId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center rounded-md border border-brand-amber/30 bg-brand-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-amber transition-opacity hover:opacity-80"
          >
            <CoPrefix role={a.role} />
            FCA&thinsp;·&thinsp;{a.sectionName}
          </Link>
        </HoverHint>
      ))}
      {visible.map((a) => (
        <HoverHint
          key={a.assignmentId}
          hint={`${ASSIGNMENT_ROLE_LABELS[a.role]} — ${a.subjectCode} ${a.levelCode} ${a.sectionName}`}
          focusable={false}
        >
          {/* Section identity, not level — two sections of the same level
              (HFSE runs 2-3 per level) otherwise render byte-identical chips
              for a teacher taking the same subject in each (e.g. two "ENG P3"
              chips with no way to tell them apart). The section name is the
              virtue name (short, e.g. "Obedience"), matching the pre-makeover
              cell's "ENG · Obedience" format. */}
          <Link
            href={`/sis/sections/${a.sectionId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center rounded-md border border-hairline bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-opacity hover:opacity-80"
          >
            <CoPrefix role={a.role} />
            {a.subjectCode}&thinsp;·&thinsp;{a.sectionName}
          </Link>
        </HoverHint>
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          +{extra} more
        </span>
      )}
    </div>
  );
}
