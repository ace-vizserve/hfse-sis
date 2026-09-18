'use client';

import { cn } from '@/lib/utils';

/**
 * One tooltip for every recharts chart in the SIS.
 *
 * WHAT IT REPLACES. Eighteen charts each hand-rolled their own `contentStyle`,
 * `cursor` and `formatter`, in four incompatible styles: eight passed
 * `formatter={(v) => [formatted, '']}`, where that empty second element blanks
 * the series name ON PURPOSE, so hovering a bar produced a bare number with no
 * idea what it counted; seven passed no formatter at all and showed raw
 * unrounded values; one (retention) wrote a real sentence and was the proof
 * that the good version was possible; one formatted only its axis label.
 *
 * WHY NOT `@shadcn/chart`. Its `ChartTooltipContent` is the obvious candidate,
 * but the package also ships `ChartLegendContent`, which renders a flat square
 * per series. Design system §10 requires chart legends to be gradient
 * `ChartLegendChip` pills and states that a legend whose paint differs from
 * the mark it documents is a broken key. Installing it would stand a competing
 * legend system beside the mandated one, and `ChartTooltipContent` cannot be
 * taken on its own — it reads `useChart()` and throws outside `ChartContainer`,
 * so adopting it means migrating all eighteen `ResponsiveContainer`s too.
 * This file mirrors the shape of the sibling `chartLegendContent(palette)`
 * factory instead, which is the convention this folder already uses.
 *
 * THE CONTENT RULES it encodes (see the approved design):
 * - The value leads and the series name follows. The reader already knows
 *   which chart they are looking at; what they want is the number.
 * - Every series at that position is listed, so the pointer never has to land
 *   on the right slice of a stack or the right stroke of a line.
 * - A row keys its colour with a 2px stroke, not a filled box — at tooltip
 *   density a box is data-weight ink doing a label's job. It takes the colour
 *   recharts already assigned to the mark, so the key cannot drift (§10.2).
 * - `share` and `totalLabel` name what the numbers are out of. A percentage
 *   with no visible base is the thing the old tooltips were bad at.
 *
 * BLANK IS NOT ZERO (hard rule #3). A `null` means the thing was not taken and
 * is excluded from both the displayed rows' total and the shares; it renders
 * as an em dash. A `0` means taken and scored zero, and counts fully. Summing
 * `value ?? 0` would quietly turn "no exam this term" into "scored nothing".
 */

type RechartsTooltipEntry = {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
  // The whole row behind the point — charts use it for extra context.
  payload?: Record<string, unknown>;
};

export type ChartTooltipContext = {
  /** The x-axis value / category recharts is reporting. */
  label: unknown;
  entries: RechartsTooltipEntry[];
  /** The data row behind the hovered position, when there is a single one. */
  row: Record<string, unknown> | undefined;
};

export type ChartTooltipOptions = {
  /** Format a numeric value. Defaults to en-SG thousands separators. */
  format?: (n: number) => string;
  /** Heading text. Defaults to the recharts `label`. */
  heading?: (ctx: ChartTooltipContext) => React.ReactNode;
  /** Small muted note on the right of the heading, e.g. "62 students". */
  note?: (ctx: ChartTooltipContext) => React.ReactNode;
  /** Show each row's percentage of the base. */
  share?: boolean;
  /** Footer caption. Omit for no footer. */
  totalLabel?: string;
  /**
   * The base for `share` and the footer total. Defaults to the sum of the
   * non-null rows — override when the chart's own denominator is wider than
   * what is plotted (a donut of houses whose base is every student, say).
   */
  base?: (ctx: ChartTooltipContext) => number;
  /** Drop rows whose value is null — for wide stacks with sparse series. */
  hideBlank?: boolean;
};

const DEFAULT_FORMAT = (n: number) => n.toLocaleString('en-SG');

function toNumber(v: RechartsTooltipEntry['value']): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Render-prop for recharts `<Tooltip content={...} />`, matching the shape of
 * `chartLegendContent(palette)` in `components/dashboard/chart-legend-chip`.
 *
 *   <Tooltip
 *     cursor={{ fill: 'var(--color-accent)', opacity: 0.5 }}
 *     content={chartTooltipContent({ share: true, totalLabel: 'All documents' })}
 *   />
 */
export function chartTooltipContent(options: ChartTooltipOptions = {}) {
  const {
    format = DEFAULT_FORMAT,
    heading,
    note,
    share = false,
    totalLabel,
    base,
    hideBlank = false,
  } = options;

  // Typed loosely for the same reason `chartLegendContent` is: recharts' own
  // content type is internal and changes between minors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function ChartTooltipContent(props: any) {
    const active: boolean = props?.active ?? false;
    const entries: RechartsTooltipEntry[] = props?.payload ?? [];
    if (!active || entries.length === 0) return null;

    const rows = hideBlank
      ? entries.filter((e) => toNumber(e.value) !== null)
      : entries;
    if (rows.length === 0) return null;

    const ctx: ChartTooltipContext = {
      label: props?.label,
      entries,
      row: entries[0]?.payload,
    };

    // Blank is excluded from the base; zero is not.
    const summed = rows.reduce<number>((acc, e) => {
      const n = toNumber(e.value);
      return n === null ? acc : acc + n;
    }, 0);
    const total = base ? base(ctx) : summed;

    const headingNode = heading
      ? heading(ctx)
      : ctx.label !== undefined && ctx.label !== null && ctx.label !== ''
        ? String(ctx.label)
        : null;
    const noteNode = note?.(ctx);

    return (
      <div className="min-w-[11rem] max-w-[20rem] rounded-lg border border-border bg-popover px-3.5 py-3 shadow-lg">
        {(headingNode || noteNode) && (
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-border pb-2">
            {headingNode && (
              <span className="text-[13.5px] font-semibold leading-tight text-foreground">
                {headingNode}
              </span>
            )}
            {noteNode && (
              <span className="shrink-0 font-mono text-[11px] font-medium text-ink-4">
                {noteNode}
              </span>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          {rows.map((e, i) => {
            const n = toNumber(e.value);
            const pct =
              share && n !== null && total > 0 ? (n / total) * 100 : null;
            return (
              <div
                key={`${String(e.dataKey ?? e.name ?? i)}-${i}`}
                className="grid grid-cols-[0.625rem_auto_1fr_auto] items-center gap-x-2.5"
              >
                {/* A filled swatch, not a hairline: it has to be legible at a
                    glance and it has to match a solid bar or slice, which a
                    2px rule does not. The colour is the one recharts gave the
                    mark itself — never a hand-picked lookalike (§10.2). */}
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: e.color ?? 'var(--color-ink-5)' }}
                />
                <span
                  className={cn(
                    'text-right font-mono text-[15px] font-bold leading-none tabular-nums',
                    n === null ? 'text-ink-5' : 'text-foreground'
                  )}
                >
                  {n === null ? '—' : format(n)}
                </span>
                <span className="truncate text-[12.5px] font-medium text-ink-2">
                  {e.name ?? ''}
                </span>
                <span className="text-right font-mono text-[11px] font-medium tabular-nums text-ink-4">
                  {pct === null ? '' : `${pct.toFixed(1)}%`}
                </span>
              </div>
            );
          })}
        </div>

        {totalLabel && (
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <span className="text-[12px] font-medium text-muted-foreground">
              {totalLabel}
            </span>
            <span className="font-mono text-[13px] font-bold tabular-nums text-foreground">
              {format(total)}
            </span>
          </div>
        )}
      </div>
    );
  };
}
