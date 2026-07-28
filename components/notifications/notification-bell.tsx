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

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type NotificationBellProps = {
  role: Role | null;
  userId: string;
  initialCount: number | null;
};

// Surfaces the changeRequests realtime signal outside Markbook's own
// sidebar (KD #41/#88 approvers) — see
// docs/superpowers/specs/2026-07-28-cross-module-notification-bell-design.md.
// Mounted in every module layout's header, next to <SidebarTrigger>.
export function NotificationBell({
  role,
  userId,
  initialCount,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const count = useChangeRequestCount(role, userId, initialCount);

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
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Notifications
          </span>
          {count != null && count > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
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
        {open && <NotificationPreviewPanel onNavigate={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function NotificationPreviewPanel({ onNavigate }: { onNavigate: () => void }) {
  const previewQuery = useQuery({
    queryKey: queryKeys.changeRequestPreview(),
    queryFn: async ({ signal }) => {
      const json = await apiFetch<{ rows: PreviewRow[] }>(
        '/api/change-requests/preview',
        { credentials: 'include', signal }
      );
      return json.rows;
    },
  });

  const rows = previewQuery.data ?? [];

  if (previewQuery.isLoading) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        Nothing pending
      </div>
    );
  }

  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id} className="border-b border-border last:border-0">
          <Link
            href={`/markbook/change-requests?req=${row.id}`}
            onClick={onNavigate}
            className="block px-3 py-2.5 transition-colors hover:bg-accent"
          >
            <div className="text-xs font-medium text-foreground">
              {row.student_label ?? '(student)'} —{' '}
              {row.field_changed.replace(/_/g, ' ')}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Requested {relativeTime(row.requested_at)}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
