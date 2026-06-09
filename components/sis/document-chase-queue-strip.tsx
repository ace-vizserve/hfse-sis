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
  getDocumentChaseQueueCounts,
  type ChaseQueueLens,
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
};

type ChaseTile = {
  target: LifecycleDrillTarget;
  label: string;
  description: string;
  icon: typeof AlertTriangle;
  severity: 'bad' | 'warn';
};

const TILES: ChaseTile[] = [
  {
    target: 'awaiting-document-revalidation',
    label: 'Awaiting revalidation',
    description: 'Rejected or expired — parent must re-upload',
    icon: AlertTriangle,
    severity: 'bad',
  },
  {
    target: 'awaiting-document-validation',
    label: 'Awaiting validation',
    description: 'Parent uploaded — registrar to validate',
    icon: FileWarning,
    severity: 'warn',
  },
  {
    target: 'awaiting-promised-documents',
    label: 'Awaiting promised',
    description: 'Parent committed — file not sent yet',
    icon: MailQuestion,
    severity: 'warn',
  },
  {
    target: 'awaiting-expiring-documents',
    label: 'Expiring soon',
    description: 'Valid now, expiry within 30 days — chase parent for renewal',
    icon: CalendarClock,
    severity: 'warn',
  },
];

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
}: DocumentChaseQueueStripProps) {
  const counts = await getDocumentChaseQueueCounts(ayCode, moduleKey);
  const total =
    counts.promised +
    counts.validation +
    counts.revalidation +
    counts.expiringSoon;

  if (total === 0) return null;

  const valueByTarget: Record<LifecycleDrillTarget, number | undefined> = {
    'awaiting-fee-payment': undefined,
    'awaiting-document-revalidation': counts.revalidation,
    'awaiting-document-validation': counts.validation,
    'awaiting-promised-documents': counts.promised,
    'awaiting-expiring-documents': counts.expiringSoon,
    'awaiting-assessment-schedule': undefined,
    'awaiting-contract-signature': undefined,
    'missing-class-assignment': undefined,
    'ungated-to-enroll': undefined,
    'new-applications': undefined,
  };

  // Per-module tile filter — drop tiles whose backing count is zeroed out
  // for this surface (validation + promised on p-files; expiringSoon on
  // admissions). Tiles with a real zero value (no rows match) are also
  // dropped to keep the strip from showing empty cards.
  const visibleTiles = TILES.filter((tile) => {
    const value = valueByTarget[tile.target] ?? 0;
    if (value === 0) return false;
    if (
      moduleKey === 'admissions' &&
      tile.target === 'awaiting-expiring-documents'
    )
      return false;
    if (
      moduleKey === 'p-files' &&
      (tile.target === 'awaiting-document-validation' ||
        tile.target === 'awaiting-promised-documents')
    ) {
      return false;
    }
    return true;
  });

  if (visibleTiles.length === 0) return null;

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
        const value = valueByTarget[tile.target] ?? 0;
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
