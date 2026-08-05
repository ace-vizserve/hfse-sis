import Link from 'next/link';
import { CheckCircle2, DoorClosed } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { LevelAwaitingSections } from '@/lib/sis/levels-awaiting-sections';

// The "no class to put them in" half of /records/level-mismatches. Server
// component — every row is a link out, nothing here holds state.
//
// Shape is the §8 "level / group container card" (gap-0 py-0 + a divided list)
// because this groups items by level, exactly like the section list does. The
// header tile is the FLAT §9.4 destructive tile, not the §7.4 gradient one:
// these students cannot be placed until a class exists, which is the
// hard-stop case §9.4 calls out, not an advisory note the registrar can work
// around. Counts use the §9.3 blocked recipe for the same reason.

export function LevelsAwaitingSectionsCard({
  rows,
}: {
  rows: LevelAwaitingSections[];
}) {
  if (rows.length === 0) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Classes
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Every level has a class
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl border border-brand-mint bg-brand-mint/30 text-ink">
              <CheckCircle2 className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
      </Card>
    );
  }

  const totalWaiting = rows.reduce((sum, r) => sum + r.waitingCount, 0);

  return (
    <Card className="@container/card gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Blocking enrolment
        </CardDescription>
        <CardTitle className="font-serif text-[22px] font-semibold tracking-tight text-foreground">
          No class to put them in
        </CardTitle>
        <CardAction>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <DoorClosed className="size-4" />
          </div>
        </CardAction>
      </CardHeader>

      <div className="border-b border-border bg-muted/30 px-6 py-3">
        <p className="text-sm text-muted-foreground">
          {totalWaiting.toLocaleString('en-SG')} student
          {totalWaiting === 1 ? ' is' : 's are'} enrolled at{' '}
          {rows.length === 1 ? 'a level' : `${rows.length} levels`} with no
          class yet. Create one and you can assign them.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={`${row.ayCode}::${row.levelId}`}
            className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-serif text-[15px] font-semibold text-foreground">
                  {row.levelLabel}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {row.ayCode}
                </span>
              </div>
              {row.sampleEnrolees.length > 0 && (
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {row.sampleEnrolees.slice(0, 3).join(', ')}
                  {row.waitingCount > 3 &&
                    ` +${(row.waitingCount - 3).toLocaleString('en-SG')} more`}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
              >
                <span className="tabular-nums">{row.waitingCount}</span>
                waiting
              </Badge>
              <Button asChild size="sm" variant="outline">
                <Link href="/sis/sections">Create a class</Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
