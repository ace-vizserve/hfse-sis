// The weekly check's options, their words, and the mark a class's week shows.
//
// Kept apart from `lib/sow/checks.ts` (which writes and reads the rows with
// the service client) so the SOW page — a client component — can import the
// labels and `cellMark` without pulling server code into the browser bundle.
// `lib/sow/checks.ts` re-exports everything here.

export const CHECK_OPTIONS = [
  'as_planned',
  'adjusted',
  'delayed',
  'extra',
] as const;
export type CheckOption = (typeof CHECK_OPTIONS)[number];

export const CHECK_LABELS: Record<CheckOption, string> = {
  as_planned: 'As planned',
  adjusted: 'Adjusted',
  delayed: 'Delayed',
  extra: 'Extra activities',
};

/** The note's label for each option that needs one (board 7). */
export const CHECK_NOTE_PROMPTS: Record<
  Exclude<CheckOption, 'as_planned'>,
  string
> = {
  adjusted: 'What did you adjust?',
  delayed: 'What was delayed, and why?',
  extra: 'What did you add?',
};

/** The note box's example text, per option (board 7). */
export const CHECK_NOTE_PLACEHOLDERS: Record<
  Exclude<CheckOption, 'as_planned'>,
  string
> = {
  adjusted: 'e.g. Relief day on Wed; Worksheet 1 finished as homework',
  delayed: 'e.g. PTC days cut two lessons; Ch 3.4 continues into Week 4',
  extra: 'e.g. Extra lab demo on separating mixtures',
};

/** A note is rich text, capped on its prose (proseLength): a few sentences. */
export const CHECK_NOTE_MAX = 1000;

export const isCheckOption = (v: unknown): v is CheckOption =>
  typeof v === 'string' && (CHECK_OPTIONS as readonly string[]).includes(v);

/**
 * The mark a class's week shows (spec §5.1, oversight grid):
 *
 *   note    — any teacher's latest check is not "As planned" (the most
 *             serious mark wins, even while a co-teacher has not checked yet)
 *   ok      — every assigned teacher checked, all "As planned"
 *   missed  — the week is over and someone has not checked
 *   todo    — not yet
 *
 * `latestChecks` must already be the newest row per teacher.
 */
export type CellMark = 'ok' | 'note' | 'missed' | 'todo';

export function cellMark(input: {
  teacherIds: string[];
  latestChecks: { teacherUserId: string; option: CheckOption }[];
  weekEnded: boolean;
}): CellMark {
  if (input.latestChecks.some((c) => c.option !== 'as_planned')) return 'note';
  const checked = new Set(input.latestChecks.map((c) => c.teacherUserId));
  const everyone = input.teacherIds.every((id) => checked.has(id));
  // `every` is true of an empty list: a class with nobody assigned and no
  // check is not "ok", it is simply unchecked.
  if (everyone && (input.teacherIds.length > 0 || checked.size > 0)) {
    return 'ok';
  }
  return input.weekEnded ? 'missed' : 'todo';
}
