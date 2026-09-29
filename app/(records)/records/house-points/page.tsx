import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { EventsTable } from '@/components/house-points/events-table';
import { HouseStatCard } from '@/components/house-points/house-stat-card';
import { NewEventSheet } from '@/components/house-points/new-event-sheet';
import { PointScalesSheet } from '@/components/house-points/point-scales-sheet';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import type { Role } from '@/lib/auth/roles';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { sumTotals } from '@/lib/house-points/compute';
import { ordinal } from '@/lib/house-points/defaults';
import {
  loadAyEvents,
  loadScales,
  type Scale,
} from '@/lib/house-points/queries';
import { rankStandings } from '@/lib/house-points/standings';
import { listHouses } from '@/lib/sis/houses';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

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

  // The point scales are only loaded for writers: nobody else can open
  // either sheet that uses them.
  const [ayId, houses, scales] = await Promise.all([
    getAyIdByCode(selectedAy),
    listHouses(),
    canEdit ? loadScales() : Promise.resolve<Scale[]>([]),
  ]);
  const events = ayId ? await loadAyEvents(ayId, houses) : [];
  const totals = sumTotals(
    events.map((e) => e.totals),
    houses.map((h) => h.id)
  );
  const standings = rankStandings(houses, totals);
  const anyPoints = standings.some((s) => s.total !== 0);

  // ── ACTIONS — writers only. ──────────────────────────────────────────────
  // The same "New event" control is also the empty-state CTA, so it is set
  // once and both places pick it up. "Point scales" is configuration, so it
  // is the outline button beside it — "New event" stays the one primary.
  const newEventAction: ReactNode = canEdit ? (
    <NewEventSheet ayCode={selectedAy} scales={scales} />
  ) : null;
  const actions: ReactNode = canEdit ? (
    <div className="flex flex-wrap items-center gap-2">
      <PointScalesSheet scales={scales} />
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
            Every point a student earns goes to their house. Pick each
            entrant&rsquo;s award under an event, and points and standings
            follow on their own.
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
                href={`/records/house-points/houses/${encodeURIComponent(
                  s.house.code.toLowerCase()
                )}?ay=${encodeURIComponent(selectedAy)}`}
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
