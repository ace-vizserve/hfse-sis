import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  FileWarning,
  MailQuestion,
} from 'lucide-react';

import {
  ChartLegendChip,
  type ChartLegendChipColor,
} from '@/components/dashboard/chart-legend-chip';
import { LifecycleDrillSheet } from '@/components/sis/drills/lifecycle-drill-sheet';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import {
  CHASE_TILE_ORDER,
  getDocumentChaseQueueCounts,
  selectVisibleChaseTiles,
  type ChaseQueueLens,
  type DocumentChaseQueueCounts,
} from '@/lib/sis/document-chase-queue';
import type { LifecycleDrillTarget } from '@/lib/sis/drill';

// ──────────────────────────────────────────────────────────────────────────
// DocumentChaseQueueStrip — top-of-fold "documents needing action" surface
// for the dashboards that own document chase work. Module-aware:
//
//   admissions  → revalidation (Rejected) · validation · promised
//                 (expiringSoon hidden — admissions doesn't chase renewals)
//   p-files     → revalidation (Expired) · expiringSoon
//                 (validation + promised hidden — those are admissions-side)
//
// Each tile is click-to-drill into the matching LifecycleDrillSheet target
// (KD #56). Defaults to 'admissions' for back-compat with existing
// /records + /admissions mounts.
//
// Spec: docs/superpowers/specs/2026-04-28-to-follow-document-flag-design.md
//       § 4 (Top-of-fold dashboard chase queue).
// ──────────────────────────────────────────────────────────────────────────

export type DocumentChaseQueueStripProps = {
  ayCode: string;
  lens?: ChaseQueueLens;
  /**
   * Pre-fetched counts. When supplied, the strip skips its own
   * `getDocumentChaseQueueCounts` call and renders from this instead — for a
   * caller (Admissions, Records) that already loaded the same counts for its
   * own CSV export, so the two reads share one fetch rather than the page and
   * the strip each querying independently for the same (ayCode, lens).
   * Omit it (P-Files, or any caller that doesn't pre-fetch) and the strip
   * fetches for itself exactly as before.
   */
  counts?: DocumentChaseQueueCounts;
};

type ChaseTilePresentation = {
  target: LifecycleDrillTarget;
  description: string;
  icon: typeof AlertTriangle;
  severity: 'bad' | 'warn';
};

type ChaseTile = ChaseTilePresentation & { label: string };

// Presentation only — label comes from CHASE_TILE_ORDER (lib/sis/
// document-chase-queue.ts) below, the SAME list the CSV export reads, so the
// screen and the file can never disagree about what a tile is called.
const TILES: ChaseTilePresentation[] = [
  {
    target: 'awaiting-document-revalidation',
    description: 'Rejected or expired — parent must re-upload',
    icon: AlertTriangle,
    severity: 'bad',
  },
  {
    target: 'awaiting-document-validation',
    description: 'Parent uploaded — registrar to validate',
    icon: FileWarning,
    severity: 'warn',
  },
  {
    target: 'awaiting-promised-documents',
    description: 'Parent committed — file not sent yet',
    icon: MailQuestion,
    severity: 'warn',
  },
  {
    target: 'awaiting-expiring-documents',
    description: 'Valid now, expiry within 30 days — chase parent for renewal',
    icon: CalendarClock,
    severity: 'warn',
  },
];

const CHASE_TILE_LABEL_BY_TARGET = new Map(
  CHASE_TILE_ORDER.map((t) => [t.target, t.label])
);

// Neutral card wash matching MetricCard's pattern — severity is communicated
// by the gradient icon tile + ChartLegendChip on each card, so the card body
// itself stays calm and consistent across tiles.
const TILE_CRAFT =
  '@container/card bg-gradient-to-t from-primary/5 to-card shadow-xs';

const ICON_TILE_CRAFT: Record<ChaseTile['severity'], string> = {
  bad: 'shadow-brand-tile-destructive bg-gradient-to-br from-destructive to-destructive/70 text-destructive-foreground',
  warn: 'shadow-brand-tile-amber bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink',
};

const CHIP_COLOR_BY_SEVERITY: Record<
  ChaseTile['severity'],
  ChartLegendChipColor
> = {
  bad: 'very-stale',
  warn: 'stale',
};

// Meter fill, matching the icon tile's severity so the card reads as one
// object. Same track idiom as the attendance section summary card
// (`h-[5px] overflow-hidden rounded-full bg-muted`) rather than a new one.
const METER_FILL_BY_SEVERITY: Record<ChaseTile['severity'], string> = {
  bad: 'bg-destructive',
  warn: 'bg-brand-amber',
};

