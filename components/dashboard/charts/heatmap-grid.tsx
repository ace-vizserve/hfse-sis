'use client';

import { HoverHint } from '@/components/ui/hover-hint';
import { cn } from '@/lib/utils';

/**
 * A rows × columns grid of numbers, each cell shaded by its value.
 *
 * Plain HTML, no recharts — so there is no chunk to lazy-load and no skeleton
 * swap. One scale for the whole grid (the largest cell is the darkest), so a
 * shade means the same amount in every column.
 *
 * Each column carries its own colour — an identity colour such as a house's
 * (`houseChartColor()`), never a `--color-*` name built from a template (see
 * `__tests__/house-points/house-chart-color.test.ts`). A cell is that colour
 * mixed into the card: the value sets how much, capped at 60% so the number
 * printed in ink stays readable on every fill in both themes. The number is
 * always printed — the shade is never the only signal. A zero is muted.
 */

export type HeatmapColumn = {
  key: string;
  label: string;
  /** The column's colour as a CSS value that exists at runtime. */
  color: string;
  /** Outline the column and bold its heading — "this is the one you're on". */
  emphasis?: boolean;
};

export type HeatmapRow = {
  key: string;
  /** Shown in the row's label column; cut with an ellipsis when too long. */
  label: string;
  /** The whole name, for the hover hint. Defaults to `label`. */
  fullLabel?: string;
  values: Record<string, number>;
};

export type HeatmapGridProps = {
  columns: HeatmapColumn[];
  rows: HeatmapRow[];
  /** What a value counts, for the hover hint — "points". */
  unit?: string;
  /** Room for the row labels. Defaults to 170. */
  labelWidth?: number;
};

const MIN_MIX = 14;
const MAX_MIX = 60;

function cellBackground(color: string, value: number, max: number): string {
  const share = max > 0 ? value / max : 0;
  const mix = Math.round(MIN_MIX + share * (MAX_MIX - MIN_MIX));
  return `color-mix(in srgb, ${color} ${mix}%, var(--color-card))`;
}

export function HeatmapGrid({
  columns,
  rows,
  unit = 'points',
  labelWidth = 170,
}: HeatmapGridProps) {
  const max = rows.reduce(
    (m, r) => Math.max(m, ...columns.map((c) => r.values[c.key] ?? 0)),
    0
  );
  const template = `${labelWidth}px repeat(${columns.length}, minmax(0, 1fr))`;

  return (
    <div
      className="min-w-0"
      role="table"
      aria-label="Points by event and house"
    >
      {/* Column headings — a swatch + the name, so identity is never colour alone. */}
      <div
        className="grid items-end gap-1 pb-1.5"
        style={{ gridTemplateColumns: template }}
        role="row"
      >
        <span role="columnheader" className="sr-only">
          Event
        </span>
        {columns.map((c) => (
          <span
            key={c.key}
            role="columnheader"
            className={cn(
              'flex min-w-0 items-center justify-center gap-1.5 text-[11px]',
              c.emphasis
                ? 'font-semibold text-foreground'
                : 'font-medium text-ink-3'
            )}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: c.color }}
            />
            <span className="truncate">{c.label}</span>
          </span>
        ))}
      </div>

      <div className="relative">
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div
              key={r.key}
              className="grid gap-1"
              style={{ gridTemplateColumns: template }}
              role="row"
            >
              <HoverHint
                hint={
                  r.fullLabel && r.fullLabel !== r.label
                    ? r.fullLabel
                    : undefined
                }
                focusable={false}
              >
                <span
                  role="rowheader"
                  className="flex h-7 min-w-0 items-center truncate pr-2 text-[11px] text-ink-2"
                >
                  <span className="truncate">{r.label}</span>
                </span>
              </HoverHint>
              {columns.map((c) => {
                const value = r.values[c.key] ?? 0;
                const shown = value.toLocaleString('en-SG');
                return (
                  <HoverHint
                    key={c.key}
                    hint={`${r.fullLabel ?? r.label} — ${c.label}: ${shown} ${unit}`}
                    // Every cell is a hover target, but forty tab stops in one
                    // chart is worse than none; the aria-label carries the value.
                    focusable={false}
                  >
                    <span
                      role="cell"
                      aria-label={`${c.label}, ${r.fullLabel ?? r.label}: ${shown} ${unit}`}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-md font-mono text-[11px] tabular-nums',
                        value === 0
                          ? 'bg-muted/50 text-ink-5'
                          : 'text-foreground',
                        value !== 0 && c.emphasis && 'font-bold',
                        value !== 0 && !c.emphasis && 'font-semibold'
                      )}
                      style={
                        value === 0
                          ? undefined
                          : {
                              backgroundColor: cellBackground(
                                c.color,
                                value,
                                max
                              ),
                            }
                      }
                    >
                      {shown}
                    </span>
                  </HoverHint>
                );
              })}
            </div>
          ))}
        </div>

        {/* The emphasised column's outline, drawn over the cells so it spans
            the whole column without adding a border to each cell. */}
        {columns.map((c, i) =>
          c.emphasis ? (
            <div
              key={c.key}
              aria-hidden
              className="pointer-events-none absolute inset-y-0 grid gap-1"
              style={{
                left: 0,
                right: 0,
                gridTemplateColumns: template,
                gridTemplateRows: '1fr',
              }}
            >
              <div
                className="-m-0.5 rounded-lg border-2"
                style={{
                  gridColumn: i + 2,
                  borderColor: c.color,
                }}
              />
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
