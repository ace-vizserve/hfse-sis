import { Card, CardHeader } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, SkeletonText } from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(sis)/sis/admin/approvers/page.tsx` — change this file when that
 * page changes.
 *
 * The version this replaces stopped after the header and one bordered block,
 * so the "How this works" panel, the readiness card, the approvers table and
 * the whole `StagedFlowEditor` section arrived with no placeholder at all.
 *
 * Counts are not guesses: `APPROVER_FLOWS` holds exactly one flow
 * (`markbook.change_request`), so `ApproverReadinessCards` renders ONE card and
 * the table's Flow facet has one option.
 */
export default function Loading() {
  return (
    <PageShell>
      {/* SisPageHeader — back link, eyebrow, serif title, description. */}
      <div className="flex flex-col gap-5">
        <SkeletonText variant="body" className="w-[110px]" />
        <header className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[168px]" />
          <SkeletonText variant="headline" className="w-[380px] max-w-full" />
          <SkeletonText variant="body" className="w-[36rem] max-w-full" />
        </header>
      </div>

      {/* "How this works" — a tinted explainer surface with four bullets. Its
          `bg-muted/30` wash is copied from the real section, not invented. */}
      <section className="rounded-xl border border-border bg-muted/30 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="size-4 rounded" />
          <SkeletonText variant="body" className="w-[130px]" />
        </div>
        <div className="ml-4 space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonText
              key={i}
              variant="label"
              className={i % 2 === 0 ? 'w-[92%]' : 'w-[78%]'}
            />
          ))}
        </div>
      </section>

      {/* ApproverReadinessCards — one Card per flow, header strip only. */}
      <div className="space-y-3">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-5 py-3.5">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <SkeletonText variant="body" className="flex-1 max-w-[260px]" />
            <Skeleton className="h-6 w-[112px] shrink-0" />
          </div>
        </Card>
      </div>

      {/* ApproversDataTable — five columns (user, flow, role, assigned, row
          actions), none hidden, page size 25. */}
      <SkeletonTable columns={5} rows={6} pagination />

      {/* StagedFlowEditor — section heading, then one Card per staged flow:
          header, a muted meta strip, and a divide-y list of stages. */}
      <section className="space-y-4">
        <div className="space-y-1.5">
          <SkeletonText variant="eyebrow" className="w-[150px]" />
          <SkeletonText variant="title" className="w-[260px] max-w-full" />
          <SkeletonText variant="body" className="w-[38rem] max-w-full" />
        </div>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <SkeletonText variant="micro" className="w-[120px]" />
                <SkeletonText
                  variant="title"
                  className="w-[240px] max-w-full"
                />
              </div>
              <Skeleton className="size-9 shrink-0 rounded-xl" />
            </div>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/30 px-6 py-3">
            <SkeletonText variant="label" className="w-[140px]" />
            <SkeletonText variant="label" className="w-[110px]" />
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
      </section>
    </PageShell>
  );
}
