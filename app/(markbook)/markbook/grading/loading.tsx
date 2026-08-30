import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
} from '@/components/ui/skeleton-layouts';

/**
 * Mirrors `app/(markbook)/markbook/grading/page.tsx` — change them together.
 *
 * Numbers taken from the page: a hero header (the two create buttons on the
 * right are registrar-only, so no control bars are drawn there), then three
 * `StatCard`s — Total sheets / Open / Locked — whose `footerTitle` +
 * `footerDetail` props are REQUIRED, so each renders a CardFooter and `footer`
 * stays default-true. Their grid breaks on the container
 * (`@xl/main:grid-cols-3`), hence `grid` rather than `className`.
 *
 * `GradingDataTable` declares eleven columns and hides three via
 * `initialColumnVisibility` (form_adviser, school_level, is_examinable), so
 * EIGHT are visible: level, section, subject, term, teacher, graded, status,
 * actions. Registrar-and-above additionally get a leading select checkbox
 * column (nine) — the loader cannot know the viewer's role, so it draws the
 * teacher shape. `pageSize={20}` with pagination left on, and the page only
 * reaches this table when there is at least one sheet (zero renders an empty
 * -state card instead), so the footer bar is drawn.
 */
export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <SkeletonText variant="eyebrow" className="w-[92px]" />
          <SkeletonText variant="headline" className="w-[300px] max-w-full" />
          <SkeletonText variant="body" className="w-[28rem] max-w-full" />
        </div>
      </header>

      <div className="@container/main">
        <SkeletonCards
          count={3}
          grid="grid grid-cols-1 gap-4 @xl/main:grid-cols-3"
        />
      </div>

      {/* The table carries `statusTabs`, which render as a TabsList strip
          between the toolbar and the bordered shell. */}
      <div className="space-y-3">
        <Skeleton className="h-9 w-[320px] max-w-full" />
        <SkeletonTable columns={8} rows={10} pagination />
      </div>
    </PageShell>
  );
}
