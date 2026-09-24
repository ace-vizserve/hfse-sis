import { Card, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/admin/admission-options/page.tsx` — change this file
 * when that page changes.
 *
 * Header with chips, three HubStats, then level cards. Three cards with two
 * rows each is a guess at the shape, not the count: the real page has one card
 * per SIS level that has options (eleven on a fully set-up year).
 */
export default function Loading() {
  return (
    <PageShell>
      {/* SisPageHeader — back link, eyebrow, serif title, description, chips. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <SkeletonText variant="eyebrow" className="w-[96px]" />
            <SkeletonText variant="headline" className="w-[320px] max-w-full" />
            <SkeletonText variant="body" className="w-[36rem] max-w-full" />
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <div className="flex gap-2">
              <Skeleton className="h-7 w-[72px]" />
              <Skeleton className="h-7 w-[72px]" />
            </div>
            <Skeleton className="h-9 w-[180px]" />
          </div>
        </header>
      </div>

      {/* Open / Closed / Levels offered. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="shadow-xs">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between">
                <SkeletonText variant="micro" className="w-[96px]" />
                <Skeleton className="size-9 rounded-xl" />
              </div>
              <Skeleton className="h-8 w-[64px]" />
              <SkeletonText variant="label" className="w-[170px]" />
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* One level card each: header, meta strip, rows of class type + switches. */}
      <section className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="w-full space-y-2">
                  <SkeletonText variant="micro" className="w-[72px]" />
                  <SkeletonText variant="title" className="w-[180px]" />
                </div>
                <Skeleton className="size-10 shrink-0 rounded-xl" />
              </div>
            </CardHeader>
            <div className="flex gap-6 border-b border-border bg-muted/30 px-6 py-3">
              <SkeletonText variant="label" className="w-[96px]" />
              <SkeletonText variant="label" className="w-[140px]" />
            </div>
            <ul className="divide-y divide-border">
              {Array.from({ length: 2 }).map((_, j) => (
                <li
                  key={j}
                  className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:gap-6"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonText variant="body" className="w-[200px]" />
                    <SkeletonText
                      variant="label"
                      className="w-[60%] min-w-[180px]"
                    />
                  </div>
                  <div className="flex items-center gap-5">
                    <Skeleton className="h-5 w-[92px]" />
                    <Skeleton className="h-5 w-[104px]" />
                    <Skeleton className="size-8" />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </PageShell>
  );
}
