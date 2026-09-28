import 'server-only';

// Server loaders for House Points — events, score sheets, the roster picker
// and the standing scale legend. Everything here reads with the SERVICE
// client (RLS is defence in depth per migration 181's header, not the gate:
// writes go through API routes that enforce HOUSE_POINTS_WRITERS, and reads
// here are called from server components that have already checked the
// viewer's role).
//
// POINTS STAY WITH STUDENTS WHO LATER WITHDREW. `loadRosterByIds` below
// resolves entry/team-member section_student_ids with NO enrolled filter —
// a student who was on the roster when an event ran keeps their row (and
// their house's totals keep the points) even if they withdrew afterwards.
// `loadEnrolledRoster` is the one exception: it is the picker used to ADD
// new entries, so it only offers students currently on the roster.
//
// `toSheetEntries` (lib/house-points/sheet-entries.ts, re-exported below) is the single pure mapper from a resolved EventRow to the
// SheetEntry shape lib/house-points/compute.ts ranks and totals — used by
// both `loadAyEvents` (one totals-only pass per event, for the year list)
// and `loadEvent` (the full score sheet for one event), so the grouping
// rules (a team/house always ranks as 'event'; a student ranks by
// rankWithin) live in exactly one place.

import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import type { HouseRow } from '@/lib/sis/houses';
import {
  houseTotals,
  resolveEntries,
  type EntrantKind,
  type EventType,
  type Place,
  type PlacementMode,
  type RankWithin,
} from '@/lib/house-points/compute';
import { toSheetEntries } from '@/lib/house-points/sheet-entries';

type ServiceClient = ReturnType<typeof createServiceClient>;

// ─────────────────────────────────────────────────────────────────────────
// Public types (Task 4 brief, verbatim)

export type RosterStudent = {
  sectionStudentId: string;
  studentId: string;
  studentNumber: string;
  name: string; // "LAST, First Middle"
  sectionId: string;
  sectionName: string;
  levelId: string;
  levelLabel: string;
  houseId: string | null;
};

export type EventSummary = {
  id: string;
  name: string;
  heldOn: string | null;
  eventType: EventType;
  entrantKind: EntrantKind;
  placementMode: PlacementMode;
  entrantCount: number;
  totals: Record<string, number>; // keyed by house id
};

export type EventDetail = EventSummary & {
  academicYearId: string;
  ayCode: string;
  maxScore: number | null;
  rankWithin: RankWithin;
  places: Place[];
  rows: EventRow[]; // one per entry, in display order
};

export type EventRow = {
  entryId: string;
  kind: EntrantKind;
  score: number | null;
  placeId: string | null;
  student: RosterStudent | null; // kind 'student'
  team: { id: string; name: string; members: RosterStudent[] } | null; // kind 'team'
  houseId: string | null; // kind 'house'
};

export type Scale = {
  eventType: EventType;
  rows: {
    label: string;
    rank: number | null;
    points: number;
    sortOrder: number;
  }[];
};

// ─────────────────────────────────────────────────────────────────────────
// Pure mapper — no Supabase. It lives in lib/house-points/sheet-entries.ts
// (client-safe: the score sheet runs it in the browser) and is re-exported
// here so the loaders below and __tests__/house-points/queries-shape.test.ts
// keep reading it from this module.

export { toSheetEntries };

// ─────────────────────────────────────────────────────────────────────────
// Numeric coercion. `numeric(6,2)` / `numeric(8,2)` columns — defensive
// against a driver that returns them as strings (PostgREST itself emits bare
// JSON numbers for `numeric`, but nothing here should silently string-concat
// if that ever changes).
//
// Exported: the House Points write routes (e.g.
// app/api/house-points/events/[eventId]/route.ts) read these same
// `numeric` columns and need the identical coercion — reused here rather
// than re-implemented, so there is exactly one place that decides how a
// `numeric` column becomes a JS number.

export function toNum(value: number | string): number {
  return typeof value === 'string' ? Number(value) : value;
}
export function toNumOrNull(value: number | string | null): number | null {
  return value === null ? null : toNum(value);
}

// ─────────────────────────────────────────────────────────────────────────
// Roster join — shared by loadEnrolledRoster (ENROLLED only) and
// loadRosterByIds (no enrolled filter — see the file header).
//
// Join shape follows lib/sis/records-insights.ts:364-373 and
// app/(classroom)/classroom/[sectionId]/students/page.tsx:62-94.

