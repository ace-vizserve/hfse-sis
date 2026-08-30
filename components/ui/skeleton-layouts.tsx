import * as React from 'react';

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Four archetype loaders — table, cards, detail, form.
 *
 * WHY THESE EXIST. Before this file, every loading state was hand-drawn in
 * its own `loading.tsx`: 58 files, 1,874 lines of bars guessing at the shape
 * of a page they cannot see, with nothing to stop them drifting from it.
 *
 * These do the opposite. They render the REAL primitives — the actual
 * `<Table>`, the actual `<Card>` — with the content taken out. Row height,
 * header strip, cell padding and dividers therefore come from the same
 * components as the loaded screen, so the placeholder cannot put a row
 * anywhere other than where the real row lands. No layout shift by
 * construction rather than by eyeballing a pixel height.
 *
 * Their first consumer is Phase 1's Suspense fallbacks. Route-level
 * `loading.tsx` files migrate to them opportunistically — only when someone
 * is already working in that route. See
 * `docs/superpowers/plans/2026-08-29-nextjs-navigation-performance.md`.
 */

/**
 * A placeholder bar as tall as the text voice it stands in for.
 *
 * Heights are the type scale in `09-design-system.md` §3.3, not round
 * numbers. This is the rule that stops a fallback drifting: a bar standing in
 * for a page headline is 38px because `font-serif text-[38px]` is 38px, so
 * the title cannot hop when the real words arrive.
 *
 * Width is the caller's job — pass it on `className`.
 */
const TEXT_VOICE = {
  micro: 'h-[10px]',
  eyebrow: 'h-[11px]',
  label: 'h-[13px]',
  body: 'h-[15px]',
  title: 'h-[20px]',
  stat: 'h-[32px]',
  headline: 'h-[38px]',
} as const;

export type SkeletonTextVariant = keyof typeof TEXT_VOICE;

export function SkeletonText({
  variant = 'body',
  className,
  ...props
}: React.ComponentProps<'div'> & { variant?: SkeletonTextVariant }) {
  return <Skeleton className={cn(TEXT_VOICE[variant], className)} {...props} />;
}

/**
 * Deterministic cell widths.
 *
 * Uniform bars read as a wireframe; varied ones read as text. The variation
 * MUST NOT come from `Math.random()` — a fallback renders on the server and
 * again on the client, and a random width would hydrate to a different value
 * and log a mismatch. Indexing a fixed table gives the same jitter every
 * time.
 */
const CELL_WIDTHS = ['w-[78%]', 'w-[62%]', 'w-[86%]', 'w-[54%]', 'w-[70%]'];

function cellWidth(row: number, col: number) {
  return CELL_WIDTHS[(row * 3 + col * 2) % CELL_WIDTHS.length];
}

/**
 * Table loader — the real `<Table>`, emptied.
 *
 * @param columns Column count, or a list of CSS widths to pin each column to
 *                the loaded table's own widths. Pass widths only when the
 *                real table declares them; most `DataTable` columns size
 *                automatically, and inventing widths here would cause the
 *                shift this component exists to prevent.
 * @param rows    How many row bars to draw. Match the table's page size, or
 *                the typical roster length for an unpaginated table.
 * @param toolbar Draw the search/filter strip above the table. `DataTable`
 *                renders one unless it was explicitly turned off.
 * @param pagination Draw the footer bar. `DataTable` renders it whenever
 *                `hidePagination` is false AND there is at least one row, and
 *                it lives INSIDE the bordered shell — so omitting it when the
 *                real table has one shoves everything below up by ~45px the
 *                moment data lands.
 */
