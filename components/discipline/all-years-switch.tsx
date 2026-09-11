'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * "Include prior years" on the disciplinary register.
 *
 * ⚠ IT NAVIGATES RATHER THAN FILTERING. Every other control on that table
 * narrows rows the page already has; this one changes what the page FETCHES —
 * one year (`listDisciplineForAy`) versus all of them
 * (`listDisciplineForAllAys`) — so it has to round-trip through the server.
 * Same shape and same reasoning as the switch on `/records/movements`.
 *
 * ⚠ IT DROPS `?ay=` ON PURPOSE. A year switcher and an all-years list are
 * contradictory states, and carrying the old value forward would leave the
 * page claiming to show AY2025 while listing every year. Turning the switch
 * off lands on the current year, which is where the register opens anyway.
 */
export function AllYearsSwitch({ allYears }: { allYears: boolean }) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="discipline-all-years"
        checked={allYears}
        onCheckedChange={(next) =>
          startTransition(() => {
            router.push(`/classroom/discipline${next ? '?scope=all' : ''}`);
          })
        }
      />
      <Label
        htmlFor="discipline-all-years"
        className="cursor-pointer text-sm text-muted-foreground"
      >
        Include prior years
      </Label>
    </div>
  );
}
