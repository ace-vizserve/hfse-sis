import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatPoints } from '@/lib/house-points/standings';
import { houseTileClass } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// One house's points as a §8 stat card — the year standings on
// /records/house-points and one event's totals on its own page. Shared so the
// two read as the same object at two scopes.
//
// No 'use client': it renders in the server page and inside the client score
// sheet alike.

export function HouseStatCard({
  name,
  colourToken,
  total,
  footerTitle,
  footerDetail,
}: {
  name: string;
  colourToken: string;
  total: number;
  footerTitle: string;
  footerDetail: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        {/* The house name always sits beside its colour (§9.3). */}
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {name}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[34px]">
          {formatPoints(total)}
        </CardTitle>
        <CardAction>
          <div
            className={cn(
              'size-9 rounded-xl shadow-brand-tile',
              houseTileClass(colourToken)
            )}
            aria-hidden
          />
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <p className="font-medium text-foreground">{footerTitle}</p>
        <p className="text-xs text-muted-foreground">{footerDetail}</p>
      </CardFooter>
    </Card>
  );
}
