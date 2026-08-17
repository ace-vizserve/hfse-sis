import type { NationalityByLevel } from '@/lib/admissions/insights-funnel';

// Nationality composition per year group — one full-width bar per level.
//
// WHY BARS AND NOT A MATRIX. Measured 2026-08-17: the level × nationality
// grid is only about 20% filled, so a table of counts would be four-fifths
// empty cells. A 100%-composition bar per level reads the thing actually
// being asked — is our diversity spread evenly, or concentrated in certain
// year groups — and degrades gracefully as the tail gets thin.
//
// Each bar is normalised to its own level, so a small year group is
// comparable with a large one. The headcount sits at the end of the row so
// the reader can still weight what they are looking at.
//
// Server-rendered; no chart library.

// Fixed palette positions, so a nationality keeps its colour down the whole
// column. Tokens only — never a raw hex (hard rule #7).
const SEGMENT_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-brand-navy)',
];
const OTHER_COLOR = 'var(--color-muted-foreground)';
const UNSPECIFIED_COLOR = 'var(--color-border)';

function colorFor(name: string, legend: string[]): string {
  if (name === 'Other') return OTHER_COLOR;
  if (name === 'Unspecified') return UNSPECIFIED_COLOR;
  const i = legend.indexOf(name);
  return SEGMENT_COLORS[i % SEGMENT_COLORS.length];
}

export function NationalityByLevelBars({
  data,
  unitLabel,
}: {
  data: NationalityByLevel;
  /** What one unit is, e.g. "enrolled students". */
  unitLabel: string;
}) {
  const { legend, rows } = data;
  if (rows.length === 0) return null;

  return (
    <div>
      {/* Legend first — the bars are unreadable until you know the colours. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pb-4">
        {legend.map((name) => (
          <span key={name} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: colorFor(name, legend) }}
            />
            <span className="text-[11.5px] text-muted-foreground">{name}</span>
          </span>
        ))}
      </div>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.level} className="flex items-center gap-3">
            {/* Truncates at half-width on the longer programme names, so the
                full label stays reachable on hover. */}
            <span
              className="w-24 shrink-0 truncate text-[12.5px] font-medium text-foreground"
              title={row.level}
            >
              {row.level}
            </span>
            <span className="flex h-5 flex-1 overflow-hidden rounded-md bg-muted">
              {row.segments.map((seg) => {
                const share = row.total > 0 ? (seg.count / row.total) * 100 : 0;
                return (
                  <span
                    key={seg.nationality}
                    className="h-full"
                    style={{
                      width: `${share}%`,
                      background: colorFor(seg.nationality, legend),
                    }}
                    title={`${row.level} · ${seg.nationality}: ${seg.count} (${share.toFixed(1)}%)`}
                  />
                );
              })}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[12px] font-semibold text-foreground">
              {row.total.toLocaleString('en-SG')}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3.5 border-t border-hairline pt-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Each bar is that level&apos;s own mix · number at right is {unitLabel}
      </p>
    </div>
  );
}
