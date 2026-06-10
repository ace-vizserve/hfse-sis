import { Hourglass } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Placeholder for `[needs cycles]` sections (seasonal baselines, prediction).
 * The surface is wired now; the data fills in automatically once enough
 * completed cycles exist. Honest empty-state instead of fake numbers.
 */
export function BuildingHistoryCard({
  label = 'Seasonal trends',
  detail = 'This unlocks once the school has a few completed years of data to compare against. It will fill in automatically each cycle.',
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-4 p-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Hourglass className="size-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-base font-semibold text-foreground">
            {label} — building history…
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
