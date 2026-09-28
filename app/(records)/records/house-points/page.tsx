import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { EventsTable } from '@/components/house-points/events-table';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import type { Role } from '@/lib/auth/roles';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { sumTotals } from '@/lib/house-points/compute';
import { loadAyEvents } from '@/lib/house-points/queries';
import { houseTileClass, listHouses, type HouseRow } from '@/lib/sis/houses';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

// House points — the year's standings and every event that fed them.
//
// Same guard as the other Records pages (the `/records` ROUTE_ACCESS row):
// admissions may VIEW, only HOUSE_POINTS_WRITERS may create or change
// anything. `canEdit` is the one switch for every write control on the page.

export default async function HousePointsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }
  const canEdit = (HOUSE_POINTS_WRITERS as readonly Role[]).includes(
    sessionUser.role
  );

  const service = createServiceClient();
  const { ay: ayParam } = await searchParams;
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  const [ayId, houses] = await Promise.all([
    getAyIdByCode(selectedAy),
    listHouses(),
  ]);
  const events = ayId ? await loadAyEvents(ayId, houses) : [];
  const totals = sumTotals(
    events.map((e) => e.totals),
    houses.map((h) => h.id)
  );
  const standings = rankStandings(houses, totals);
  const anyPoints = standings.some((s) => s.total !== 0);

  // ── ACTIONS SLOT — filled by Task 8 ("New event" + "Point scales"). ──────
  // Writers only. The same "New event" control is also the empty-state CTA,
  // so Task 8 sets `newEventAction` once and both places pick it up.
  const newEventAction: ReactNode = null;
  const actions: ReactNode = canEdit ? (
    <div className="flex flex-wrap items-center gap-2 empty:hidden">
      {newEventAction}
    </div>
  ) : null;

  return (
    <PageShell>
      <Link
        href="/records"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · House points · {selectedAy}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            House points.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every point a student earns goes to their house. Enter scores under
            an event, and placements, points and standings follow on their own.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          {actions}
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      {standings.length > 0 && (
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
            {standings.map((s) => (
              <HouseStatCard
                key={s.house.id}
                name={s.house.name}
                colourToken={s.house.colourToken}
                total={s.total}
                footerTitle={`${ordinal(s.place)} place`}
                footerDetail={anyPoints ? s.gapLabel : 'No points yet'}
              />
            ))}
          </div>
        </div>
      )}

      <EventsTable
        events={events}
        houses={houses}
        totals={totals}
        ayCode={selectedAy}
        canEdit={canEdit}
        emptyAction={canEdit ? newEventAction : null}
      />
    </PageShell>
  );
}

// ─── Standings ──────────────────────────────────────────────────────────────

type Standing = {
  house: HouseRow;
  total: number;
  place: number;
  gapLabel: string;
};

/**
 * Houses sorted by total, highest first. Ties share a place, and the ranking
 * is DENSE (46, 46, 44 → 1st, 1st, 2nd) — the same rule every event uses.
 *
 * The leader's gap is measured to the next house down; everyone else's to
 * the leader. A house level with the one it is measured against says so.
 */
function rankStandings(
  houses: HouseRow[],
  totals: Record<string, number>
): Standing[] {
  const sorted = houses
    .map((house) => ({ house, total: totals[house.id] ?? 0 }))
    .sort((a, b) => b.total - a.total || a.house.sortOrder - b.house.sortOrder);
  if (sorted.length === 0) return [];

  const leader = sorted[0];
  let place = 0;
  let previous: number | null = null;
  return sorted.map((row, index) => {
    if (previous === null || row.total !== previous) place += 1;
    previous = row.total;

    let gapLabel: string;
    if (index === 0) {
      const next = sorted[1];
      if (!next) gapLabel = 'The only house';
      else if (next.total === row.total)
        gapLabel = `Level with ${next.house.name}`;
      else
        gapLabel = `${formatPoints(row.total - next.total)} ahead of ${next.house.name}`;
    } else if (row.total === leader.total) {
      gapLabel = `Level with ${leader.house.name}`;
    } else {
      gapLabel = `${formatPoints(leader.total - row.total)} behind ${leader.house.name}`;
    }
    return { ...row, place, gapLabel };
  });
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Points are numeric(6,2) — show up to two decimals, never trailing zeros. */
function formatPoints(value: number): string {
  return value.toLocaleString('en-SG', { maximumFractionDigits: 2 });
}

function HouseStatCard({
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
