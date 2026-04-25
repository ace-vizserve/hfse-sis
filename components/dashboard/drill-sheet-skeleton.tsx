import { SheetContent, SheetTitle } from '@/components/ui/sheet';

/**
 * DrillSheetSkeleton — placeholder rendered inside the `drillSheet` slot of
 * `MetricCard` (or inside a `<Sheet>` wrapping a chart card) while the
 * lazy-fetched drill rows are in flight. Matches the table shape of
 * `DrillDownSheet` so there's no layout shift when real rows arrive.
 */
export function DrillSheetSkeleton({ title = 'Loading…' }: { title?: string }) {
  return (
    <SheetContent
      side="right"
      className="sm:max-w-3xl w-full flex flex-col gap-0 p-0"
    >
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex items-baseline gap-3">
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
        </div>
      </div>

      {/* Filter bar — single row */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <div className="h-9 w-72 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-9 w-24 animate-pulse rounded-md bg-muted" />
      </div>

      {/* Filter bar — second row */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-3">
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-8 w-24 animate-pulse rounded-md bg-muted" />
      </div>

      {/* Table — 6 placeholder rows */}
      <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
        <div className="grid grid-cols-6 gap-3 border-b border-border pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="grid grid-cols-6 gap-3 py-1.5">
            {Array.from({ length: 6 }).map((_, col) => (
              <div
                key={col}
                className="h-4 w-full animate-pulse rounded bg-muted/60"
              />
            ))}
          </div>
        ))}
      </div>
    </SheetContent>
  );
}
