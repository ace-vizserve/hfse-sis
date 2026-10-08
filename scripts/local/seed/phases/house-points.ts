// Phase "house-points" (plan phase 7): House Points events, rubrics, entries,
// teams and the awards picked on each score sheet (migration 181, KD #228).
//
// Production (prod-profile.md): 10 AY2026 events — 6 external/student, 2
// internal/student, 1 internal/team, 1 major/house — all `placement_mode`
// 'pick', `held_on` NULL; 37 places (1–25 points, Participation 5), 214
// entries (8–45 per event, every one with an award), 12 teams of 1–4.
// Locally: 8 events (5 external/student, 1 internal/student, 1 internal/team,
// 1 major/house), 30 places, ~118 entries, 8 teams of 1–4 (15 members); the
// entrants are AY2026 children who HAVE a house (a houseless child's award
// is owed to nobody).
//
// Write paths — the House Points routes, mirrored (each gates on a cookie
// session through `requireRole(HOUSE_POINTS_WRITERS)`), run as a school_admin:
//   * POST /api/house-points/events — `EventInputSchema`, `getAyIdByCode`, the
//     event row ('pick' / null max / 'event', as the route writes), its
//     places in rubric order, `house_points.event.create`;
//   * POST /api/house-points/events/[eventId]/entries — `AddEntriesSchema`,
//     `loadEventForWrite` (students vs houses vs team), every id checked
//     against `loadEnrolledRoster` / `listHouses`, the ignore-duplicates
//     upsert, `house_points.entry.add`;
//   * POST /api/house-points/events/[eventId]/teams — `TeamInputSchema`, the
//     enrolment check, one team per student per event (`studentsOnOtherTeams`
//     / `clashingStudents`), team + members + its single entry,
//     `house_points.team.create`;
//   * PATCH /api/house-points/entries/[entryId] — `EntryPatchSchema`, the
//     award must be on THIS event's rubric (awards are picked by hand, never
//     ranked), a no-op when unchanged, `house_points.entry.update`.
// Each rubric starts from the standing point scale for its type
// (`loadScales` → `placesFromScale`, as the New event drawer does) and is
// then edited the way production's were (ICAS bands, "1st place" ladders).
//
// Idempotent: an event already on record (same year + name) is not created
// again; students / houses already on a sheet are not re-added (and no
// entry.add row is logged for nothing); a team with the same name is not
// re-created; an award already picked is the route's own no-op.

import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { placesFromScale } from '@/lib/house-points/defaults';
import {
  loadEnrolledRoster,
  loadEventForWrite,
  loadEventTeamMemberships,
  loadScales,
  type RosterStudent,
} from '@/lib/house-points/queries';
import {
  clashingStudents,
  studentsOnOtherTeams,
} from '@/lib/house-points/team-membership';
import {
  AddEntriesSchema,
  EntryPatchSchema,
  EventInputSchema,
  TeamInputSchema,
  type PlaceInput,
} from '@/lib/schemas/house-points';
import { listHouses } from '@/lib/sis/houses';

import { must, service } from '../lib/local';
import { rng } from '../lib/random';
import { STAFF, emailOf, staffId } from './staff';

const AY = 'AY2026';
const WRITER = STAFF.find((s) => s.key === 'asstPrincipal')!;
const actor = () => ({
  id: staffId(WRITER),
  email: emailOf(WRITER),
  role: WRITER.roles[0] as Role,
});

type EventSpec = {
  name: string;
  eventType: 'internal' | 'external' | 'major';
  entrantKind: 'student' | 'team' | 'house';
  /** Rubric edits on top of the type's standing scale; null keeps the scale. */
  places: PlaceInput[] | null;
  /** Students (or teams) entered. */
  count: number;
  /** Who may enter (level label prefix); null = anyone with a house. */
  levels: string | null;
  /** How many entries get each ranked award, in rubric order; the rest get the last award. */
  awards: number[];
};

const P = (label: string, rank: number | null, points: number): PlaceInput => ({
  label,
  rank,
  points,
});

