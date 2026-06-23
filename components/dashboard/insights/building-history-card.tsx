import { BarChart3, Hourglass } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Placeholder for sections that either need more historical cycles ('building')
 * or simply have no data for the selected comparison year ('no-data').
 *
 * - `'building'` (default): Hourglass icon, "{label} — building history…" title.
 *   Use when the school lacks enough completed cycles for seasonal baselines.
 * - `'no-data'`: BarChart3 icon, verbatim `{label}` title (no suffix).
 *   Use when a specific comparison year has no data on record.
 *
 * Both variants share the same dashed-card shell and are fully backward-
 * compatible — existing call sites that pass no `variant` are unchanged.
 */
export function BuildingHistoryCard({
  label = 'Seasonal trends',
  detail,
  variant = 'building',
}: {
  label?: string;
  detail?: string;
  variant?: 'building' | 'no-data';
}) {
  const isBuilding = variant === 'building';

  const defaultDetail = isBuilding
    ? 'This unlocks once the school has a few completed years of data to compare against. It will fill in automatically each cycle.'
    : "This year doesn't have enough data on record to compare against. Pick a different comparison year, or leave it unset.";

  const resolvedDetail = detail ?? defaultDetail;

  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-4 p-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {isBuilding ? (
            <Hourglass className="size-5" aria-hidden />
          ) : (
            <BarChart3 className="size-5" aria-hidden />
          )}
        </div>
        <div className="space-y-1">
          <p className="font-serif text-base font-semibold text-foreground">
            {isBuilding ? `${label} — building history…` : label}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {resolvedDetail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
