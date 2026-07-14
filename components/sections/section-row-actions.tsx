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
  FilePlus2,
  UserPlus,
} from 'lucide-react';

import { GenerateIndexDialog } from '@/components/sis/generate-index-button';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { RowActionsMenu } from '@/components/ui/data-table';
import type { Role } from '@/lib/auth/roles';

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
  /** SIS only: whether this section already has a form adviser assigned.
   *  Controls the label of the adviser action item. */
  hasAdviser?: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SectionRowActions({
  module,
  sectionId,
  sectionName,
  role,
  termStarted,
  todayHref,
  hasAdviser,
  ayId,
}: SectionRowActionsProps) {
  const isRegistrarPlus =
    role === 'registrar' || role === 'school_admin' || role === 'superadmin';

  // Controlled dialog open state — mirrors the AyRowActions pattern in
  // ay-setup-data-table.tsx so the dropdown closes cleanly before the dialog
  // animates open.
  const [indexOpen, setIndexOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);

  // ── Resolve the "Open" destination per module ──────────────────────────────
  const openHref =
    module === 'sis'
      ? `/sis/sections/${sectionId}`
      : module === 'markbook'
        ? `/markbook/sections/${sectionId}`
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

        {/* ── Markbook cross-links ── */}
        {module === 'markbook' && (
          <>
            <DropdownMenuItem asChild>
              <Link
                href={`/attendance/${sectionId}`}
                className="flex items-center gap-2"
              >
                <CalendarDays className="size-4 shrink-0" />
                Open attendance
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={`/evaluation/sections/${sectionId}`}
                className="flex items-center gap-2"
              >
                <ClipboardList className="size-4 shrink-0" />
                Open write-ups
              </Link>
            </DropdownMenuItem>
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
    </>
  );
}
