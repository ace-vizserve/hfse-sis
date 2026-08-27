'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import type { Role } from '@/lib/auth/roles';
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';
import { useDeclarationCount } from '@/lib/sidebar/use-declaration-count';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';

const GATE_ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

type PreviewRow = {
  id: string;
  field_changed: string;
  reason_category: string;
  requested_at: string;
  student_label: string | null;
  sheet_label: string | null;
};

/**
 * A declaration waiting for this person — the second source the bell carries.
 *
 * ⚠ Deliberately NOT reshaped into `PreviewRow`. A grade change is "a field, on
 * a sheet, for a student"; an absence is "these days, for this child". Forcing
 * one into the other's shape would put a `field_changed` on a row that has no
 * field, and the reader would have to work out which kind they were looking at.
 * Two shapes, one list, each row saying what it is.
 */
type DeclarationPreviewRow = {
  id: string;
  request_id: string;
  student_label: string | null;
  kind: 'absence' | 'travel';
  start_date: string;
  end_date: string;
  filed_at: string;
};

type MergedRow =
  | { source: 'change_request'; at: string; row: PreviewRow }
  | { source: 'declaration'; at: string; row: DeclarationPreviewRow };

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Role-aware row destination. Mirrors the sidebar nav's own split
// (lib/auth/roles.ts NAV_BY_MODULE.markbook.teacher — badgeKey
// 'changeRequests' points at /markbook/grading/requests, "My Requests")
// because /markbook/change-requests (the deep-link every other gate role
// gets) redirects teachers away — it's gated to
// school_admin | superadmin | academic_coordinator
// (app/(markbook)/markbook/change-requests/page.tsx). Teachers land on the
// list page instead — that page doesn't read a ?req= param, so there's
// nothing to deep-link into for them.
function previewRowHref(role: Role, id: string): string {
  if (role === 'teacher') return '/markbook/grading/requests';
  return `/markbook/change-requests?req=${id}`;
}

// A declaration goes to one place for everybody. Unlike the change-request
// queue above, `/attendance/declarations` is not role-split: the people who act
// on these are form class advisers, so the module's own audience is the
// audience, and the page opens the filing named by `?req=`.
function declarationRowHref(requestId: string): string {
  return `/attendance/declarations?req=${requestId}`;
}

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            count && count > 0
              ? `Notifications (${count} pending)`
              : 'Notifications'
          }
          className="relative flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="size-4" aria-hidden />
          {count != null && count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Notifications
          </span>
          {count != null && count > 0 && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {count} pending
            </span>
          )}
        </div>
        {/* Mounted only while the popover is open, so the panel's own
            useQuery call — and its dependency on a live QueryClient —
            never runs for a closed bell. This is what makes the fetch
            genuinely lazy (KD #56 drill-sheet lazy-fetch pattern), not
            just `enabled: false` (useQuery still requires a QueryClient
            in context even when disabled). */}
        {open && (
          <NotificationPreviewPanel
            role={role}
            onNavigate={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationPreviewPanel({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate: () => void;
}) {
  const previewQuery = useQuery({
    queryKey: queryKeys.changeRequestPreview(),
    queryFn: async ({ signal }) => {
      // ⚠ Fetched with `allSettled`, not `all`. Two independent endpoints back
      // this list, and one being down must not blank the other's rows — an
      // empty bell reads as "nothing waiting", which is a worse answer than a
      // shorter list.
      const [changeRequests, declarations] = await Promise.allSettled([
        apiFetch<{ rows: PreviewRow[] }>('/api/change-requests/preview', {
          credentials: 'include',
          signal,
        }),
        apiFetch<{ rows: DeclarationPreviewRow[] }>(
          '/api/declarations/preview',
          { credentials: 'include', signal }
        ),
      ]);

      const merged: MergedRow[] = [];
      if (changeRequests.status === 'fulfilled') {
        for (const row of changeRequests.value.rows) {
          merged.push({
            source: 'change_request',
            at: row.requested_at,
            row,
          });
        }
      }
      if (declarations.status === 'fulfilled') {
        for (const row of declarations.value.rows) {
          merged.push({ source: 'declaration', at: row.filed_at, row });
        }
      }
      // Newest first, then capped — the same 5 the bell has always shown, now
      // shared between the two sources rather than 5 of each.
      merged.sort((a, b) => b.at.localeCompare(a.at));
      return merged.slice(0, 5);
    },
    // The popover only mounts this panel while open (see the comment above
    // its render site), so this never runs as a wasted background fetch —
    // it's a small (<=5 row) dataset fetched only while a human is actively
    // looking at it. Forcing a fresh fetch on every open (rather than
    // trusting the default 60s staleTime, KD #24) closes the window where
    // the live badge count — which updates instantly via realtime — could
    // disagree with a stale cached row list: this feature's core invariant
    // is that the badge and the panel never show conflicting information.
    staleTime: 0,
  });

  const rows = previewQuery.data ?? [];

  if (previewQuery.isLoading) {
    return (
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (previewQuery.isError) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        Couldn&apos;t load notifications right now
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing pending
      </div>
    );
  }

  return (
    <ul>
      {rows.map((entry) =>
        entry.source === 'change_request' ? (
          <li
            key={`cr-${entry.row.id}`}
            className="border-b border-border last:border-0"
          >
            <Link
              href={previewRowHref(role, entry.row.id)}
              onClick={onNavigate}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-xs font-semibold text-white shadow-brand-tile">
                {deriveInitials(entry.row.student_label)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {entry.row.student_label ?? '(student)'} —{' '}
                  {entry.row.field_changed.replace(/_/g, ' ')}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Mark change · requested {relativeTime(entry.row.requested_at)}
                </div>
              </div>
            </Link>
          </li>
        ) : (
          <li
            key={`dec-${entry.row.id}`}
            className="border-b border-border last:border-0"
          >
            <Link
              href={declarationRowHref(entry.row.request_id)}
              onClick={onNavigate}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-indigo to-brand-navy text-xs font-semibold text-white shadow-brand-tile">
                {deriveInitials(entry.row.student_label)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {entry.row.student_label ?? '(student)'} —{' '}
                  {entry.row.kind === 'travel' ? 'travel' : 'absence'}{' '}
                  {formatDayRange(entry.row.start_date, entry.row.end_date)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {/* Says who it came from, because this is the one source on
                      the bell that a PARENT started rather than a colleague. */}
                  Filed by a parent · {relativeTime(entry.row.filed_at)}
                </div>
              </div>
            </Link>
          </li>
        )
      )}
    </ul>
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
