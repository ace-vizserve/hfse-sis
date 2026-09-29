import {
  houseTotals,
  resolveEntries,
  sumTotals,
  type EventType,
  type Place,
} from '@/lib/house-points/compute';
import { toSheetEntries } from '@/lib/house-points/sheet-entries';
// Type-only: lib/house-points/queries.ts is `server-only`.
import type { EventRow, RosterStudent } from '@/lib/house-points/queries';

// One house's year, broken down three ways — by event, by student, by award —
// for /records/house-points/houses/[code].
//
// Pure: the loader (`loadHouseBreakdown` in queries.ts) hands it the same
// events, rubrics and rows `loadAyEvents` totals, and every figure goes
// through the same `toSheetEntries` → `resolveEntries` → `houseTotals` chain.
// So the house's total here is the standings page's figure by construction
// (asserted in __tests__/house-points/house-breakdown.test.ts).
//
// A team result credits the house ONCE (compute.ts rule 2), so the by-event
// and by-award figures count it once. The by-student list shows it under
// EVERY member of this house — that is who took part — which is why the
// student points do not add up to the house total when teams are involved.

export type BreakdownEventInput = {
  id: string;
  name: string;
  heldOn: string | null;
  eventType: EventType;
  places: Place[];
  rows: EventRow[];
};

/** One award label and how often this house holds it. */
export type AwardTally = {
  label: string;
  count: number;
  points: number;
  /** Best (lowest) rank seen for the label — only colours the medal badge. */
  rank: number | null;
};

export type HouseEventLine = {
  id: string;
  name: string;
  heldOn: string | null;
  eventType: EventType;
  awards: AwardTally[];
  points: number;
};

export type HouseStudentLine = {
  studentId: string;
  studentNumber: string;
  name: string;
  sectionName: string;
  eventCount: number;
  awards: AwardTally[];
  points: number;
};

export type HouseBreakdown = {
  total: number;
  /** Every house's year total (the standings figures) — for this house's place. */
  yearTotals: Record<string, number>;
  /** Every event of the year with every house's points, oldest first — the house-vs-house chart. */
  eventTotals: {
    id: string;
    name: string;
    heldOn: string | null;
    totals: Record<string, number>;
  }[];
  events: HouseEventLine[];
  students: HouseStudentLine[];
  awards: AwardTally[];
};

/** Medals first (by rank), then everything else by points, then name. */
function compareTallies(a: AwardTally, b: AwardTally): number {
  const ra = a.rank ?? Number.POSITIVE_INFINITY;
  const rb = b.rank ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  if (a.points !== b.points) return b.points - a.points;
  return a.label.localeCompare(b.label);
}

/** Adds one award to a label-keyed tally. Labels are grouped trimmed, as typed. */
function addAward(
  tallies: Map<string, AwardTally>,
  place: Place,
  points: number
): void {
  const label = place.label.trim();
  const existing = tallies.get(label);
  if (existing) {
    existing.count += 1;
    existing.points += points;
    if (
      place.rank !== null &&
      (existing.rank === null || place.rank < existing.rank)
    ) {
      existing.rank = place.rank;
    }
  } else {
    tallies.set(label, { label, count: 1, points, rank: place.rank });
  }
}

function sortedTallies(tallies: Map<string, AwardTally>): AwardTally[] {
  return Array.from(tallies.values()).sort(compareTallies);
}

/** "Gold ×2 · Participation ×5" — the same words the badges show, for CSV and search. */
export function awardSummary(awards: readonly AwardTally[]): string {
  return awards.map((a) => `${a.label} ×${a.count}`).join(' · ');
}

