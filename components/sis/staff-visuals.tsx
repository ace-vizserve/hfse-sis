import Link from 'next/link';

import type { Role } from '@/lib/auth/roles';
import { TABLE_COPY } from '@/lib/copy/data-table';
import {
  ASSIGNMENT_ROLE_LABELS,
  type AssignmentRole,
} from '@/lib/schemas/teacher-assignment';
import { cn } from '@/lib/utils';

/**
 * Staff directory presentational vocabulary — initial-tile avatars, role
 * chips, assignment chips — shared by both cuts of `/sis/admin/staff`
 * (Assignments' `StaffTable` + Accounts' `StaffAccountsClient`), per the SIS
 * Admin visual pass Task V3
 * (`docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html`
 * Screen 2). Solid tints here are NOT the (now-reversed, see
 * `components/sis/hub-stat.tsx`) icon-tile rule — avatars and badges/chips
 * are their own §9.3 pattern, which is flat by design (`Badge
 * className="border-brand-mint bg-brand-mint/30 text-ink"`, never a
 * gradient); only §7.4 icon tiles (CardAction squares, hero/stat/status
 * tiles) use the gradient recipe. Presentation-only: none of these read or
 * write data — callers still own their own queries/mutations.
 */

// ─── Avatar ───────────────────────────────────────────────────────────────

// First letter of the first two whitespace-separated name parts (e.g.
// "Maria T." → "MT", "Joann R." → "JR"). Single-word names fall back to
// their first two characters; empty names render an em dash.
export function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_SIZE_CLASS = {
  8: 'size-8 text-[12px]',
  9: 'size-9 text-[13px]',
  10: 'size-10 text-[14px]',
} as const;

export function StaffAvatar({
  name,
  size = 9,
  className,
}: {
  name: string;
  size?: 8 | 9 | 10;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        // bg-brand-indigo/10 + text-brand-indigo (not the mockup's literal
        // text-brand-navy) — brand-navy is a fixed near-black hex with no
        // .dark override (app/globals.css), so navy text on a translucent
        // tint would go low-contrast in dark mode. text-brand-indigo is the
        // same "indigo" identity, already the established tone-map pairing
        // for bg-brand-indigo/10 in hub-quick-actions.tsx (Task V1).
        'flex shrink-0 items-center justify-center rounded-xl bg-brand-indigo/10 font-serif font-bold text-brand-indigo',
        AVATAR_SIZE_CLASS[size],
        className
      )}
    >
      {staffInitials(name)}
    </div>
  );
}

// ─── Role chip ────────────────────────────────────────────────────────────

// Tone recipes mirror hub-stat.tsx's already-shipped V1 map exactly
// (bg-X/N + text-X for indigo/sky, bg-X/N + text-ink for mint/amber — the
// lighter/brighter colors read poorly as their own text, so they fall back
// to dark ink) rather than inventing a new palette for this pass.
const ROLE_CHIP_TONE: Record<Role, string> = {
  teacher: 'bg-brand-sky/15 text-brand-sky',
  academic_coordinator: 'bg-brand-mint/25 text-ink',
  school_admin: 'bg-brand-indigo/10 text-brand-indigo',
  superadmin: 'bg-brand-indigo/10 text-brand-indigo',
  p_file_officer: 'bg-muted text-muted-foreground',
  admissions: 'bg-muted text-muted-foreground',
};

const ROLE_CHIP_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Academic Coordinator',
  school_admin: TABLE_COPY.schoolAdmin,
  superadmin: 'Superadmin',
  p_file_officer: 'P-File Officer',
  admissions: 'Admissions',
};

export function RoleChip({
  role,
  className,
}: {
  role: Role | null;
  className?: string;
}) {
  if (!role) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground',
          className
        )}
      >
        No role
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold',
        ROLE_CHIP_TONE[role],
        className
      )}
    >
      {ROLE_CHIP_LABEL[role]}
    </span>
  );
}

// ─── Assignment chips ─────────────────────────────────────────────────────

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
        <Link
          key={a.assignmentId}
          href={`/sis/sections/${a.sectionId}`}
          onClick={(e) => e.stopPropagation()}
          title={`${ASSIGNMENT_ROLE_LABELS[a.role]} — ${a.levelCode} ${a.sectionName}`}
          className="inline-flex items-center rounded-md border border-brand-amber/30 bg-brand-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-amber transition-opacity hover:opacity-80"
        >
          <CoPrefix role={a.role} />
          FCA&thinsp;·&thinsp;{a.sectionName}
        </Link>
      ))}
      {visible.map((a) => (
        <Link
          key={a.assignmentId}
          href={`/sis/sections/${a.sectionId}`}
          onClick={(e) => e.stopPropagation()}
          title={`${ASSIGNMENT_ROLE_LABELS[a.role]} — ${a.subjectCode} ${a.levelCode} ${a.sectionName}`}
          // Section identity, not level — two sections of the same level
          // (HFSE runs 2-3 per level) otherwise render byte-identical chips
          // for a teacher taking the same subject in each (e.g. two "ENG P3"
          // chips with no way to tell them apart). The section name is the
          // virtue name (short, e.g. "Obedience"), matching the pre-makeover
          // cell's "ENG · Obedience" format.
          className="inline-flex items-center rounded-md border border-hairline bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-opacity hover:opacity-80"
        >
          <CoPrefix role={a.role} />
          {a.subjectCode}&thinsp;·&thinsp;{a.sectionName}
        </Link>
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          +{extra} more
        </span>
      )}
    </div>
  );
}
