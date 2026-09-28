import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  loadEnrolledRoster,
  loadEventForWrite,
} from '@/lib/house-points/queries';
import { AddEntriesSchema } from '@/lib/schemas/house-points';
import { listHouses } from '@/lib/sis/houses';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/house-points/events/[eventId]/entries
//
// Bulk-adds either students or whole houses to an event's score sheet — never
// both in one call (AddEntriesSchema's own refine) and never for a `team`
// event, which is its own shape with a name and members (POST
// /api/house-points/events/[eventId]/teams, the sibling route).
//
// Inserted with `on conflict (…) do nothing` (upsert, `ignoreDuplicates`):
// a student or house already on the sheet is silently skipped rather than
// erroring the whole batch, so re-submitting an overlapping list is safe.
//
// Filed under `records` for cache invalidation and the audit log, matching
// every other House Points write route (see the sibling events/[eventId]
// route's header for the full reasoning).

type Ctx = { params: Promise<{ eventId: string }> };

function failure(step: string, e: unknown): NextResponse {
  console.error(
    `[house-points] entries POST failed at "${step}":`,
    e instanceof Error ? (e.stack ?? e.message) : e
  );
  return NextResponse.json(
    {
      error: 'Something went wrong',
      step,
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { detail: e instanceof Error ? e.message : String(e) }),
    },
    { status: 500 }
  );
}

export async function POST(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { eventId } = await params;

  const parsed = AddEntriesSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  let step = 'load event';
  try {
    const service = createServiceClient();
    const event = await loadEventForWrite(service, eventId);
    if (!event) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // A team event takes entries only through the teams route — a team also
    // needs a name and is entered as one unit, not a bulk add of individuals.
    if (event.entrantKind === 'team') {
      return NextResponse.json(
        {
          error:
            'This is a team event — create a team instead of adding entries directly.',
        },
        { status: 400 }
      );
    }
    if (event.entrantKind === 'student' && input.houseIds) {
      return NextResponse.json(
        { error: 'This event enters students, not houses.' },
        { status: 400 }
      );
    }
    if (event.entrantKind === 'house' && input.sectionStudentIds) {
      return NextResponse.json(
        { error: 'This event enters houses, not students.' },
        { status: 400 }
      );
    }

    let ids: string[];
    let conflictTarget: string;
    let entryRows: Record<string, string>[];

    if (input.sectionStudentIds) {
      step = 'check enrolment';
      const roster = await loadEnrolledRoster(event.academicYearId);
      const validIds = new Set(roster.map((r) => r.sectionStudentId));
      const uniqueIds = Array.from(new Set(input.sectionStudentIds));
      if (!uniqueIds.every((id) => validIds.has(id))) {
        return NextResponse.json(
          { error: "Some of those students aren't enrolled this year" },
          { status: 400 }
        );
      }
      ids = uniqueIds;
      conflictTarget = 'event_id,section_student_id';
      entryRows = ids.map((sectionStudentId) => ({
        event_id: eventId,
        section_student_id: sectionStudentId,
        created_by: auth.user.id,
      }));
    } else {
      step = 'check houses';
      const houses = await listHouses();
      const validHouseIds = new Set(houses.map((h) => h.id));
      const uniqueIds = Array.from(new Set(input.houseIds!));
      if (!uniqueIds.every((id) => validHouseIds.has(id))) {
        return NextResponse.json({ error: 'Unknown house.' }, { status: 400 });
      }
      ids = uniqueIds;
      conflictTarget = 'event_id,house_id';
      entryRows = ids.map((houseId) => ({
        event_id: eventId,
        house_id: houseId,
        created_by: auth.user.id,
      }));
    }

    step = 'insert entries';
    const { data: inserted, error: insertError } = await service
      .from('house_point_entries')
      .upsert(entryRows, {
        onConflict: conflictTarget,
        ignoreDuplicates: true,
      })
      .select('id');
    if (insertError) throw new Error(insertError.message);

    const added = inserted?.length ?? 0;
    const skipped = ids.length - added;

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.entry.add',
      // Bulk add: the entity affected is the EVENT (no single entry id
      // exists for a batch), matching the parent-container convention
      // `section.subjects.attach_many` uses for its own bulk audit row
      // (entityType: 'section', not 'subject').
      entityType: 'house_point_event',
      entityId: eventId,
      context: {
        event_id: eventId,
        eventName: event.name,
        added,
        skipped,
        count: added,
        ...(input.houseIds ? { houseIds: input.houseIds } : {}),
      },
    });

    if (event.ayCode) invalidateDrillTags('records', event.ayCode);

    return NextResponse.json({ ok: true, added, skipped }, { status: 201 });
  } catch (e) {
    return failure(step, e);
  }
}