export function buildHouseBreakdown(
  events: readonly BreakdownEventInput[],
  houseId: string,
  allHouseIds: readonly string[]
): HouseBreakdown {
  const yearAwards = new Map<string, AwardTally>();
  const eventLines: HouseEventLine[] = [];
  type StudentAcc = Omit<HouseStudentLine, 'eventCount' | 'awards'> & {
    eventIds: Set<string>;
    awards: Map<string, AwardTally>;
  };
  const students = new Map<string, StudentAcc>();
  const ids = [...allHouseIds];
  const perEventTotals: Record<string, number>[] = [];

  for (const event of events) {
    const resolved = resolveEntries(toSheetEntries(event), event.places);
    const totalsForEvent = houseTotals(resolved, ids);
    perEventTotals.push(totalsForEvent);
    const eventTotal = totalsForEvent[houseId] ?? 0;

    const eventAwards = new Map<string, AwardTally>();
    let entered = false;
    event.rows.forEach((row, index) => {
      const entry = resolved[index];
      if (!entry.houseIds.includes(houseId)) return;
      entered = true;
      if (entry.place) {
        addAward(eventAwards, entry.place, entry.points);
        addAward(yearAwards, entry.place, entry.points);
      }

      // The house's own students on this entry: the entrant, or each team
      // member who belongs to this house. A house entry names no student.
      const members =
        row.kind === 'student'
          ? row.student
            ? [row.student]
            : []
          : row.kind === 'team'
            ? (row.team?.members ?? [])
            : [];
      for (const m of members) {
        if (m.houseId !== houseId) continue;
        let acc = students.get(m.studentId);
        if (!acc) {
          acc = {
            studentId: m.studentId,
            studentNumber: m.studentNumber,
            name: m.name,
            sectionName: m.sectionName,
            points: 0,
            eventIds: new Set(),
            awards: new Map(),
          };
          students.set(m.studentId, acc);
        }
        acc.eventIds.add(event.id);
        acc.points += entry.points;
        if (entry.place) addAward(acc.awards, entry.place, entry.points);
      }
    });

    if (entered) {
      eventLines.push({
        id: event.id,
        name: event.name,
        heldOn: event.heldOn,
        eventType: event.eventType,
        awards: sortedTallies(eventAwards),
        points: eventTotal,
      });
    }
  }

  const yearTotals = sumTotals(perEventTotals, ids);
  return {
    total: yearTotals[houseId] ?? 0,
    yearTotals,
    eventTotals: events
      .map((e, i) => ({
        id: e.id,
        name: e.name,
        heldOn: e.heldOn,
        totals: perEventTotals[i],
      }))
      // Undated events last; then by date, then name.
      .sort(
        (a, b) =>
          (a.heldOn ?? '9999').localeCompare(b.heldOn ?? '9999') ||
          a.name.localeCompare(b.name)
      ),
    events: eventLines.sort(
      (a, b) => b.points - a.points || a.name.localeCompare(b.name)
    ),
    students: Array.from(students.values())
      .map(({ eventIds, awards, ...rest }) => ({
        ...rest,
        eventCount: eventIds.size,
        awards: sortedTallies(awards),
      }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
    awards: sortedTallies(yearAwards),
  };
}

export type HouseMember = {
  studentId: string;
  studentNumber: string;
  name: string;
  sectionName: string;
};

const memberCollator = new Intl.Collator('en-SG', {
  numeric: true,
  sensitivity: 'base',
});

/**
 * The house's members: every student on the year's ENROLLED roster whose
 * current house is this one, once each (a student who moved class has two
 * roster rows), by class then name.
 */
export function houseMembers(
  roster: readonly RosterStudent[],
  houseId: string
): HouseMember[] {
  const byStudent = new Map<string, HouseMember>();
  for (const s of roster) {
    if (s.houseId !== houseId || byStudent.has(s.studentId)) continue;
    byStudent.set(s.studentId, {
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      name: s.name,
      sectionName: s.sectionName,
    });
  }
  return Array.from(byStudent.values()).sort(
    (a, b) =>
      memberCollator.compare(a.sectionName, b.sectionName) ||
      memberCollator.compare(a.name, b.name)
  );
}
