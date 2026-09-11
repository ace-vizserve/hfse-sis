import { Card, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton-layouts';
import { STAGED_APPROVAL_FLOWS } from '@/lib/schemas/approval-flows';

/**
 * Mirrors `app/(sis)/sis/admin/approvers/page.tsx` — change this file when that
 * page changes.
 *
 * Counts are not guesses: the page renders one card per entry in
 * `STAGED_APPROVAL_FLOWS` (declarations and the two grade-change kinds), and
 * the rules panel holds exactly four rules. The two-approver pool's readiness
 * card and table were removed from the page, so their placeholders went too.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* SisPageHeader — back link, eyebrow, serif title, description. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[168px]" />
          <SkeletonText variant="headline" className="w-[240px] max-w-full" />
          <SkeletonText variant="body" className="w-[36rem] max-w-full" />
        </header>
      </div>

      {/* "How approvals work" — the tinted rules panel, four rules in a grid.
          Its `bg-muted/30` wash is copied from the real section. */}
      <section className="rounded-xl border border-border bg-muted/30 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="size-4 rounded" />
          <SkeletonText variant="body" className="w-[150px]" />
        </div>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <SkeletonText variant="label" className="w-[70%]" />
              <SkeletonText variant="label" className="w-[92%]" />
              <SkeletonText variant="label" className="w-[60%]" />
            </div>
          ))}
        </div>
      </section>

      {/* StagedFlowEditor — one Card per kind of request: header with its
          description, a muted meta strip, and a divide-y list of steps. */}
      <section className="space-y-4">
        {STAGED_APPROVAL_FLOWS.map((flow) => (
          <Card key={flow} className="gap-0 py-0">
            <CardHeader className="border-b border-border py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="w-full space-y-2">
                  <SkeletonText variant="micro" className="w-[120px]" />
                  <SkeletonText
                    variant="title"
                    className="w-[320px] max-w-full"
                  />
                  <SkeletonText
                    variant="body"
                    className="w-[38rem] max-w-full"
                  />
                </div>
                <Skeleton className="size-9 shrink-0 rounded-xl" />
              </div>
            </CardHeader>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/30 px-6 py-3">
              <Skeleton className="h-6 w-[112px]" />
              <SkeletonText variant="label" className="w-[260px] max-w-full" />
            </div>
            <ul className="divide-y divide-border">
              {Array.from({ length: 2 }).map((_, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:gap-4"
                >
                  <Skeleton className="size-7 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonText
                      variant="body"
                      className="w-[46%] min-w-[180px]"
                    />
                    <SkeletonText
                      variant="label"
                      className="w-[62%] min-w-[220px]"
                    />
                  </div>
                  <Skeleton className="h-8 w-[104px] shrink-0" />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </PageShell>
  );
}