const EVENTS: EventSpec[] = [
  {
    name: 'ICAS Mathematics',
    eventType: 'external',
    entrantKind: 'student',
    places: [
      P('High Distinction', 1, 25),
      P('Distinction', 2, 20),
      P('Merit', 3, 15),
      P('Credit', 4, 10),
      P('Participation', null, 5),
    ],
    count: 34,
    levels: null,
    awards: [2, 5, 6, 8],
  },
  {
    name: 'Singapore Math Olympiad',
    eventType: 'external',
    entrantKind: 'student',
    places: null, // the external scale as it stands: Gold / Silver / Bronze / Participation
    count: 18,
    levels: null,
    awards: [1, 2, 3],
  },
  {
    name: 'National Spelling Bee',
    eventType: 'external',
    entrantKind: 'student',
    places: [
      P('Winner', 1, 20),
      P('Honourable Mention', 2, 17),
      P('Certificate of Participation', null, 5),
    ],
    count: 8,
    levels: 'Primary',
    awards: [1, 2],
  },
  {
    name: 'ICAS English',
    eventType: 'external',
    entrantKind: 'student',
    places: [
      P('Distinction', 1, 20),
      P('Merit', 2, 15),
      P('Credit', 3, 10),
      P('Participation', null, 5),
    ],
    count: 16,
    levels: null,
    awards: [2, 3, 4],
  },
  {
    name: 'Inter-school Art Competition',
    eventType: 'external',
    entrantKind: 'student',
    places: [
      P('Distinction', 1, 20),
      P('Certificate of Participation', null, 5),
    ],
    count: 6,
    levels: 'Secondary',
    awards: [1],
  },
  {
    name: 'Primary Spelling Bee',
    eventType: 'internal',
    entrantKind: 'student',
    places: [P('1st place', 1, 5), P('2nd place', 2, 4), P('3rd place', 3, 3)],
    count: 24,
    levels: 'Primary',
    // One winner per level heat; everyone else placed 3rd.
    awards: [6, 6],
  },
  {
    name: 'Science Fair',
    eventType: 'internal',
    entrantKind: 'team',
    places: [
      P('1st place', 1, 5),
      P('2nd place', 2, 4),
      P('3rd place', 3, 3),
      P('4th place', 4, 2),
      P('5th place', 5, 1),
    ],
    count: 8,
    levels: 'Secondary',
    awards: [1, 1, 1, 1],
  },
  {
    name: 'Sports Fest',
    eventType: 'major',
    entrantKind: 'house',
    places: null, // the major scale: Winner / 1st Runner Up / 2nd Runner Up / Participation
    count: 4,
    levels: null,
    awards: [1, 1, 1],
  },
];

const TEAM_SIZES = [2, 2, 3, 1, 2, 2, 2, 1];
const TEAM_NAMES = [
  'Team Photosynthesis',
  'The Circuit Breakers',
  'Water Warriors',
  'Solo: Solar Oven',
  'Team Catalyst',
  'Bridge Builders',
  'The Germinators',
  'Solo: Rain Gauge',
];

function requireWriter() {
  if (
    !WRITER.roles.some((r) =>
      (HOUSE_POINTS_WRITERS as readonly string[]).includes(r)
    )
  )
    throw new Error(
      `house-points: ${emailOf(WRITER)} is not a writer (the route 403s)`
    );
}

/** POST /api/house-points/events, mirrored. Returns the event id. */
async function createEvent(input: unknown): Promise<string> {
  requireWriter();
  const parsed = EventInputSchema.parse(input);
  const sb = service();
  const academicYearId = await getAyIdByCode(parsed.ayCode);
  if (!academicYearId) throw new Error('house-points: no such year (404)');
  const existing = await must(
    'house-points: existing event',
    sb
      .from('house_point_events')
      .select('id')
      .eq('academic_year_id', academicYearId)
      .eq('name', parsed.name)
  );
  if (existing.length) return (existing[0] as { id: string }).id;
  const [row] = (await must(
    'house-points: insert event',
    sb
      .from('house_point_events')
      .insert({
        academic_year_id: academicYearId,
        name: parsed.name,
        held_on: parsed.heldOn,
        event_type: parsed.eventType,
        entrant_kind: parsed.entrantKind,
        placement_mode: 'pick',
        max_score: null,
        rank_within: 'event',
        created_by: actor().id,
      })
      .select('id')
  )) as { id: string }[];
  const { error } = await sb.from('house_point_places').insert(
    parsed.places.map((p, i) => ({
      event_id: row.id,
      label: p.label,
      rank: p.rank,
      points: p.points,
      sort_order: i,
    }))
  );
  if (error) {
    await sb.from('house_point_events').delete().eq('id', row.id);
    throw new Error(`house-points: places: ${error.message}`);
  }
  await logAction({
    service: sb,
    actor: actor(),
    action: 'house_points.event.create',
    entityType: 'house_point_event',
    entityId: row.id,
    context: {
      name: parsed.name,
      eventType: parsed.eventType,
      entrantKind: parsed.entrantKind,
      heldOn: parsed.heldOn,
      places: parsed.places.map((p) => ({
        label: p.label,
        rank: p.rank,
        points: p.points,
      })),
    },
  });
  invalidateDrillTags('records', parsed.ayCode);
  return row.id;
}

