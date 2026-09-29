import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { AddParticipantsSheet } from '@/components/house-points/add-participants-sheet';
import { EditEventSheet } from '@/components/house-points/edit-event-sheet';
import { ScoreSheet } from '@/components/house-points/score-sheet';
import { TeamSheet } from '@/components/house-points/team-sheet';
import { membershipsOf } from '@/lib/house-points/team-membership';
import { PageShell } from '@/components/ui/page-shell';
import type { Role } from '@/lib/auth/roles';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import {
  loadEnrolledRoster,
  loadEvent,
  loadScales,
  type RosterStudent,
  type Scale,
} from '@/lib/house-points/queries';
import {
  EVENT_TYPE_SHORT_LABELS,
  formatEventDate,
} from '@/lib/house-points/standings';
import { listHouses } from '@/lib/sis/houses';
import { getSessionUser } from '@/lib/supabase/server';

// One house-points event: its four house totals, its rubric, and the score
// sheet itself — "basically a grading sheet". Pick each entrant's award and
// the points fill in on their own (KD #228).
//
// Same guard as /records/house-points: admissions may VIEW, only
// HOUSE_POINTS_WRITERS may change anything. `canEdit` is the one switch for
// every write control on the page, and the sheet shows plain text without it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HousePointsEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
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

  const { eventId } = await params;
  // Not a uuid → it cannot be an event, and Postgres would reject the lookup
  // outright rather than find nothing.
  if (!UUID.test(eventId)) notFound();

  const houses = await listHouses();
  const event = await loadEvent(eventId, houses);
  if (!event) notFound();

  // Writers only: nobody else can open the sheets that use these. The roster
  // is only needed where students are picked — added one by one, or ticked
  // onto a team.
  const editable = canEdit && event.eventType !== 'attendance';
  const [scales, roster] = await Promise.all([
    editable ? loadScales() : Promise.resolve<Scale[]>([]),
    canEdit && event.entrantKind !== 'house'
      ? loadEnrolledRoster(event.academicYearId)
      : Promise.resolve<RosterStudent[]>([]),
  ]);

  const participantCount = event.rows.length;
  const enteredIds = event.rows
    .map((r) => r.student?.sectionStudentId)
    .filter((id): id is string => Boolean(id));

  return (
    <PageShell>
      <Link
        href="/records/house-points"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        House points
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · House points · {EVENT_TYPE_SHORT_LABELS[event.eventType]}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {event.name}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {describeEvent(event)}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {editable && (
              <EditEventSheet
                event={{
                  id: event.id,
                  ayCode: event.ayCode,
                  name: event.name,
                  heldOn: event.heldOn,
                  // Narrowed by `editable`: an attendance event is never
                  // edited through this form.
                  eventType: event.eventType as Exclude<
                    typeof event.eventType,
                    'attendance'
                  >,
                  entrantKind: event.entrantKind,
                  places: event.places,
                }}
                participantCount={participantCount}
                scales={scales}
              />
            )}
            {event.entrantKind === 'student' && (
              <AddParticipantsSheet
                eventId={event.id}
                eventName={event.name}
                roster={roster}
                houses={houses}
                enteredIds={enteredIds}
              />
            )}
            {event.entrantKind === 'team' && (
              <TeamSheet
                eventId={event.id}
                eventName={event.name}
                roster={roster}
                houses={houses}
                memberships={membershipsOf(event.rows)}
              />
            )}
            {/* House events: no header button. The sheet itself offers
                "Set up houses" when it is empty and "Add the missing
                houses" when it is partly set up — one button each time,
                never two. */}
          </div>
        )}
      </header>

      <ScoreSheet
        eventId={event.id}
        eventName={event.name}
        roster={roster}
        entrantKind={event.entrantKind}
        places={event.places}
        rows={event.rows}
        houses={houses}
        canEdit={canEdit}
      />

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {event.ayCode} · {participantCount}{' '}
        {participantCount === 1 ? 'participant' : 'participants'}
      </p>
    </PageShell>
  );
}

function describeEvent(event: {
  heldOn: string | null;
  entrantKind: 'student' | 'team' | 'house';
}): string {
  const when = event.heldOn ? `Held on ${formatEventDate(event.heldOn)}. ` : '';
  const who =
    event.entrantKind === 'student'
      ? 'each student'
      : event.entrantKind === 'team'
        ? 'each team'
        : 'each house';
  const how = `Pick the award ${who} won; it earns that award's points.`;
  const where =
    event.entrantKind === 'student'
      ? " Each student's points go to their house."
      : event.entrantKind === 'team'
        ? " A team's points go to each house among its members."
        : '';
  return `${when}${how}${where}`;
}
