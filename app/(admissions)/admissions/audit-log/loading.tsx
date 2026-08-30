import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(admissions)/admissions/audit-log/page.tsx` — change this file
 * when that page changes.
 *
 * What the old hand-drawn version missed entirely: the "Admissions dashboard"
 * back link and the TWO stat cards ("Entries loaded", "Unique actors"). Both
 * cards carry a required `CardFooter`, so `footer` stays at its default, and
 * their grid is a `@container/main` two-up — passed via `grid`, never
 * `className`, because the container-query breakpoint would not override the
 * archetype's default `sm:`/`lg:` ones.
 *
 * The table is `AuditLogDataTable` (shared with Markbook, Records, Attendance
 * and SIS): five visible columns — when, who, action, details, and the
 * open-sheet row action. `rows={12}` matches the other four audit-log
 * loaders; the server page size is 50, but a 50-row grey block is not what
 * any of them draw.
 */
export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-5 w-44" />

      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-52" />
        <SkeletonText variant="headline" className="w-64 max-w-full" />
        <SkeletonText variant="body" className="w-120 max-w-full" />
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={2}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-2"
        />
      </div>

      {/* DataTable wrapper is `flex flex-col gap-3`. `toolbarLeading` carries
          two server-side Selects (h-8 w-[180px]) and a date-range popover, so
          the toolbar is drawn here at the real h-8 control height rather than
          taken from SkeletonTable's generic three-control strip. The
          role-gated Export button is left out — only school_admin and
          superadmin see it. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="ml-auto h-8 w-24" />
        </div>
        {/* `pagination` on: the page hands the table a `pageSize` equal to the
            loaded row count, so DataTable's own pager renders whenever the
            window is non-empty, and this log covers every application edit,
            stage move and document validation. */}
        <SkeletonTable columns={5} rows={12} toolbar={false} pagination />
      </div>

      {/* Server-pagination bar — a SIBLING of the table shell, rendered
          whenever the page passes its `pagination` prop, which it always
          does. Its own chrome is `rounded-b-xl border border-t-0`. */}
      <Skeleton className="h-13 w-full rounded-b-xl" />
    </PageShell>
  );
}