/**
 * What share of the students in scope this tile is asking about.
 *
 * ⚠ THE UNIT IS STUDENTS, NOT DOCUMENTS. A tile counts students holding at
 * least one document in that state, so "207" is 207 students, and dividing it
 * by a document total would produce a much smaller and meaningless number.
 *
 * Returns null when there is no scope to divide by — a percentage of nothing
 * is not 0%, it is unanswerable, and the card omits the row rather than
 * showing a confident zero.
 */
function sharePct(value: number, inScope: number): number | null {
  if (inScope <= 0) return null;
  return Math.round((value / inScope) * 100);
}

/** Names the denominator in the reader's own words, per lens. */
function scopeNoun(lens: ChaseQueueLens): string {
  return lens === 'admissions' ? 'applicants' : 'enrolled students';
}

export async function DocumentChaseQueueStrip({
  ayCode,
  lens: moduleKey = 'admissions',
  counts: suppliedCounts,
}: DocumentChaseQueueStripProps) {
  const counts =
    suppliedCounts ?? (await getDocumentChaseQueueCounts(ayCode, moduleKey));

  // Shared with the Admissions dashboard CSV export
  // (lib/admissions/dashboard-export.ts) so the file's "Documents to chase"
  // section can never disagree about which tiles are showing.
  const visible = selectVisibleChaseTiles(counts, moduleKey);
  if (visible.length === 0) return null;

  const valueByTarget = new Map(visible.map((v) => [v.target, v.value]));
  const visibleTiles: ChaseTile[] = TILES.filter((tile) =>
    valueByTarget.has(tile.target)
  ).map((tile) => ({
    ...tile,
    label: CHASE_TILE_LABEL_BY_TARGET.get(tile.target) ?? tile.target,
  }));

  // Adapt grid to tile count — keeps the layout balanced across both
  // modules without an awkward 4-col grid for 2 tiles.
  const gridClass =
    visibleTiles.length >= 4
      ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-4'
      : visibleTiles.length === 3
        ? 'grid gap-4 md:grid-cols-3'
        : 'grid gap-4 md:grid-cols-2';

  return (
    <section className={gridClass} aria-label="Documents needing action">
      {visibleTiles.map((tile) => {
        const value = valueByTarget.get(tile.target) ?? 0;
        const pct = sharePct(value, counts.inScope);
        const Icon = tile.icon;
        return (
          <Sheet key={tile.target}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/25"
                aria-label={`${tile.label}: ${value} of ${counts.inScope} students. Opens the list.`}
              >
                <Card
                  className={`${TILE_CRAFT} cursor-pointer transition-shadow hover:shadow-md`}
                >
                  <CardHeader>
                    <CardAction>
                      <div
                        className={`flex size-12 items-center justify-center rounded-xl ${ICON_TILE_CRAFT[tile.severity]}`}
                      >
                        <Icon className="size-6" aria-hidden />
                      </div>
                    </CardAction>
                    <CardTitle className="font-serif text-3xl tabular-nums">
                      {value}
                    </CardTitle>
                    <CardDescription className="font-mono text-[11px] uppercase tracking-[0.12em]">
                      {tile.label}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-ink-2">{tile.description}</p>
                    {pct !== null && (
                      <div className="mt-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-serif text-lg tabular-nums text-foreground">
                            {pct}%
                          </span>
                          <span className="text-xs text-muted-foreground">
                            of {counts.inScope.toLocaleString()}{' '}
                            {scopeNoun(moduleKey)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted">
                          <span
                            className={`block h-full rounded-full ${METER_FILL_BY_SEVERITY[tile.severity]}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <ChartLegendChip
                        color={CHIP_COLOR_BY_SEVERITY[tile.severity]}
                        label={
                          tile.severity === 'bad' ? 'Needs action' : 'Awaiting'
                        }
                      />
                      {/* The card has always opened a drill sheet and never
                          said so — a hover shadow is not an affordance. This
                          names the action in the same words as the sheet's
                          own heading. */}
                      <span className="flex items-center gap-0.5 text-xs font-medium text-brand-indigo transition-transform group-hover:translate-x-0.5">
                        View students
                        <ChevronRight className="size-3.5" aria-hidden />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            </SheetTrigger>
            <LifecycleDrillSheet
              target={tile.target}
              ayCode={ayCode}
              lens={moduleKey}
            />
          </Sheet>
        );
      })}
    </section>
  );
}
