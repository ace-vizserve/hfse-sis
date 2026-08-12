'use client';

// Shared per-row ⋯ actions menu for the SIS / Markbook / Attendance section
// tables (Task 2 of the section-list tables feature, KD #84).
//
// Renders a <RowActionsMenu> (the ⋯ ghost icon-button) with module-appropriate
// items, plus the controlled dialogs mounted OUTSIDE the menu so they survive
// the dropdown's close-on-select without unmounting.
//
// GenerateSheetsDialog wiring:
//   The component supports a fully controlled pattern — when `open` is passed
//   and `children` is omitted, line 118 of generate-sheets-dialog.tsx gates the
//   <AlertDialogTrigger> behind `(children || !isControlled)`, so NO stray
//   default trigger button is rendered. We use open={sheetsOpen}
//   onOpenChange={setSheetsOpen} with no children, which is the cleanest path.

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownAZ,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock,
  FilePlus2,
  Pencil,
  Trash2,
  UserPlus,
  Waypoints,
} from 'lucide-react';

import { GenerateIndexDialog } from '@/components/sis/generate-index-button';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { SectionDeleteDialog } from '@/components/sis/section-delete-dialog';
import { SectionRenameDialog } from '@/components/sis/section-rename-dialog';
import { SectionScheduleDialog } from '@/components/sis/section-schedule-dialog';
import { SectionTrackDialog } from '@/components/sis/section-track-dialog';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { RowActionsMenu } from '@/components/ui/data-table';
import type { Role } from '@/lib/auth/roles';
import {
  canReadAttendance,
  canReadWriteups,
  type ClassroomCapability,
} from '@/lib/classroom/scope';
import type { Schedule, SectionClassType } from '@/lib/schemas/section';

// ─── Props ────────────────────────────────────────────────────────────────────