/** POST /api/house-points/events/[eventId]/entries, mirrored. */
async function addEntries(eventId: string, body: unknown): Promise<number> {
  requireWriter();
  const input = AddEntriesSchema.parse(body);
  const sb = service();
  const event = await loadEventForWrite(sb, eventId);
  if (!event) throw new Error('house-points: event not found (404)');
  if (event.entrantKind === 'team')
    throw new Error('house-points: team event (400)');
  if (event.entrantKind === 'student' && input.houseIds)
    throw new Error('house-points: this event enters students (400)');
  if (event.entrantKind === 'house' && input.sectionStudentIds)
    throw new Error('house-points: this event enters houses (400)');
  let rows: Record<string, string>[];
  let conflict: string;
  let ids: string[];
  if (input.sectionStudentIds) {
    const roster = await loadEnrolledRoster(event.academicYearId);
    const valid = new Set(roster.map((r) => r.sectionStudentId));
    ids = Array.from(new Set(input.sectionStudentIds));
    if (!ids.every((id) => valid.has(id)))
      throw new Error(
        "house-points: some students aren't enrolled this year (400)"
      );
    conflict = 'event_id,section_student_id';
    rows = ids.map((id) => ({
      event_id: eventId,
      section_student_id: id,
      created_by: actor().id,
    }));
  } else {
    const houses = await listHouses();
    const valid = new Set(houses.map((h) => h.id));
    ids = Array.from(new Set(input.houseIds!));
    if (!ids.every((id) => valid.has(id)))
      throw new Error('house-points: unknown house (400)');
    conflict = 'event_id,house_id';
    rows = ids.map((id) => ({
      event_id: eventId,
      house_id: id,
      created_by: actor().id,
    }));
  }
  const inserted = await must(
    'house-points: insert entries',
    sb
      .from('house_point_entries')
      .upsert(rows, { onConflict: conflict, ignoreDuplicates: true })
      .select('id')
  );
  const added = inserted.length;
  await logAction({
    service: sb,
    actor: actor(),
    action: 'house_points.entry.add',
    entityType: 'house_point_event',
    entityId: eventId,
    context: {
      event_id: eventId,
      eventName: event.name,
      added,
      skipped: ids.length - added,
      count: added,
      ...(input.houseIds ? { houseIds: input.houseIds } : {}),
    },
  });
  if (event.ayCode) invalidateDrillTags('records', event.ayCode);
  return added;
}

