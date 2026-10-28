import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/admin/subject-heads/page.tsx` — change this file when
 * that page changes. Header, then the titled card: summary line, toolbar and
 * the table of subjects.
 *
 * ⚠ ALSO THE PAGE'S SUSPENSE BOUNDARY. With `cacheComponents` on, a page that
 * reads the session at request time needs one, or Next reports an unstable
 * value while prerendering.
 */
export default function Loading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[168px]" />
          <SkeletonText variant="headline" className="w-[260px] max-w-full" />
          <SkeletonText variant="body" className="w-[36rem] max-w-full" />
        </header>
      </div>

      {/* The titled card: eyebrow, tile + title, summary line, then the
          toolbar (search, Status, Taught in · Export CSV, Columns) and rows. */}
      <div className="space-y-4 rounded-xl border border-border p-6">
        <SkeletonText variant="micro" className="w-[140px]" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 rounded-xl" />
          <SkeletonText variant="title" className="w-[120px]" />
        </div>
        <SkeletonText variant="label" className="w-[28rem] max-w-full" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-[224px]" />
            <Skeleton className="h-8 w-[96px]" />
            <Skeleton className="h-8 w-[112px]" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-[128px]" />
            <Skeleton className="h-8 w-[112px]" />
          </div>
        </div>
        <div className="rounded-xl border border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <SkeletonText variant="body" className="w-1/4" />
              <SkeletonText variant="label" className="w-[8%]" />
              <SkeletonText variant="label" className="w-[12%]" />
              <SkeletonText variant="label" className="w-[12%]" />
              <SkeletonText variant="label" className="w-[12%]" />
              <Skeleton className="h-6 w-[96px]" />
              <Skeleton className="ml-auto h-8 w-[56px]" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
