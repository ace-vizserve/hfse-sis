'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { Role } from '@/lib/auth/roles';
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';
import { useDeclarationCount } from '@/lib/sidebar/use-declaration-count';
import { ActivityPanel } from '@/components/notifications/activity-panel';

const GATE_ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

// Initials from a "Last, First (STU-001)" student_label — same 2-letter
// gradient-circle convention as the sidebar profile pill
// (components/module-sidebar/sidebar-profile.tsx::deriveInitials), adapted
// for a name label instead of an email. Exported for direct unit testing —
// pure string logic is clearer to test directly than through rendered DOM.
export function deriveInitials(label: string | null): string {
  if (!label) return '—';
  const namePart = label.split('(')[0]?.trim() ?? '';
  const initials = namePart
    .split(',')
    .map((p) => p.trim()[0]?.toUpperCase() ?? '')
    .join('');
  return initials.slice(0, 2) || '—';
}

type NotificationBellProps = {
  role: Role | null;
  userId: string;
  initialCount: number | null;
  /**
   * Absence and travel declarations waiting for this person to decide.
   *
   * Optional so a layout that has not been taught to seed it keeps working —
   * it simply contributes nothing rather than throwing.
   */
  initialDeclarationCount?: number | null;
};

// Surfaces the changeRequests realtime signal outside Markbook's own
// sidebar (KD #41/#88 approvers) — see
// docs/superpowers/specs/2026-07-28-cross-module-notification-bell-design.md.
// Mounted in every module layout's header, next to <SidebarTrigger>.
//
// ⚠ TWO SOURCES SINCE 2026-08-27, and the bell had been single-source at every
// layer: one count hook, one preview endpoint, one row destination. Mr Ace:
// "the whole UI flow is the same as grade change request" — an absence sitting
// with its approver has to tap them on the shoulder the way a grade change
// does, or the only way to find out is to go and look.
export function NotificationBell({
  role,
  userId,
  initialCount,
  initialDeclarationCount = null,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const changeRequestCount = useChangeRequestCount(role, userId, initialCount);
  const declarationCount = useDeclarationCount(userId, initialDeclarationCount);

  // ⚠ `null` means "not tracked", which is not the same as zero — treating it
  // as zero would render a confident "0 pending" for somebody whose count
  // simply never loaded. If neither source is tracked the badge stays hidden.
  const count =
    changeRequestCount == null && declarationCount == null
      ? null
      : (changeRequestCount ?? 0) + (declarationCount ?? 0);

  if (!role || !GATE_ROLES.includes(role)) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={
            // ⚠ F4 — "pending", not "waiting for you". For a teacher this
            // count includes requests THEY filed, waiting on somebody else;
            // for a superadmin it's every pending request in the school.
            // "Waiting for you" would contradict the panel's own stricter
            // "Waiting for you" block and send a teacher looking for rows
            // that aren't there.
            count && count > 0 ? `Activity (${count} pending)` : 'Activity'
          }
          className="relative flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Activity className="size-4" aria-hidden />
          {count != null && count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white">
              {count}
            </span>
          )}
        </button>
      </SheetTrigger>
      {/* ⚠ `flex flex-col` is required — SheetContent's variants are a plain
          block with h-full, so a flex-1 body would not scroll without it. */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[552px]"
      >
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-[23px] font-semibold tracking-tight">
            Activity
          </SheetTitle>
        </SheetHeader>
        {/* Mounted only while open, so a closed panel costs nothing (KD #56). */}
        {open && <ActivityPanel onNavigate={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "3 Sep" for a single day, "3–5 Sep" for a run of them.
 *
 * ⚠ RETURNS '' RATHER THAN THROWING on anything it does not recognise. This
 * bell renders in the header of every page in the app, so an exception here
 * does not cost a date — it takes down whatever the person was looking at.
 * A row that reads "Grace Tan — absence" with no dates is a poor row; a blank
 * screen is a broken product.
 *
 * ⚠ Parsed as parts, never `new Date(iso)`. These are plain yyyy-MM-dd school
 * days with no time zone; letting Date interpret them shifts a Singapore
 * morning back to the previous day for anybody west of it.
 */
export function formatDayRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const part = (iso: string, withMonth: boolean): string | null => {
    const [, m, d] = iso.split('-');
    const month = MONTHS[Number(m) - 1];
    if (!month || !d || Number.isNaN(Number(d))) return null;
    return withMonth ? `${Number(d)} ${month}` : `${Number(d)}`;
  };

  if (!start && !end) return '';
  const from = start ?? end!;
  const to = end ?? start!;

  if (from === to) return part(from, true) ?? '';

  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const left = part(from, !sameMonth);
  const right = part(to, true);
  if (!left || !right) return right ?? left ?? '';
  return `${left}–${right}`;
}