type StudentJoin = {
  id: string;
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  house_id: string | null;
};

type LevelJoin = { id: string; code: string; label: string };

type SectionJoin = {
  id: string;
  name: string;
  level_id: string;
  levels: LevelJoin | LevelJoin[] | null;
};

type SectionStudentJoinRow = {
  id: string;
  student: StudentJoin | StudentJoin[] | null;
  section: SectionJoin | SectionJoin[] | null;
};

/** PostgREST embeds a to-one relationship as either an object or a 1-element array depending on the join. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toRosterStudent(row: SectionStudentJoinRow): RosterStudent | null {
  const s = one(row.student);
  const sec = one(row.section);
  if (!s || !sec) return null;
  const lvl = one(sec.levels);
  return {
    sectionStudentId: row.id,
    studentId: s.id,
    studentNumber: s.student_number,
    name: [s.last_name, s.first_name, s.middle_name].filter(Boolean).join(', '),
    sectionId: sec.id,
    sectionName: sec.name,
    levelId: sec.level_id,
    levelLabel: lvl?.label?.trim() || lvl?.code?.trim() || '',
    houseId: s.house_id,
  };
}

const ROSTER_JOIN =
  'id, student:students(id, student_number, last_name, first_name, middle_name, house_id), section:sections(id, name, level_id, levels(id, code, label))';

// Same join, but `sections!inner` + `academic_year_id` selected so the
// `.eq('section.academic_year_id', ...)` embedded filter below can apply —
// only loadEnrolledRoster needs the year scope; loadRosterByIds resolves ids
// that are already known to belong to specific events.
const ENROLLED_ROSTER_JOIN =
  'id, student:students(id, student_number, last_name, first_name, middle_name, house_id), section:sections!inner(id, name, level_id, academic_year_id, levels(id, code, label))';

/**
 * Resolves section_student ids to roster rows with NO enrolled filter —
 * "points stay with students who later withdrew" (Task 4 brief). Used to
 * resolve both an entry's own student and a team's members.
 *
 * `fetchInChunks` because ids are section_student UUIDs (~37 bytes each) and
 * an AY-wide id list is already past the `.in()` URL-length ceiling;
 * `fetchAllPages` inside each chunk because the row count can still exceed
 * PostgREST's 1000-row cap for a busy year.
 *
 * Exported: Task 6's entry PATCH/DELETE routes resolve a single student's
 * name for the audit log's `studentLead` (lib/audit/humanize.ts) the same
 * way `loadAyEvents`/`loadEvent` do here — one function, not a second
 * student-name join reimplemented in the route file.
 */
export async function loadRosterByIds(
  service: ServiceClient,
  ids: readonly string[]
): Promise<Map<string, RosterStudent>> {
  const map = new Map<string, RosterStudent>();
  if (ids.length === 0) return map;
  const rows = await fetchInChunks(ids, (slice) =>
    fetchAllPages<SectionStudentJoinRow>((from, to) =>
      service
        .from('section_students')
        .select(ROSTER_JOIN)
        .in('id', slice)
        .range(from, to)
    )
  );
  for (const row of rows) {
    const student = toRosterStudent(row);
    if (student) map.set(row.id, student);
  }
  return map;
}

/** ENROLLED only — the picker used to add new entries to an event. */
export async function loadEnrolledRoster(
  ayId: string
): Promise<RosterStudent[]> {
  const service = createServiceClient();
  const rows = await fetchAllPages<SectionStudentJoinRow>((from, to) =>
    service
      .from('section_students')
      .select(ENROLLED_ROSTER_JOIN)
      .eq('section.academic_year_id', ayId)
      .in('enrollment_status', ENROLLED_STATUSES)
      .range(from, to)
  );
  const students: RosterStudent[] = [];
  for (const row of rows) {
    const student = toRosterStudent(row);
    if (student) students.push(student);
  }
  return students;
}

// ─────────────────────────────────────────────────────────────────────────
// Events, places, entries, teams — DB row shapes.

type EventRowDb = {
  id: string;
  name: string;
  held_on: string | null;
  event_type: EventType;
  entrant_kind: EntrantKind;
  placement_mode: PlacementMode;
  rank_within: RankWithin;
};

type EventDetailRowDb = EventRowDb & {
  max_score: number | string | null;
  academic_year_id: string;
  academic_years: { ay_code: string } | { ay_code: string }[] | null;
};

