// lib/sis/backfill/calendar/reconcile.ts
// Merges HFSE's two calendar sources into one intended state. Pure.
//
// THE RULE, in one line: the published calendar is the plan, the register is
// the record, and the record wins for days that have already been taught.
//
// Why that way round. The published calendar is the only source that covers
// the whole year, states categories, and exists before the term starts — so it
// is the spine, and the only thing that can populate a term in progress. But
// the school moves things: AY2026's Leadership Camp was published for 8-10 Jul
// and actually ran 14-16 Jul, and attendance was taken against the later
// dates. Overwriting that with the plan would make the register disagree with
// the attendance it produced. So for a term already finished, the register's
// version of a date wins, and every such override is reported rather than
// applied quietly.
//
// Labels are NEVER matched across sources — only dates. The same day is
// "Labor Day" in the register and "Labour Day" on the calendar, "Marking Day"
// versus "Term 2 Marking Day", "Eye & Dental Check-up First Vaccination"
// versus "Eye and Dental Check up / First vaccination". Date is the only key
// the two sources genuinely share.
import type { LevelCode } from '../../levels';
import type { RegisterEntry } from './register-legend';
import {
  datesCovered,
  targetFor,
  type CalendarEntry,
  type CalendarKind,
} from './types';

export type ResolvedDayType =
  | 'public_holiday'
  | 'school_holiday'
  | 'hbl'
  | 'no_class';

/** One intended `school_calendar` closure. */
export interface ResolvedDay {
  date: string;
  dayType: ResolvedDayType;
  /** A school_holiday that still takes attendance from home (migration 051). */
  hblOverlay: boolean;
  label: string;
  /** 'published', 'register', or 'both'. */
  provenance: 'published' | 'register' | 'both';
}

/** One intended `calendar_events` row. */
export interface ResolvedEvent {
  startDate: string;
  endDate: string;
  label: string;
  category: NonNullable<ReturnType<typeof targetFor>['eventCategory']>;
  /** True scope; null = whole school. Not yet storable — see types.ts. */
  levels: LevelCode[] | null;
  provenance: 'published' | 'register' | 'both';
}

/** A disagreement a human has to look at, not something to apply blindly. */
export interface Conflict {
  date: string;
  what: string;
  published: string;
  register: string;
  resolution: string;
}

export interface ReconcileInput {
  published: CalendarEntry[];
  /** Register entries, already extracted, keyed by a label for the report. */
  registers: { termLabel: string; taught: boolean; entries: RegisterEntry[] }[];
  /**
   * Dates that already carry attendance marks.
   *
   * These overrule a register's masthead claim that the day was closed — the
   * register's own GRID beats the register's own HEADER. AY2026 is the worked
   * example: the T3 masthead lists "3-Sep Teacher's Day" under SCHOOL HOLIDAY,
   * the published calendar puts Teacher's Day on 4-Sep, and 3-Sep carries 338
   * marks. Teachers plainly taught on the 3rd, so the masthead has the date
   * wrong and the published calendar is right. Without this rule the merge
   * would close a day that 338 marks say was open.
   */
  datesWithMarks: ReadonlySet<string>;
}

export interface ReconcileResult {
  days: ResolvedDay[];
  events: ResolvedEvent[];
  conflicts: Conflict[];
  /** Register entries whose category the register never stated and the
   *  published calendar has nothing on that date. A human must categorise. */
  uncategorised: { date: string; label: string; termLabel: string }[];
}

const CLOSURE_KINDS: ReadonlySet<CalendarKind> = new Set([
  'public_holiday',
  'school_holiday',
  'hbl',
]);

/**
 * Register masthead entries proven wrong by the register's OWN grid.
 *
 * A masthead is typed by hand at the start of term and sometimes copied from
 * last year; the grid beside it is what teachers actually recorded. Where the
 * two disagree and the grid settles it, the entry is dropped here rather than
 * argued with every time the generator runs — otherwise a corrected row is
 * silently re-created on the next run.
 *
 * Each entry carries the evidence that retired it. Do not add one without.
 */
export const KNOWN_SOURCE_ERRORS: {
  startDate: string;
  label: string;
  why: string;
}[] = [
  {
    startDate: '2026-05-12',
    label: 'Vesak Day',
    why: "12 May 2026 carries 370 live marks — a full teaching day. Vesak 2026 is 31 May (the published calendar's date, a Sunday, with 1 Jun in lieu; both show zero marks). The T2 masthead is holding AY2025's date, when Vesak fell on 12 May.",
  },
  {
    startDate: '2026-07-05',
    label: 'Youth Day Celebration',
    why: '5 Jul 2026 is a SUNDAY and is Youth Day itself — the register tags 6 Jul SH for the day in lieu. A celebration did not happen on it. The published calendar puts the celebration on Friday 3 Jul, which carries 401 marks. The S1-S4 mastheads filed the public holiday under SCHOOL EVENTS, which also made it look secondary-only.',
  },
];

