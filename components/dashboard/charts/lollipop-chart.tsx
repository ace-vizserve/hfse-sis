'use client';

import { HoverHint } from '@/components/ui/hover-hint';

/**
 * A ranked list as a lollipop: one row per item, a thin stem from zero and a
 * dot at the value, with the value printed beside the dot. Lighter than a bar
 * when every row is the same series — the dot's position carries the value
 * and the ink goes to the labels.
 *
 * Plain HTML, no recharts. Rows are drawn in the order given (pass them
 * already ranked). One series, so there is no legend: the card title names it.
 *
 * `color` is the series' fill as a CSS value that exists at runtime — for a
 * house, `houseChartColor()` (the raw `--av-house-N` token). Labels and the
 * value stay in ink whatever the colour.
 */

export type LollipopRow = {
  key: string;
  label: string;
  /** Hover text for the row — the whole name, say. Defaults to `label`. */
  hint?: string;
  value: number;
};

export type LollipopChartProps = {
  rows: LollipopRow[];
  color: string;
  /** What a value counts, for the hover hint — "points". */
  unit?: string;
  /** Room for the row labels. Defaults to 150. */
  labelWidth?: number;
  /** Minimum height, so a short list keeps the card row level. Defaults to 260. */
  minHeight?: number;
};

export function LollipopChart({
  rows,
  color,
  unit = 'points',
  labelWidth = 150,
  minHeight = 260,
}: LollipopChartProps) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);

  return (
    <ol
      className="flex flex-col justify-around"
      style={{ minHeight }}
      aria-label="Ranked list"
    >
      {rows.map((r) => {
        const pct = max > 0 ? Math.max(0, r.value / max) * 100 : 0;
        const shown = r.value.toLocaleString('en-SG');
        return (
          <HoverHint
            key={r.key}
            hint={`${r.hint ?? r.label} — ${shown} ${unit}`}
            focusable={false}
          >
            <li
              className="grid h-6 items-center gap-3"
              style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}
            >
              <span className="truncate text-right text-[11px] text-ink-2">
                {r.label}
              </span>
              {/* The track leaves room at the right for the value beside the
                  longest stem, so the top row's number is never clipped. */}
              <span className="relative block h-full pr-12">
                <span className="relative block h-full">
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                  <span
                    className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5"
                    style={{ left: `calc(${pct}% - 5px)` }}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full ring-2 ring-card"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-2">
                      {shown}
                    </span>
                  </span>
                </span>
              </span>
            </li>
          </HoverHint>
        );
      })}
    </ol>
  );
}