/** POST /api/house-points/events/[eventId]/teams, mirrored. */
async function createTeam(eventId: string, body: unknown): Promise<void> {
  requireWriter();
  const input = TeamInputSchema.parse(body);
  const sb = service();
  const event = await loadEventForWrite(sb, eventId);
  if (!event || event.entrantKind !== 'team')
    throw new Error('house-points: not a team event (400)');
  const roster = await loadEnrolledRoster(event.academicYearId);
  const valid = new Set(roster.map((r) => r.sectionStudentId));
  const ids = Array.from(new Set(input.sectionStudentIds));
  if (!ids.every((id) => valid.has(id)))
    throw new Error(
      "house-points: some students aren't enrolled this year (400)"
    );
  const taken = studentsOnOtherTeams(
    await loadEventTeamMemberships(sb, eventId),
    null
  );
  if (clashingStudents(ids, taken).length)
    throw new Error('house-points: a student is already on another team (400)');
  const [team] = (await must(
    'house-points: insert team',
    sb
      .from('house_point_teams')
      .insert({ event_id: eventId, name: input.name })
      .select('id')
  )) as { id: string }[];
  const { error: mErr } = await sb
    .from('house_point_team_members')
    .insert(ids.map((id) => ({ team_id: team.id, section_student_id: id })));
  if (mErr) {
    await sb.from('house_point_teams').delete().eq('id', team.id);
    throw new Error(`house-points: members: ${mErr.message}`);
  }
  const { error: eErr } = await sb
    .from('house_point_entries')
    .insert({ event_id: eventId, team_id: team.id, created_by: actor().id });
  if (eErr) {
    await sb.from('house_point_teams').delete().eq('id', team.id);
    throw new Error(`house-points: team entry: ${eErr.message}`);
  }
  await logAction({
    service: sb,
    actor: actor(),
    action: 'house_points.team.create',
    entityType: 'house_point_team',
    entityId: team.id,
    context: {
      event_id: eventId,
      name: input.name,
      eventName: event.name,
      sectionStudentIds: ids,
    },
  });
  if (event.ayCode) invalidateDrillTags('records', event.ayCode);
}