type PlaceRowDb = {
  id: string;
  event_id: string;
  label: string;
  rank: number | null;
  points: number | string;
  sort_order: number;
};

type EntryRowDb = {
  id: string;
  event_id: string;
  section_student_id: string | null;
  team_id: string | null;
  house_id: string | null;
  score: number | string | null;
  place_id: string | null;
};

type TeamRowDb = { id: string; event_id: string; name: string };
type TeamMemberRowDb = { team_id: string; section_student_id: string };

function toPlace(row: PlaceRowDb): Place {
  return {
    id: row.id,
    label: row.label,
    rank: row.rank,
    points: toNum(row.points),
    sortOrder: row.sort_order,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// loadEventForWrite — the small event shape Task 6's entry/team write routes
// need (setup + AY, no places/rows/totals). Deliberately NOT `loadEvent`
// above: that one also fetches every place, entry, team and roster row for
// the full score sheet, which a write route that only needs to check
// `entrantKind`/`placementMode`/`maxScore` and stamp `academic_year_id` for
// cache invalidation has no reason to pay for. One function so the three
// call sites (POST entries, PATCH/DELETE one entry, POST/PATCH/DELETE a
// team) read the same shape rather than three slightly different inline
// selects drifting apart.

export type EventForWrite = {
  id: string;
  name: string;
  entrantKind: EntrantKind;
  placementMode: PlacementMode;
  maxScore: number | null;
  academicYearId: string;
  ayCode: string | null;
};

type EventForWriteRowDb = {
  id: string;
  name: string;
  entrant_kind: EntrantKind;
  placement_mode: PlacementMode;
  max_score: number | string | null;
  academic_year_id: string;
  academic_years: { ay_code: string } | { ay_code: string }[] | null;
};

export async function loadEventForWrite(
  service: ServiceClient,
  eventId: string
): Promise<EventForWrite | null> {
  const { data, error } = await service
    .from('house_point_events')
    .select(
      'id, name, entrant_kind, placement_mode, max_score, academic_year_id, academic_years(ay_code)'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(`loadEventForWrite: ${error.message}`);
  if (!data) return null;
  const row = data as EventForWriteRowDb;
  const ay = one(row.academic_years);
  return {
    id: row.id,
    name: row.name,
    entrantKind: row.entrant_kind,
    placementMode: row.placement_mode,
    maxScore: toNumOrNull(row.max_score),
    academicYearId: row.academic_year_id,
    ayCode: ay?.ay_code ?? null,
  };
}

/**
 * Builds the EventRow list for one event from its own entries plus the
 * shared team/roster lookups — the same shape whether it's one event (
 * `loadEvent`) or every event in a year computed in memory (`loadAyEvents`).
 */
function buildEventRows(
  entrantKind: EntrantKind,
  entriesForEvent: EntryRowDb[],
  teamsById: Map<string, TeamRowDb>,
  memberIdsByTeamId: Map<string, string[]>,
  rosterMap: Map<string, RosterStudent>
): EventRow[] {
  return entriesForEvent.map((entry) => {
    if (entrantKind === 'team') {
      const team = entry.team_id ? teamsById.get(entry.team_id) : undefined;
      const memberIds = entry.team_id
        ? (memberIdsByTeamId.get(entry.team_id) ?? [])
        : [];
      const members = memberIds
        .map((id) => rosterMap.get(id))
        .filter((m): m is RosterStudent => Boolean(m));
      return {
        entryId: entry.id,
        kind: 'team',
        score: toNumOrNull(entry.score),
        placeId: entry.place_id,
        student: null,
        team: team ? { id: team.id, name: team.name, members } : null,
        houseId: null,
      };
    }
    if (entrantKind === 'house') {
      return {
        entryId: entry.id,
        kind: 'house',
        score: toNumOrNull(entry.score),
        placeId: entry.place_id,
        student: null,
        team: null,
        houseId: entry.house_id,
      };
    }
    // 'student'
    const student = entry.section_student_id
      ? (rosterMap.get(entry.section_student_id) ?? null)
      : null;
    return {
      entryId: entry.id,
      kind: 'student',
      score: toNumOrNull(entry.score),
      placeId: entry.place_id,
      student,
      team: null,
      houseId: null,
    };
  });
}

/** All of a set of events' team members, section_student ids collected up front. */
async function loadTeamMembers(
  service: ServiceClient,
  teamIds: readonly string[]
): Promise<TeamMemberRowDb[]> {
  if (teamIds.length === 0) return [];
  return fetchInChunks(teamIds, (slice) =>
    fetchAllPages<TeamMemberRowDb>(
      (from, to) =>
        service
          .from('house_point_team_members')
          .select('team_id, section_student_id')
          .in('team_id', slice)
          .order('team_id', { ascending: true })
          .order('section_student_id', { ascending: true })
          .range(from, to),
      undefined,
      // house_point_team_members has NO `id` column (migration 181's PK is
      // the composite (team_id, section_student_id)) — fetchAllPages'
      // default `tieBreak: 'id'` would append `.order('id')` and PostgREST
      // would error on every page request, crashing every team event's
      // loadAyEvents/loadEvent. The composite key ordered above is already
      // a total order, so tieBreak is turned off rather than pointed at it
      // (matches lib/attendance/dashboard.ts:188's pattern for the same
      // no-`id` situation).
      { tieBreak: null }
    )
  );
}

function groupByTeamId(members: TeamMemberRowDb[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of members) {
    const list = map.get(m.team_id);
    if (list) list.push(m.section_student_id);
    else map.set(m.team_id, [m.section_student_id]);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────
// loadAyEvents — one totals pass per event, no per-event queries.

/**
 * Every event run in `ayId`, with each event's per-house totals already
 * computed. Fetches places/entries/teams/members for the WHOLE year's event
 * ids in a handful of `.in('event_id', ids)` queries, then ranks and totals
 * each event in memory — never one query per event.
 */
export async function loadAyEvents(
  ayId: string,
  houses: HouseRow[]
): Promise<EventSummary[]> {
  const service = createServiceClient();
  const { data: eventRows, error: eventsError } = await service
    .from('house_point_events')
    .select(
      'id, name, held_on, event_type, entrant_kind, placement_mode, rank_within'
    )
    .eq('academic_year_id', ayId)
    .order('held_on', { ascending: false })
    .order('name', { ascending: true });
  if (eventsError) {
    throw new Error(`loadAyEvents: ${eventsError.message}`);
  }
  const events = (eventRows ?? []) as EventRowDb[];
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const houseIds = houses.map((h) => h.id);

  const [places, entries, teams] = await Promise.all([
    fetchAllPages<PlaceRowDb>((from, to) =>
      service
        .from('house_point_places')
        .select('id, event_id, label, rank, points, sort_order')
        .in('event_id', eventIds)
        .range(from, to)
    ),
    fetchAllPages<EntryRowDb>((from, to) =>
      service
        .from('house_point_entries')
        .select(
          'id, event_id, section_student_id, team_id, house_id, score, place_id'
        )
        .in('event_id', eventIds)
        .range(from, to)
    ),
    fetchAllPages<TeamRowDb>((from, to) =>
      service
        .from('house_point_teams')
        .select('id, event_id, name')
        .in('event_id', eventIds)
        .range(from, to)
    ),
  ]);

  const teamMembers = await loadTeamMembers(
    service,
    teams.map((t) => t.id)
  );
  const memberIdsByTeamId = groupByTeamId(teamMembers);

  const studentIds = new Set<string>();
  for (const e of entries) {
    if (e.section_student_id) studentIds.add(e.section_student_id);
  }
  for (const m of teamMembers) studentIds.add(m.section_student_id);
  const rosterMap = await loadRosterByIds(service, Array.from(studentIds));

  const placesByEvent = new Map<string, PlaceRowDb[]>();
  for (const p of places) {
    const list = placesByEvent.get(p.event_id);
    if (list) list.push(p);
    else placesByEvent.set(p.event_id, [p]);
  }
  const entriesByEvent = new Map<string, EntryRowDb[]>();
  for (const e of entries) {
    const list = entriesByEvent.get(e.event_id);
    if (list) list.push(e);
    else entriesByEvent.set(e.event_id, [e]);
  }
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  return events.map((event) => {
    const entriesForEvent = entriesByEvent.get(event.id) ?? [];
    const rows = buildEventRows(
      event.entrant_kind,
      entriesForEvent,
      teamsById,
      memberIdsByTeamId,
      rosterMap
    );
    const eventPlaces = (placesByEvent.get(event.id) ?? []).map(toPlace);
    const sheetEntries = toSheetEntries({
      rankWithin: event.rank_within,
      rows,
    });
    const resolved = resolveEntries(
      sheetEntries,
      eventPlaces,
      event.placement_mode
    );
    const totals = houseTotals(resolved, houseIds);
    return {
      id: event.id,
      name: event.name,
      heldOn: event.held_on,
      eventType: event.event_type,
      entrantKind: event.entrant_kind,
      placementMode: event.placement_mode,
      entrantCount: rows.length,
      totals,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// loadEvent — the full score sheet for one event.

export async function loadEvent(
  eventId: string,
  houses: HouseRow[]
): Promise<EventDetail | null> {
  const service = createServiceClient();
  const { data: eventRow, error: eventError } = await service
    .from('house_point_events')
    .select(
      'id, name, held_on, event_type, entrant_kind, placement_mode, rank_within, max_score, academic_year_id, academic_years(ay_code)'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) {
    throw new Error(`loadEvent: ${eventError.message}`);
  }
  if (!eventRow) return null;
  const event = eventRow as EventDetailRowDb;
  const ay = one(event.academic_years);

  const [placeRows, entryRows] = await Promise.all([
    fetchAllPages<PlaceRowDb>((from, to) =>
      service
        .from('house_point_places')
        .select('id, event_id, label, rank, points, sort_order')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true })
        .range(from, to)
    ),
    fetchAllPages<EntryRowDb>((from, to) =>
      service
        .from('house_point_entries')
        .select(
          'id, event_id, section_student_id, team_id, house_id, score, place_id'
        )
        .eq('event_id', eventId)
        // "Display order" = the order entries were added.
        .order('created_at', { ascending: true })
        .range(from, to)
    ),
  ]);

  let teams: TeamRowDb[] = [];
  if (event.entrant_kind === 'team') {
    teams = await fetchAllPages<TeamRowDb>((from, to) =>
      service
        .from('house_point_teams')
        .select('id, event_id, name')
        .eq('event_id', eventId)
        .range(from, to)
    );
  }
  const teamMembers = await loadTeamMembers(
    service,
    teams.map((t) => t.id)
  );
  const memberIdsByTeamId = groupByTeamId(teamMembers);

  const studentIds = new Set<string>();
  for (const e of entryRows) {
    if (e.section_student_id) studentIds.add(e.section_student_id);
  }
  for (const m of teamMembers) studentIds.add(m.section_student_id);
  const rosterMap = await loadRosterByIds(service, Array.from(studentIds));

  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const rows = buildEventRows(
    event.entrant_kind,
    entryRows,
    teamsById,
    memberIdsByTeamId,
    rosterMap
  );
  const places = placeRows.map(toPlace);
  const sheetEntries = toSheetEntries({ rankWithin: event.rank_within, rows });
  const resolved = resolveEntries(sheetEntries, places, event.placement_mode);
  const totals = houseTotals(
    resolved,
    houses.map((h) => h.id)
  );

  return {
    id: event.id,
    name: event.name,
    heldOn: event.held_on,
    eventType: event.event_type,
    entrantKind: event.entrant_kind,
    placementMode: event.placement_mode,
    entrantCount: rows.length,
    totals,
    academicYearId: event.academic_year_id,
    ayCode: ay?.ay_code ?? '',
    maxScore: toNumOrNull(event.max_score),
    rankWithin: event.rank_within,
    places,
    rows,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// loadScales — the standing per-event-type legend.

type ScaleRowDb = {
  event_type: EventType;
  label: string;
  rank: number | null;
  points: number | string;
  sort_order: number;
};

export async function loadScales(): Promise<Scale[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('house_point_scales')
    .select('event_type, label, rank, points, sort_order')
    .order('event_type', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) {
    throw new Error(`loadScales: ${error.message}`);
  }
  const rows = (data ?? []) as ScaleRowDb[];
  const byType = new Map<EventType, Scale['rows']>();
  for (const row of rows) {
    const entry = {
      label: row.label,
      rank: row.rank,
      points: toNum(row.points),
      sortOrder: row.sort_order,
    };
    const list = byType.get(row.event_type);
    if (list) list.push(entry);
    else byType.set(row.event_type, [entry]);
  }
  return Array.from(byType.entries()).map(([eventType, rowsForType]) => ({
    eventType,
    rows: rowsForType,
  }));
}