export type SectionRowActionsProps = {
  /** Which module is rendering this — determines which items appear. */
  module: 'sis' | 'markbook' | 'attendance';
  sectionId: string;
  sectionName: string;
  role: Role | null;
  /** True when the AY's first term has started — escalates the generate-index
   *  warning (KD #136). Only relevant for sis + markbook. */
  termStarted: boolean;
  /** Academic year id, for GenerateSheetsDialog's scope. Only relevant for
   *  sis + markbook (attendance never renders that dialog). */
  ayId?: string;
  /** Attendance only: the href for "Open daily" (e.g. /attendance/[id]?date=…).
   *  Falls back to '#' when omitted. */
  todayHref?: string;
  /** From lib/classroom/scope.ts's resolver (Phase 8, KD #160) — decides the
   *  markbook "Open grading" destination the same way the row's own name link
   *  does, so a row and its overflow menu can't disagree. Optional: falls back
   *  to the role check below, which covers the identical three roles. */
  isOversight?: boolean;
  /** This viewer's capability in THIS section (lib/classroom/scope.ts). Gates
   *  the markbook Attendance / Write-ups cross-links, whose destinations are
   *  adviser-only. Omitted by the sis + attendance callers, which don't render
   *  those items; when absent it falls back to oversight-or-nothing, so a
   *  caller that forgets it hides the items rather than dead-ending a teacher. */
  capability?: ClassroomCapability | null;
  /** This viewer's capability in THIS section IGNORING cover. Gates the
   *  Write-ups cross-link only, whose destination stays with the regular
   *  adviser while a substitute covers the teaching (KD #173 — the link asks
   *  what the page asks). Omitted callers fall back to `capability`, which is
   *  correct for every surface that has no cover to distinguish. */
  substantiveCapability?: ClassroomCapability | null;
  /** SIS only: whether this section already has a form adviser assigned.
   *  Controls the label of the adviser action item. */
  hasAdviser?: boolean;
  /** SIS only: the section's level type — gates the Track item to
   *  Secondary (SectionTrackDialog 422s for Primary) — and its current
   *  class_type, for the dialog's pre-selected value + the item's
   *  Set/Change label. */
  levelType?: 'primary' | 'secondary';
  classType?: SectionClassType | null;
  /** SIS only: the section's current daily schedule, for the Set/Change
   *  Schedule item. Unlike Track this applies to every level, not just
   *  Secondary. */
  schedule?: Schedule | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SectionRowActions({
  module,
  sectionId,
  sectionName,
  role,
  termStarted,
  todayHref,
  isOversight,
  capability,
  substantiveCapability,
  hasAdviser,
  ayId,
  levelType,
  classType,
  schedule,
}: SectionRowActionsProps) {
  const isRegistrarPlus =
    role === 'academic_coordinator' ||
    role === 'school_admin' ||
    role === 'superadmin';

  // Controlled dialog open state — mirrors the AyRowActions pattern in
  // ay-setup-data-table.tsx so the dropdown closes cleanly before the dialog
  // animates open.
  const [indexOpen, setIndexOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Rename/track/delete are structural section management — SIS-only,
  // registrar+ (matches KD #48: SIS Admin is the central config surface).
  const showStructuralItems = module === 'sis' && isRegistrarPlus;
  const showTrackItem = showStructuralItems && levelType === 'secondary';

  // ── Resolve the "Open" destination per module ──────────────────────────────
  // Markbook mirrors the Phase 8 row-level handoff (KD #160) that the name
  // column in markbook/sections-data-table.tsx already implements: oversight
  // stays on Markbook's own filtered sheets list, a teacher goes to the class's
  // Grades tab. This menu previously sent everyone to /markbook/sections/[id],
  // a redirect stub to the class page's OVERVIEW — so the item said "Open
  // grading" and landed you somewhere with no grades on it, while the very same
  // row's name link went to the right place.
  const oversight = isOversight ?? isRegistrarPlus;
  // Fail closed: an omitted capability grants oversight only, never a teacher.
  const effectiveCapability: ClassroomCapability | null =
    capability ?? (oversight ? 'oversight' : null);
  // Write-ups alone asks the substantive question. Callers with no cover to
  // distinguish omit the prop and fall through to the same value as before.
  const effectiveSubstantiveCapability: ClassroomCapability | null =
    substantiveCapability !== undefined
      ? substantiveCapability
      : effectiveCapability;
  const openHref =
    module === 'sis'
      ? `/sis/sections/${sectionId}`
      : module === 'markbook'
        ? oversight
          ? `/markbook/grading?grading.section=${encodeURIComponent(sectionName)}`
          : `/classroom/${sectionId}/grades`
        : (todayHref ?? '#');

  const openLabel =
    module === 'sis'
      ? 'Open roster'
      : module === 'markbook'
        ? 'Open grading'
        : 'Open daily';

  const showGenerateItems =
    (module === 'sis' || module === 'markbook') && isRegistrarPlus;

  return (
    <>
      <RowActionsMenu>
        {/* ── Open (always first) ── */}
        <DropdownMenuItem asChild>
          <Link href={openHref} className="flex items-center gap-2">
            <ArrowRight className="size-4 shrink-0" />
            {openLabel}
          </Link>
        </DropdownMenuItem>

        {/* ── Assign/Change adviser (sis, registrar+) ── */}
        {module === 'sis' && isRegistrarPlus && (
          <DropdownMenuItem asChild>
            <Link
              href={`/sis/sections/${sectionId}?tab=teachers`}
              className="flex items-center gap-2"
            >
              <UserPlus className="size-4 shrink-0" />
              {hasAdviser ? 'Change adviser' : 'Assign adviser'}
            </Link>
          </DropdownMenuItem>
        )}

        {/* ── Markbook cross-links ──
            Both destinations are adviser-only: attendance is
            `is_adviser_for_section` at the DB, and Evaluation excluded subject
            teachers in KD #114. This list is scoped on ANY assignment, so a
            subject-teacher-only row would offer two items that 404. Gated on
            the same per-section predicates the destinations enforce. */}
        {module === 'markbook' && (
          <>
            {canReadAttendance(effectiveCapability) && (
              <DropdownMenuItem asChild>
                <Link
                  href={`/attendance/${sectionId}`}
                  className="flex items-center gap-2"
                >
                  <CalendarDays className="size-4 shrink-0" />
                  Open attendance
                </Link>
              </DropdownMenuItem>
            )}
            {canReadWriteups(effectiveSubstantiveCapability) && (
              <DropdownMenuItem asChild>
                <Link
                  href={`/evaluation/sections/${sectionId}`}
                  className="flex items-center gap-2"
                >
                  <ClipboardList className="size-4 shrink-0" />
                  Open write-ups
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}

        {/* ── Generate index (sis + markbook, registrar+) ── */}
        {showGenerateItems && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setIndexOpen(true);
            }}
          >
            <ArrowDownAZ className="size-4 shrink-0" />
            Generate index
          </DropdownMenuItem>
        )}

        {/* ── Generate sheets (sis + markbook, registrar+) ── */}
        {showGenerateItems && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setSheetsOpen(true);
            }}
          >
            <FilePlus2 className="size-4 shrink-0" />
            Generate sheets
          </DropdownMenuItem>
        )}

        {/* ── Track — Secondary only (sis, registrar+) ── */}
        {showTrackItem && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setTrackOpen(true);
            }}
          >
            <Waypoints className="size-4 shrink-0" />
            {classType ? 'Change track' : 'Set track'}
          </DropdownMenuItem>
        )}

        {/* ── Schedule (sis, registrar+) — every level, unlike Track ── */}
        {showStructuralItems && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setScheduleOpen(true);
            }}
          >
            <Clock className="size-4 shrink-0" />
            {schedule ? 'Change schedule' : 'Set schedule'}
          </DropdownMenuItem>
        )}

        {/* ── Rename (sis, registrar+) ── */}
        {showStructuralItems && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setRenameOpen(true);
            }}
          >
            <Pencil className="size-4 shrink-0" />
            Rename
          </DropdownMenuItem>
        )}

        {/* ── Delete — undo an accidental creation (sis, registrar+) ── */}
        {showStructuralItems && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="size-4 shrink-0" />
              Delete section
            </DropdownMenuItem>
          </>
        )}
      </RowActionsMenu>

      {/* Controlled dialogs — rendered outside the RowActionsMenu so they
          survive the dropdown's unmount on close. Mounted only when the module
          supports them to avoid needless subtree construction. */}
      {showGenerateItems && (
        <>
          <GenerateIndexDialog
            sectionId={sectionId}
            sectionName={sectionName}
            termStarted={termStarted}
            open={indexOpen}
            onOpenChange={setIndexOpen}
          />
          {/* Fully controlled — no children prop, so generate-sheets-dialog.tsx
              suppresses its default trigger button (line 118: the
              AlertDialogTrigger is gated on `children || !isControlled`). */}
          <GenerateSheetsDialog
            scope={{
              kind: 'section',
              sectionId,
              sectionLabel: sectionName,
              ayId: ayId ?? '',
            }}
            open={sheetsOpen}
            onOpenChange={setSheetsOpen}
          />
        </>
      )}

      {/* Structural dialogs — same "mounted outside the menu" reasoning as
          the generate dialogs above. */}
      {showStructuralItems && (
        <>
          <SectionRenameDialog
            sectionId={sectionId}
            currentName={sectionName}
            open={renameOpen}
            onOpenChange={setRenameOpen}
          />
          <SectionDeleteDialog
            sectionId={sectionId}
            sectionName={sectionName}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
        </>
      )}
      {showTrackItem && (
        <SectionTrackDialog
          sectionId={sectionId}
          sectionName={sectionName}
          currentTrack={classType ?? null}
          open={trackOpen}
          onOpenChange={setTrackOpen}
        />
      )}
      {showStructuralItems && (
        <SectionScheduleDialog
          sectionId={sectionId}
          sectionName={sectionName}
          currentSchedule={schedule ?? null}
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
        />
      )}
    </>
  );
}
