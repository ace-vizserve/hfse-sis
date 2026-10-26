import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/admin/subject-heads/page.tsx` — change this file when
 * that page changes. Header, the one-line summary, the toolbar and tabs, then
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

      <div className="space-y-4">
        <SkeletonText variant="label" className="w-[28rem] max-w-full" />
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-[224px]" />
          <Skeleton className="h-8 w-[112px]" />
        </div>
        <Skeleton className="h-9 w-[288px]" />
        <div className="rounded-xl border border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="w-1/3 space-y-1.5">
                <SkeletonText variant="body" className="w-[60%]" />
                <SkeletonText variant="label" className="w-[45%]" />
              </div>
              <Skeleton className="h-8 w-[136px]" />
              <Skeleton className="ml-auto h-6 w-[150px]" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
