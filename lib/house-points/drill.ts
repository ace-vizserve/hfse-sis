import { buildCsv } from '@/lib/csv';
import {
  awardSummary,
  type HouseBreakdown,
  type HouseEntryLine,
  type HouseEventLine,
  type HouseStudentLine,
} from '@/lib/house-points/house-breakdown';
import { EVENT_TYPE_SHORT_LABELS } from '@/lib/house-points/standings';

// The drill sheets on /records/house-points/houses/[code] — which rows each
// KPI card or chart mark opens, and the CSV each sheet downloads. Pure and
// client-safe: every row is already in the page's `HouseBreakdown`
// (house-breakdown.ts), so the sheets filter it in the browser rather than
// calling a route. The sheet itself is the shared DrillDownSheet
// (components/dashboard/drill-down-sheet.tsx).

/** What was clicked. Entry drills list awards; the others their own row shape. */
export type HouseEntryDrill =
  | { target: 'entries' }
  | { target: 'award'; label: string; awards: string[] }
  | { target: 'event'; eventId: string }
  | { target: 'student'; studentId: string };

/** Every award this house earned that the clicked thing covers. */
export function entryRowsFor(
  entries: readonly HouseEntryLine[],
  drill: HouseEntryDrill
): HouseEntryLine[] {
  switch (drill.target) {
    case 'entries':
      return [...entries];
    case 'award': {
      const wanted = new Set(drill.awards);
      return entries.filter((e) => wanted.has(e.award));
    }
    case 'event':
      return entries.filter((e) => e.eventId === drill.eventId);
    case 'student':
      return entries.filter((e) => e.studentIds.includes(drill.studentId));
  }
}

/** The "Events scored in" card's rows — events with at least one point. */
export function scoringEvents(
  events: readonly HouseEventLine[]
): HouseEventLine[] {
  return events.filter((e) => e.points > 0);
}

/** The "Students who earned points" card's rows. */
export function scoringStudents(
  students: readonly HouseStudentLine[]
): HouseStudentLine[] {
  return students.filter((s) => s.points > 0);
}

/** One event as one house scored it — a house-share slice's rows. */
export type HouseStandingEventRow = {
  eventId: string;
  name: string;
  heldOn: string | null;
  points: number;
  /** Place among the houses that event (ties share); null when it scored nothing. */
  place: number | null;
  houseCount: number;
};

/**
 * Every event `houseId` scored in, oldest first, with its place among the
 * houses that event — ties share a place, as on the standings.
 */
export function houseEventRows(
  eventTotals: HouseBreakdown['eventTotals'],
  houseId: string
): HouseStandingEventRow[] {
  const rows: HouseStandingEventRow[] = [];
  for (const e of eventTotals) {
    const points = e.totals[houseId] ?? 0;
    if (points <= 0) continue;
    const values = Object.values(e.totals);
    rows.push({
      eventId: e.id,
      name: e.name,
      heldOn: e.heldOn,
      points,
      place: 1 + values.filter((v) => v > points).length,
      houseCount: values.length,
    });
  }
  return rows;
}

// ── Columns + CSV ──────────────────────────────────────────────────────────
// One key list per row shape. The sheet shows the same labels as headers,
// and the CSV writes only the columns left visible, in this order.

export type EntryColumnKey =
  | 'event'
  | 'date'
  | 'type'
  | 'entrant'
  | 'class'
  | 'award'
  | 'points';

export const ENTRY_COLUMN_LABELS: Record<EntryColumnKey, string> = {
  event: 'Event',
  date: 'Date',
  type: 'Type',
  entrant: 'Student or team',
  class: 'Class',
  award: 'Award',
  points: 'Points',
};

export const ALL_ENTRY_COLUMNS: EntryColumnKey[] = [
  'event',
  'date',
  'type',
  'entrant',
  'class',
  'award',
  'points',
];

/** Date and type start hidden on a drill already narrowed to one event. */
export function defaultEntryColumns(drill: HouseEntryDrill): EntryColumnKey[] {
  if (drill.target === 'event') {
    return ['entrant', 'class', 'award', 'points'];
  }
  return ['event', 'date', 'entrant', 'class', 'award', 'points'];
}

/** "Whole house" / a team's name / a student's name — the Student or team cell as text. */
export function entrantLabel(e: HouseEntryLine, houseName: string): string {
  if (e.kind === 'house') return `${houseName} (whole house)`;
  if (e.kind === 'team') return `${e.entrant ?? 'Team'} (team)`;
  return e.entrant ?? 'Unknown student';
}

/** A team's members as "Name (Class)", this house's first; others marked. */
export function teamMembersLabel(e: HouseEntryLine): string {
  return [...e.members]
    .sort((a, b) => Number(b.inHouse) - Number(a.inHouse))
    .map(
      (m) =>
        `${m.name} (${m.sectionName})${m.inHouse ? '' : ' — another house'}`
    )
    .join('; ');
}

function entryCell(
  e: HouseEntryLine,
  key: EntryColumnKey,
  houseName: string
): string | number {
  switch (key) {
    case 'event':
      return e.eventName;
    case 'date':
      return e.heldOn ?? '';
    case 'type':
      return EVENT_TYPE_SHORT_LABELS[e.eventType];
    case 'entrant':
      return e.kind === 'team'
        ? `${entrantLabel(e, houseName)}: ${teamMembersLabel(e)}`
        : entrantLabel(e, houseName);
    case 'class':
      return e.sectionName ?? '';
    case 'award':
      return e.award;
    case 'points':
      return e.points;
  }
}

export function entriesCsv(
  rows: readonly HouseEntryLine[],
  columns: readonly EntryColumnKey[],
  houseName: string
): string {
  const keys = ALL_ENTRY_COLUMNS.filter((k) => columns.includes(k));
  return buildCsv(
    keys.map((k) => ENTRY_COLUMN_LABELS[k]),
    rows.map((r) => keys.map((k) => entryCell(r, k, houseName)))
  );
}

export function eventsCsv(rows: readonly HouseEventLine[]): string {
  return buildCsv(
    ['Event', 'Date', 'Type', 'Awards won', 'Points'],
    rows.map((r) => [
      r.name,
      r.heldOn ?? '',
      EVENT_TYPE_SHORT_LABELS[r.eventType],
      awardSummary(r.awards),
      r.points,
    ])
  );
}

export function studentsCsv(rows: readonly HouseStudentLine[]): string {
  return buildCsv(
    ['Student', 'Student number', 'Class', 'Events', 'Awards won', 'Points'],
    rows.map((r) => [
      r.name,
      r.studentNumber,
      r.sectionName,
      r.eventCount,
      awardSummary(r.awards),
      r.points,
    ])
  );
}

export function houseEventsCsv(rows: readonly HouseStandingEventRow[]): string {
  return buildCsv(
    ['Event', 'Date', 'Points', 'Place'],
    rows.map((r) => [
      r.name,
      r.heldOn ?? '',
      r.points,
      r.place === null ? '' : `${r.place} of ${r.houseCount}`,
    ])
  );
}

/**
 * Chart category labels are shortened and can collide ("Inter-house relay
 * (Primar…"). Makes each label unique by numbering repeats, so a clicked bar
 * always maps back to exactly one event or student.
 */
export function uniqueCategories(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n === 1 ? label : `${label} (${n})`;
  });
}
