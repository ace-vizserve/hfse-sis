// The register a child has over a year, drawn deterministically.
//
// Production (prod-profile.md §5, every row of AY2025 + AY2026):
//   status   P 92.5% · EX 2.6% · A 1.8% · L 0.7% · NC ~0.02% · cleared ~0.02%
//   per-child absence (A) rate  p50 1.1–1.4% · p75 2.3–3.2% · p90 4.1–5.4% ·
//                               p99 13–14% · max 18–27%; ~30% never absent
//   late rate                   p50 0 · p90 1.7–2.3% · p99 8–11% · max 16–21%
//   EX                          medical episodes of a day or three, and family
//                               trips of several school days (vacation leave
//                               is counted in TRIPS — lib/attendance/vacation-trips.ts)
//   ex_reason / ex_note         only from AY2026 Term 3 on
//                               — 219 reasoned rows in production:
//                               mc 168 / vacation 50 / compassionate 1 —
//                               ~27% of them noted (mc note p50 29 chars,
//                               vacation p50 48), plus 25 notes on other marks.
//
// A child's propensities persist across the year; each day is drawn on its
// own stream so the register never shifts when another child's changes.

import type { AttendanceStatus, ExReason } from '@/lib/schemas/attendance';

import { pickFrom, type Distribution } from '../lib/distribution';
import { rng, type Rng } from '../lib/random';
import type { AttAy, SchoolDayRow } from './roster';

export type Mark = {
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  exNote: string | null;
};

/** What happens to a child's year beyond the ordinary draws. */
export type Special =
  | { kind: 'chronic' }
  /** Two separate vacation trips inside one term — over the 1-per-term quota. */
  | { kind: 'twoTrips'; term: number }
  /** Compassionate leave: `days` school days spread over these terms. */
  | { kind: 'compassionate'; terms: number[]; days: number };

/** Per-child absence-rate bands (fraction of school days marked A). */
const ABSENCE_BAND: Distribution<[number, number]> = [
  [[0, 0], 25],
  [[0.005, 0.022], 54],
  [[0.02, 0.05], 17],
  [[0.055, 0.1], 5],
];
const LATE_BAND: Distribution<[number, number]> = [
  [[0, 0], 58],
  [[0.003, 0.02], 34],
  [[0.02, 0.06], 7],
  [[0.08, 0.15], 1],
];
/** Medical episodes per (full) year, and their length in school days. */
const MC_EPISODES: Distribution<number> = [
  [0, 18],
  [1, 26],
  [2, 25],
  [3, 16],
  [4, 9],
  [5, 6],
];
const MC_LENGTH: Distribution<number> = [
  [1, 50],
  [2, 30],
  [3, 20],
];
const TRIP_CHANCE = 0.32;
const TRIP_LENGTH: Distribution<number> = [
  [2, 15],
  [3, 25],
  [4, 20],
  [5, 20],
  [7, 12],
  [9, 8],
];
const FULL_YEAR_DAYS = 185;

const between = (r: Rng, [lo, hi]: [number, number]) =>
  lo + (hi - lo) * r.next();

type Episode = 'mc' | 'vacation' | 'compassionate';

/**
 * The final mark for every school day in `days` (one child, one year, all of
 * their class rows together). Reasons and notes are decided afterwards by
 * `annotate`, which knows which days were entered through the app.
 */
export function drawYear(
  ay: AttAy,
  studentNumber: string,
  days: SchoolDayRow[],
  special: Special | null,
  /**
   * The special leave (two trips, compassionate days) lands on or before this
   * day, so the over-quota children are over quota on every rebuild however
   * far into Term 4 the run date is (lib/constants.ts TODAY).
   */
  pinnedUntil: string
): {
  marks: Map<string, Mark>;
  episodeOf: Map<string, Episode>;
  forced: Set<string>;
} {
  const r = rng(`attendance:year:${ay}:${studentNumber}`);
  const n = days.length;
  const status: (AttendanceStatus | null)[] = days.map(() => 'P');
  const episodeOf = new Map<string, Episode>();
  // Days whose reason is always recorded: leave that draws on a quota.
  const forced = new Set<string>();
  const share = n / FULL_YEAR_DAYS;

  let aRate = between(r, pickFrom(r, ABSENCE_BAND));
  const lRate = between(r, pickFrom(r, LATE_BAND));
  if (special?.kind === 'chronic') aRate = 0.1 + 0.07 * r.next();

  const place = (
    len: number,
    kind: Episode,
    within?: number[],
    force = false
  ) => {
    const idx = within ?? days.map((_, i) => i);
    if (idx.length === 0) return;
    const start = r.int(0, Math.max(0, idx.length - len));
    for (let k = 0; k < len && start + k < idx.length; k++) {
      const i = idx[start + k];
      status[i] = 'EX';
      episodeOf.set(days[i].date, kind);
      if (force) forced.add(days[i].date);
    }
  };

  // Medical episodes, scaled to the part of the year the child was here.
  const episodes = Math.round(pickFrom(r, MC_EPISODES) * share);
  for (let e = 0; e < episodes; e++) place(pickFrom(r, MC_LENGTH), 'mc');
  // A family trip.
  if (r.chance(TRIP_CHANCE * Math.min(1, share * 1.2)))
    place(pickFrom(r, TRIP_LENGTH), 'vacation');

  if (special?.kind === 'twoTrips') {
    const inTerm = days
      .map((d, i) =>
        d.term === special.term && d.date <= pinnedUntil ? i : -1
      )
      .filter((i) => i >= 0);
    // Two short trips with school days between them: one in each half.
    const half = Math.floor(inTerm.length / 2);
    place(2, 'vacation', inTerm.slice(1, half - 1), true);
    place(3, 'vacation', inTerm.slice(half + 1, inTerm.length - 1), true);
  }
  if (special?.kind === 'compassionate') {
    const per = Math.ceil(special.days / special.terms.length);
    let left = special.days;
    for (const t of special.terms) {
      const inTerm = days
        .map((d, i) => (d.term === t && d.date <= pinnedUntil ? i : -1))
        .filter((i) => i >= 0);
      const len = Math.min(per, left);
      place(len, 'compassionate', inTerm, true);
      left -= len;
    }
  }

  // Absences, then lates, on the days still Present.
  for (let i = 0; i < n; i++) {
    if (status[i] !== 'P') continue;
    if (r.chance(aRate)) {
      status[i] = 'A';
      // A chronic absentee's absences come in runs.
      if (special?.kind === 'chronic' && i + 1 < n && r.chance(0.5)) {
        if (status[i + 1] === 'P') status[i + 1] = 'A';
      }
    } else if (r.chance(lRate)) status[i] = 'L';
  }

  const marks = new Map<string, Mark>();
  days.forEach((d, i) =>
    marks.set(d.date, { status: status[i], exReason: null, exNote: null })
  );
  return { marks, episodeOf, forced };
}

