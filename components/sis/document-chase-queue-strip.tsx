import {
  AlertTriangle,
  CalendarClock,
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
        const Icon = tile.icon;
        return (
          <Sheet key={tile.target}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="block w-full text-left"
                aria-label={`${tile.label}: ${value}`}
              >
                <Card
                  className={`${TILE_CRAFT} transition-shadow hover:shadow-md`}
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
                    <div className="mt-2">
                      <ChartLegendChip
                        color={CHIP_COLOR_BY_SEVERITY[tile.severity]}
                        label={
                          tile.severity === 'bad' ? 'Needs action' : 'Awaiting'
                        }
                      />
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