/** PATCH /api/house-points/entries/[entryId], mirrored. Returns whether it changed. */
async function pickAward(
  entryId: string,
  body: unknown,
  identity: Record<string, string>
): Promise<boolean> {
  requireWriter();
  const patch = EntryPatchSchema.parse(body);
  const sb = service();
  const [entry] = (await must(
    'house-points: entry',
    sb
      .from('house_point_entries')
      .select('id, event_id, place_id')
      .eq('id', entryId)
  )) as { id: string; event_id: string; place_id: string | null }[];
  if (!entry) throw new Error('house-points: entry not found (404)');
  const event = await loadEventForWrite(sb, entry.event_id);
  if (!event) throw new Error('house-points: event not found (404)');
  const places = (await must(
    'house-points: places',
    sb.from('house_point_places').select('id, label').eq('event_id', event.id)
  )) as { id: string; label: string }[];
  const labelFor = (id: string | null) =>
    id ? (places.find((p) => p.id === id)?.label ?? null) : null;
  if (patch.placeId !== null && !places.some((p) => p.id === patch.placeId))
    throw new Error(
      "house-points: that award isn't on this event's rubric (400)"
    );
  if (patch.placeId === entry.place_id) return false;
  const { error } = await sb
    .from('house_point_entries')
    .update({
      place_id: patch.placeId,
      updated_by: actor().id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId);
  if (error) throw new Error(`house-points: update entry: ${error.message}`);
  await logAction({
    service: sb,
    actor: actor(),
    action: 'house_points.entry.update',
    entityType: 'house_point_entry',
    entityId: entryId,
    context: {
      event_id: event.id,
      eventName: event.name,
      ...identity,
      before: { placeId: entry.place_id, placeLabel: labelFor(entry.place_id) },
      after: { placeId: patch.placeId, placeLabel: labelFor(patch.placeId) },
      placeLabel: labelFor(patch.placeId),
    },
  });
  if (event.ayCode) invalidateDrillTags('records', event.ayCode);
  return true;
}

export async function runHousePoints(): Promise<void> {
  const sb = service();
  const ayId = await getAyIdByCode(AY);
  if (!ayId) throw new Error(`house-points: no ${AY}`);
  const houses = [...(await listHouses())].sort((a, b) =>
    a.code.localeCompare(b.code)
  );
  const scales = await loadScales();
  // Entrants: enrolled this year AND in a house. Sorted — the loader's order is not stable.
  const roster = (await loadEnrolledRoster(ayId))
    .filter((r) => r.houseId)
    .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));
  const byId = new Map(roster.map((r) => [r.sectionStudentId, r]));
  const houseName = new Map(houses.map((h) => [h.id, h.name]));
  let picked = 0;
  const summary: string[] = [];

  for (const spec of EVENTS) {
    const places =
      spec.places ??
      placesFromScale(scales.find((s) => s.eventType === spec.eventType));
    const eventId = await createEvent({
      ayCode: AY,
      name: spec.name,
      heldOn: null,
      eventType: spec.eventType,
      entrantKind: spec.entrantKind,
      places,
    });
    const r = rng(`house-points:${spec.name}`);
    const pool: RosterStudent[] = roster.filter(
      (s) => !spec.levels || s.levelLabel.startsWith(spec.levels)
    );

    // The sheet's entries as they stand.
    const entryRows = async () =>
      (await must(
        'house-points: entries',
        sb
          .from('house_point_entries')
          .select('id, section_student_id, team_id, house_id, place_id')
          .eq('event_id', eventId)
      )) as Array<{
        id: string;
        section_student_id: string | null;
        team_id: string | null;
        house_id: string | null;
        place_id: string | null;
      }>;
    const existing = await entryRows();

    // Entrants, in the order the awards go to them.
    let order: string[]; // entry keys: section_student_id / team name / house id
    if (spec.entrantKind === 'student') {
      const chosen = r
        .shuffle(pool)
        .slice(0, spec.count)
        .map((s) => s.sectionStudentId);
      const missing = chosen.filter(
        (id) => !existing.some((e) => e.section_student_id === id)
      );
      if (missing.length)
        await addEntries(eventId, { sectionStudentIds: missing });
      order = chosen;
    } else if (spec.entrantKind === 'house') {
      const ids = r.shuffle(houses.map((h) => h.id));
      const missing = ids.filter(
        (id) => !existing.some((e) => e.house_id === id)
      );
      if (missing.length) await addEntries(eventId, { houseIds: missing });
      order = ids;
    } else {
      const shuffled = r.shuffle(pool);
      let at = 0;
      const teams = (await must(
        'house-points: teams',
        sb.from('house_point_teams').select('id, name').eq('event_id', eventId)
      )) as { id: string; name: string }[];
      for (const [i, size] of TEAM_SIZES.entries()) {
        const members = shuffled
          .slice(at, at + size)
          .map((s) => s.sectionStudentId);
        at += size;
        if (!teams.some((t) => t.name === TEAM_NAMES[i]))
          await createTeam(eventId, {
            name: TEAM_NAMES[i],
            sectionStudentIds: members,
          });
      }
      order = TEAM_NAMES.slice(0, spec.count);
    }

    // Awards, picked by hand from the event's rubric.
    const placeRows = (await must(
      'house-points: event places',
      sb
        .from('house_point_places')
        .select('id, label, sort_order')
        .eq('event_id', eventId)
        .order('sort_order')
    )) as { id: string; label: string }[];
    const awardFor: string[] = [];
    spec.awards.forEach((n, i) => {
      for (let k = 0; k < n; k++) awardFor.push(placeRows[i].id);
    });
    const fallback = placeRows[placeRows.length - 1].id;
    const rows = await entryRows();
    const teams =
      spec.entrantKind === 'team'
        ? ((await must(
            'house-points: teams',
            sb
              .from('house_point_teams')
              .select('id, name')
              .eq('event_id', eventId)
          )) as { id: string; name: string }[])
        : [];
    for (const [i, key] of order.entries()) {
      const placeId = awardFor[i] ?? fallback;
      let entry;
      let identity: Record<string, string> = {};
      if (spec.entrantKind === 'student') {
        entry = rows.find((e) => e.section_student_id === key);
        const s = byId.get(key);
        if (s)
          identity = { studentName: s.name, studentNumber: s.studentNumber };
      } else if (spec.entrantKind === 'house') {
        entry = rows.find((e) => e.house_id === key);
        identity = { houseName: houseName.get(key) ?? '' };
      } else {
        const team = teams.find((t) => t.name === key);
        entry = rows.find((e) => e.team_id === team?.id);
        identity = { teamName: key };
      }
      if (!entry)
        throw new Error(`house-points: ${spec.name}: no entry for ${key}`);
      if (await pickAward(entry.id, { placeId }, identity)) picked++;
    }
    summary.push(`${spec.name} ${order.length}`);
  }
  console.log(`  events: ${summary.join(', ')}; awards picked now: ${picked}`);
}