// ── Reasons and notes (only from AY2026 Term 3 on) ────────────────────────

const MC_NOTES = [
  'MC submitted',
  'MC submitted by parent',
  'Fever — MC from clinic',
  'Flu, MC 2 days',
  'Medical cert received',
  'Parent emailed MC (stomach flu)',
  'Clinic visit, MC given',
  'MC to follow — parent called',
  'Dental appointment, MC',
  'Doctor’s note received at the office',
  'Sore throat and cough, MC',
  'Hospital follow-up check-up; MC from the specialist',
];
const VACATION_NOTES = [
  'Family trip to Manila, approved',
  'Family holiday — parent informed the office in advance',
  'Travelling with family to Cebu',
  'Vacation leave approved by the principal',
  'Family trip abroad; letter submitted to the adviser',
  'Home visit to the Philippines for a family occasion',
  'Parent filed vacation leave for a family wedding overseas',
];
const COMPASSIONATE_NOTES = [
  'Bereavement in the family',
  'Family emergency — grandparent hospitalised',
];
const OTHER_NOTES: Record<'P' | 'L' | 'A', string[]> = {
  P: ['Left early for a dental appointment', 'Picked up at 12nn by parent'],
  L: [
    'School bus delayed',
    'Late — traffic on the expressway',
    'Arrived 8:20, parent informed',
    'Late, came from a clinic appointment',
  ],
  A: [
    'Parent informed via WhatsApp',
    'No word from parent yet',
    'Unwell, parent called in the morning',
    'Absent — parent to send a letter',
  ],
};

/**
 * Puts reasons and notes on the marks of the days that carry them —
 * production has them only from AY2026 Term 3 on (`reasonShare` > 0 there,
 * 0 before). `reasonShare` is the chance an EX episode carries its reason
 * (the teacher picks MC / vacation / compassionate in the mark's menu); a
 * quarter-ish of reasoned days also get a note.
 */
export function annotate(
  ay: AttAy,
  studentNumber: string,
  marks: Map<string, Mark>,
  episodeOf: Map<string, Episode>,
  forced: Set<string>,
  reasonShare: (date: string) => number
): void {
  const r = rng(`attendance:notes:${ay}:${studentNumber}`);
  // One reason decision per episode (consecutive days of the same kind).
  let prevKind: Episode | null = null;
  let reasoned = false;
  for (const [date, m] of [...marks.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const kind = m.status === 'EX' ? (episodeOf.get(date) ?? 'mc') : null;
    if (kind !== prevKind)
      reasoned = kind !== null && r.chance(reasonShare(date));
    // Leave that draws on a quota is always recorded as such.
    if (kind !== null && (kind === 'compassionate' || forced.has(date)))
      reasoned = true;
    prevKind = kind;
    if (reasonShare(date) <= 0) continue;
    if (m.status === 'EX') {
      if (reasoned) {
        m.exReason = kind;
        if (r.chance(0.27)) {
          m.exNote =
            kind === 'vacation'
              ? r.pick(VACATION_NOTES)
              : kind === 'compassionate'
                ? r.pick(COMPASSIONATE_NOTES)
                : r.pick(MC_NOTES);
        }
      } else if (r.chance(0.01)) m.exNote = r.pick(MC_NOTES);
    } else if (
      (m.status === 'A' && r.chance(0.04)) ||
      (m.status === 'L' && r.chance(0.04)) ||
      (m.status === 'P' && r.chance(0.0015))
    ) {
      m.exNote = r.pick(OTHER_NOTES[m.status]);
    }
  }
}