export function SkeletonTable({
  columns = 5,
  rows = 8,
  toolbar = true,
  pagination = false,
  className,
}: {
  columns?: number | readonly string[];
  rows?: number;
  toolbar?: boolean;
  pagination?: boolean;
  className?: string;
}) {
  const widths = Array.isArray(columns) ? columns : undefined;
  const count = widths ? widths.length : (columns as number);

  return (
    <div className={cn('space-y-3', className)}>
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-[220px]" />
          <Skeleton className="h-9 w-[130px]" />
          <Skeleton className="ml-auto h-9 w-[110px]" />
        </div>
      ) : null}

      {/* Shell classes copied from `DataTable`'s own wrapper
          (components/ui/data-table/index.tsx) — `rounded-lg border-border`,
          NOT `rounded-xl border-hairline`. `--av-hairline` has no `.dark`
          value, so a hairline border here would draw a bright outline on a
          dark card and then snap dark when the real table replaced it. */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {Array.from({ length: count }).map((_, i) => (
                <TableHead
                  key={i}
                  style={widths ? { width: widths[i] } : undefined}
                >
                  <SkeletonText variant="micro" className="w-[70%]" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, r) => (
              <TableRow key={r} className="hover:bg-transparent">
                {Array.from({ length: count }).map((_, c) => (
                  <TableCell key={c}>
                    <SkeletonText variant="body" className={cellWidth(r, c)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {pagination ? (
          <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/20 px-1 py-2">
            <SkeletonText variant="micro" className="ml-2 w-[140px]" />
            <Skeleton className="mr-2 h-7 w-[160px]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Stat-card grid loader — real `<Card>`s with the figure removed.
 *
 * The gradient icon tile stays solid rather than becoming a grey square. Its
 * size and position are known before the data is, so blanking it would throw
 * away information the loader already has.
 *
 * @param footer Whether the real cards carry a `CardFooter`. This is the
 *               difference between a ~168px card and a ~132px one, so it has
 *               to match or the grid below the cards jumps. Check the real
 *               card: if its footer props are required, this is always true.
 * @param grid   REPLACES the default grid classes outright. Use this — not
 *               `className` — to mirror the loaded grid.
 *
 *               Why a separate prop: `cn`/tailwind-merge only collapses
 *               classes that share a modifier. A page breaking on its
 *               container (`@xl/main:grid-cols-2`) does NOT override the
 *               viewport default (`sm:grid-cols-2`), so passing the live
 *               classes via `className` leaves BOTH rulesets applying and the
 *               skeleton lays out differently from the content it stands in
 *               for. Replacing the string avoids the whole problem.
 * @param className Extra non-grid classes only.
 */
const DEFAULT_CARD_GRID =
  'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4';

export function SkeletonCards({
  count = 4,
  footer = true,
  grid,
  className,
}: {
  count?: number;
  footer?: boolean;
  grid?: string;
  className?: string;
}) {
  return (
    <div className={cn(grid ?? DEFAULT_CARD_GRID, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <SkeletonText variant="micro" className="w-[88px]" />
                <SkeletonText variant="stat" className="w-[62px]" />
              </div>
              <div
                aria-hidden
                className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile"
              />
            </div>
          </CardHeader>
          {footer ? (
            <CardFooter className="flex-col items-start gap-1.5">
              <SkeletonText variant="label" className="w-[70%]" />
              <SkeletonText variant="micro" className="w-[50%]" />
            </CardFooter>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

/**
 * Detail loader — the page masthead, then whatever the caller puts below it.
 *
 * This is the one that most often flashes for a fraction of a second, which
 * is exactly why the headline bar is headline-height.
 *
 * @param stats   Number of stat cards under the header, if the page has them.
 * @param actions Number of toolbar controls beside/below the header.
 */
export function SkeletonDetail({
  stats = 0,
  actions = 0,
  className,
  children,
}: {
  stats?: number;
  actions?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-8', className)}>
      <header className="space-y-4">
        <SkeletonText variant="eyebrow" className="w-[128px]" />
        <SkeletonText variant="headline" className="w-[46%] min-w-[220px]" />
        <SkeletonText variant="body" className="w-[64%] min-w-[240px]" />
      </header>

      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-[150px]" />
          ))}
        </div>
      ) : null}

      {stats > 0 ? (
        <SkeletonCards
          count={stats}
          footer={false}
          // `grid`, not `className` — see SkeletonCards. Merging would leave
          // DEFAULT_CARD_GRID's `lg:grid-cols-4` live, so a 2- or 3-stat
          // fallback would lay out in four columns above 1024px.
          grid={cn(
            'grid grid-cols-1 gap-4',
            stats === 2 && 'sm:grid-cols-2',
            stats === 3 && 'sm:grid-cols-3',
            stats >= 4 && 'sm:grid-cols-2 lg:grid-cols-4'
          )}
        />
      ) : null}

      {children}
    </div>
  );
}

/**
 * Form loader — `Field` rows at their real height.
 *
 * The control keeps its border here instead of becoming a filled bar, because
 * an empty field genuinely is an outline. This is the one place the old
 * white-box treatment was accidentally right.
 */
export function SkeletonForm({
  fields = 4,
  columns = 1,
  className,
}: {
  fields?: number;
  columns?: 1 | 2;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent
        className={cn(
          'grid gap-5 pt-6',
          columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'
        )}
      >
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonText
              variant="label"
              className={i % 2 === 0 ? 'w-[96px]' : 'w-[78px]'}
            />
            <div
              aria-hidden
              className="h-9 w-full rounded-md border border-input bg-transparent"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