function isKnownSourceError(entry: {
  startDate: string;
  label: string;
}): boolean {
  return KNOWN_SOURCE_ERRORS.some(
    (k) =>
      k.startDate === entry.startDate &&
      k.label.toLowerCase() === entry.label.toLowerCase()
  );
}

/** Loose equality for two labels naming the same thing in different words. */
function sameThing(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '')
      // British/American and the school's own abbreviations.
      .replace(/labour/g, 'labor')
      .replace(/devt|development/g, 'dev');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const conflicts: Conflict[] = [];
  const uncategorised: ReconcileResult['uncategorised'] = [];

  // ── 1. Closures from the published calendar ────────────────────────────
  // Keyed by date: one closure per day, which is what school_calendar stores.
  const dayByDate = new Map<string, ResolvedDay>();

  for (const entry of input.published) {
    if (!CLOSURE_KINDS.has(entry.kind)) continue;
    const dayType = targetFor(entry.kind).dayType;
    if (!dayType || dayType === 'no_class') continue;
    for (const date of datesCovered(entry)) {
      const existing = dayByDate.get(date);
      if (!existing) {
        dayByDate.set(date, {
          date,
          dayType,
          hblOverlay: false,
          label: entry.label,
          provenance: 'published',
        });
        continue;
      }
      // The calendar lists 17 Jul under BOTH School Holidays and HBL, and
      // 20 Feb under HBL while the register calls it a Staff Development Day.
      // That pairing is exactly hbl_overlay: closed on paper, attendance still
      // taken from home. Keep the closure as the day type and raise the flag.
      if (existing.dayType === 'hbl' && dayType !== 'hbl') {
        dayByDate.set(date, {
          ...existing,
          dayType,
          hblOverlay: true,
          label: entry.label,
        });
      } else if (dayType === 'hbl' && existing.dayType !== 'hbl') {
        dayByDate.set(date, { ...existing, hblOverlay: true });
      }
      // Two closures of the same kind on one date (the two CNY rows) need no
      // merge — one row per date is already what we have.
    }
  }

  // ── 2. Closures from the registers ─────────────────────────────────────
  for (const reg of input.registers) {
    for (const entry of reg.entries) {
      if (isKnownSourceError(entry)) continue;
      if (entry.kind === null || !CLOSURE_KINDS.has(entry.kind)) continue;
      const dayType = targetFor(entry.kind).dayType;
      if (!dayType || dayType === 'no_class') continue;
      for (const date of datesCovered(entry)) {
        // Marks on the day beat a masthead that says it was closed — unless
        // the closure is one attendance is still taken on.
        const encodable = dayType === 'hbl';
        if (!encodable && input.datesWithMarks.has(date)) {
          const planned = dayByDate.get(date);
          conflicts.push({
            date,
            what: 'register says closed, but the day has attendance marks',
            published: planned
              ? `${planned.dayType} "${planned.label}"`
              : '(nothing on this date)',
            register: `${dayType} "${entry.label}" (${reg.termLabel})`,
            resolution:
              'register masthead REJECTED — its own grid recorded a full day of marks',
          });
          continue;
        }
        const planned = dayByDate.get(date);
        if (!planned) {
          dayByDate.set(date, {
            date,
            dayType,
            hblOverlay: false,
            label: entry.label,
            provenance: 'register',
          });
          continue;
        }
        if (planned.dayType === dayType) {
          dayByDate.set(date, { ...planned, provenance: 'both' });
          continue;
        }
        // Genuine disagreement about what KIND of closure this was.
        const registerWins = reg.taught;
        conflicts.push({
          date,
          what: 'day type',
          published: `${planned.dayType} "${planned.label}"`,
          register: `${dayType} "${entry.label}" (${reg.termLabel})`,
          resolution: registerWins
            ? 'register wins — term already taught'
            : 'published wins — term not yet taught',
        });
        if (registerWins) {
          dayByDate.set(date, {
            ...planned,
            dayType,
            label: entry.label,
            provenance: 'register',
          });
        }
      }
    }
  }

  // ── 3. Events from the published calendar ──────────────────────────────
  const events: ResolvedEvent[] = [];
  for (const entry of input.published) {
    const category = targetFor(entry.kind).eventCategory;
    if (!category) continue;
    events.push({
      startDate: entry.startDate,
      endDate: entry.endDate,
      label: entry.label,
      category,
      levels: entry.levels,
      provenance: 'published',
    });
  }

  // ── 4. Events from the registers ───────────────────────────────────────
  // A register event is ADDITIVE unless the published calendar already has
  // something of the same category on overlapping dates with a matching name.
  // The per-level exam papers are the prize here: the published calendar says
  // "Secondary School Term 3 Exam, 24-27 Aug", the register says which paper
  // each level sat on each day. Both are worth keeping, so the register's rows
  // are added alongside rather than replacing.
  for (const reg of input.registers) {
    for (const entry of reg.entries) {
      if (isKnownSourceError(entry)) continue;
      if (entry.kind !== null && CLOSURE_KINDS.has(entry.kind)) continue;

      const overlaps = (e: ResolvedEvent) =>
        e.startDate <= entry.endDate && e.endDate >= entry.startDate;
      // Covers EXACTLY the same days. The label-agnostic fallbacks below use
      // this rather than `overlaps`, because the published set contains long
      // spans — Term Break runs 30 May to 28 Jun, subject weeks run five days,
      // Leadership Camp three — and "overlaps a span" would swallow any
      // genuinely different event that happens to fall inside one, dropping it
      // from the intended state so it is never even reported as missing.
      const sameDays = (e: ResolvedEvent) =>
        e.startDate === entry.startDate && e.endDate === entry.endDate;

      if (entry.kind === null) {
        // Free-text register entry: the source never said what kind it is.
        // A CLOSURE is the common case here — T1/T2 mastheads list Good
        // Friday, Labour Day, the marking days — and those are already
        // resolved into `dayByDate`, not `events`. Checking days first is what
        // stops every holiday in T1 and T2 being reported as uncategorised.
        if (datesCovered(entry).some((d) => dayByDate.has(d))) continue;

        // Otherwise adopt the category of a published event on the same dates;
        // if there is none, a human has to say.
        const match = events.find(
          (e) => overlaps(e) && sameThing(e.label, entry.label)
        );
        if (match) {
          match.provenance = 'both';
          continue;
        }
        const sameDate = events.find(sameDays);
        if (sameDate) {
          // Same day, different name — the register is naming the same
          // happening in the school's shorthand. Nothing to add.
          sameDate.provenance = 'both';
          continue;
        }
        uncategorised.push({
          date:
            entry.startDate === entry.endDate
              ? entry.startDate
              : `${entry.startDate}..${entry.endDate}`,
          label: entry.label,
          termLabel: reg.termLabel,
        });
        continue;
      }

      const category = targetFor(entry.kind).eventCategory;
      if (!category) continue;

      // Same date + same category = the same happening, EXCEPT for exams.
      // The school does not run two school events of one category on one day,
      // but it very much does run several different exam papers on one day —
      // that is the whole reason the per-level papers are worth keeping.
      //
      // Matching on date rather than on wording is what stops the register's
      // "Moving up and Grad Photoshoot" being filed as a second event beside
      // the calendar's "Moving up photoshoot", and "Racial Harmony
      // Celebration" beside "Racial Harmony Day Celebration". Chasing those by
      // adding abbreviations to `sameThing` is a game with no end.
      const duplicate =
        events.find(
          (e) =>
            e.category === category &&
            overlaps(e) &&
            sameThing(e.label, entry.label)
        ) ??
        (category === 'term_exam'
          ? undefined
          : events.find((e) => e.category === category && sameDays(e)));
      if (duplicate) {
        duplicate.provenance = 'both';
        // The register knows the level scope the calendar only implies.
        if (duplicate.levels === null && entry.levels !== null) {
          duplicate.levels = entry.levels;
        }
        continue;
      }

      // No overlap anywhere, but the calendar names the same thing on other
      // dates: the school MOVED it. Both versions are kept — the planned one
      // and the one that happened — and the disagreement is reported, because
      // which to keep is a judgement about the school's own records.
      // Only a PUBLISHED event can have been "moved" — `events` already holds
      // rows merged in from the registers, and two register rows sharing a
      // label is not a disagreement between sources. The S1/S2 sheets really
      // do list "Term 3 Exam (Humanities, Math Paper 2)" on both 26 and 27
      // Aug; that is two sittings, not a moved date.
      const movedFrom = events.find(
        (e) =>
          e.provenance === 'published' &&
          e.category === category &&
          !overlaps(e) &&
          sameThing(e.label, entry.label)
      );
      if (movedFrom) {
        conflicts.push({
          date: entry.startDate,
          what: `"${entry.label}" appears on different dates in each source`,
          published: `${movedFrom.startDate}..${movedFrom.endDate} "${movedFrom.label}"`,
          register: `${entry.startDate}..${entry.endDate} "${entry.label}" (${reg.termLabel})`,
          resolution: reg.taught
            ? 'both kept — the register date is what happened; drop the planned one unless you want the history'
            : 'both kept — decide which date is right',
        });
      }

      events.push({
        startDate: entry.startDate,
        endDate: entry.endDate,
        label: entry.label,
        category,
        levels: entry.levels,
        provenance: 'register',
      });
    }
  }

  // The same happening reaches us twice on T2 sheets — once from the free-text
  // masthead, once from the label printed in its own date column ("Marking
  // Day" / "Marking Day"). Collapse them so the report lists a thing once.
  const seen = new Set<string>();
  const dedupedUncategorised = uncategorised.filter((u) => {
    const key = `${u.date}|${u.label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const days = [...dayByDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  events.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.label.localeCompare(b.label)
  );
  return { days, events, conflicts, uncategorised: dedupedUncategorised };
}
