import { z } from 'zod';

import type {
  EntrantKind,
  EventType,
  PlacementMode,
  RankWithin,
} from '@/lib/house-points/compute';

// House Points input schemas — the write-route contract for the event,
// entry, team and scale API routes. Server-side validation is the only
// source of truth (Hard Rule #2): a client sends raw event/entry/team edits;
// these schemas are the gate before anything reaches
// lib/house-points/compute.ts's pure placement math.
//
// Every message here is written for the registrar filling in a form, not a
// developer reading a stack trace — same convention as lib/schemas/discipline.ts.

// ─────────────────────────────────────────────────────────────────────────
// String unions — OWNED by lib/house-points/compute.ts (Task 2's pure,
// framework-free module shared with the client score sheet). Re-declared
// here as zod-enum literal tuples rather than imported as zod schemas,
// because compute.ts must stay zod-free.
//
// `AssertSameUnion<A, B>` below is `true`'s type only when A and B are
// mutually assignable — i.e. the exact same set of strings, not a subset or
// superset. Assigning `true` to a value typed `AssertSameUnion<...>` makes
// any future drift (compute.ts gains/loses/renames a member and this file
// isn't updated) a compile error right here, not a runtime surprise.
type AssertSameUnion<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

export const EVENT_TYPE_VALUES = [
  'internal',
  'external',
  'major',
  'attendance',
] as const;
type _CheckEventType = AssertSameUnion<
  EventType,
  (typeof EVENT_TYPE_VALUES)[number]
>;
void (true as _CheckEventType);

// EventInputSchema deliberately does NOT accept 'attendance' — the
// Attendance Challenge event type arrives with a later feature (see the
// attendance-rejection test in __tests__/house-points/schemas.test.ts).
export const CREATABLE_EVENT_TYPE_VALUES = [
  'internal',
  'external',
  'major',
] as const satisfies readonly EventType[];

export const ENTRANT_KIND_VALUES = ['student', 'team', 'house'] as const;
type _CheckEntrantKind = AssertSameUnion<
  EntrantKind,
  (typeof ENTRANT_KIND_VALUES)[number]
>;
void (true as _CheckEntrantKind);

export const PLACEMENT_MODE_VALUES = ['score', 'pick'] as const;
type _CheckPlacementMode = AssertSameUnion<
  PlacementMode,
  (typeof PLACEMENT_MODE_VALUES)[number]
>;
void (true as _CheckPlacementMode);

export const RANK_WITHIN_VALUES = ['section', 'level', 'event'] as const;
type _CheckRankWithin = AssertSameUnion<
  RankWithin,
  (typeof RANK_WITHIN_VALUES)[number]
>;
void (true as _CheckRankWithin);

// Plain-English labels — imported by lib/audit/humanize.ts, whose header
// requires every label map to have exactly one source (it is not redefined
// there), and available to any future form that renders these choices.
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  internal: 'Internal',
  external: 'External',
  major: 'Major',
  attendance: 'Attendance Challenge',
};
export const ENTRANT_KIND_LABELS: Record<EntrantKind, string> = {
  student: 'Student',
  team: 'Team',
  house: 'House',
};
export const PLACEMENT_MODE_LABELS: Record<PlacementMode, string> = {
  score: 'By score',
  pick: 'By hand',
};
export const RANK_WITHIN_LABELS: Record<RankWithin, string> = {
  section: 'Within section',
  level: 'Within level',
  event: 'Across the whole event',
};

// `YYYY-MM-DD` — same convention and reasoning as lib/schemas/discipline.ts's
// ISO_DATE: compared as strings, matching what a native date input submits
// and what Postgres takes for a `date` column.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const uuid = (message: string) => z.string().uuid(message);

const PLACE_LABEL_MAX = 60;
const EVENT_NAME_MAX = 120;
const TEAM_NAME_MAX = 80;
const MAX_PLACES = 20;
const MAX_ADD_STUDENTS = 500;
const MAX_ADD_HOUSES = 4;
const MAX_TEAM_STUDENTS = 30;
const MAX_POINTS = 1000;

// ─────────────────────────────────────────────────────────────────────────
// Places

export const PlaceInputSchema = z.object({
  // Present when editing a place that already exists on the event; absent
  // when adding a new one. The route decides insert vs. update from this.
  id: uuid('That place could not be found.').optional(),
  label: z
    .string({ error: 'Name this place.' })
    .trim()
    .min(1, 'Name this place.')
    .max(
      PLACE_LABEL_MAX,
      `Keep the label under ${PLACE_LABEL_MAX} characters.`
    ),
  // null = "everyone else who joined but didn't place" (the workbook's flat
  // Participation row, and the two attendance bonuses) — migration 181's
  // `rank = null` convention on both house_point_places and
  // house_point_scales. Blank is not zero: an unranked place is a different
  // thing from a place ranked 0th, which the `.min(1)` below refuses anyway.
  rank: z
    .number({ error: "Enter a rank, or leave it blank for 'everyone else'." })
    .int('Rank must be a whole number.')
    .min(1, 'Rank starts at 1st place.')
    .nullable(),
  points: z
    .number({ error: 'Enter the points for this place.' })
    .min(0, "Points can't be negative.")
    .max(MAX_POINTS, `Points can't be more than ${MAX_POINTS}.`),
});
export type PlaceInput = z.infer<typeof PlaceInputSchema>;

/** Duplicate ranks, and more than one "everyone else" row. */
function placeRankIssues(places: PlaceInput[]): {
  duplicateRank: boolean;
  tooManyCatchAlls: boolean;
} {
  const ranks = places
    .map((p) => p.rank)
    .filter((r): r is number => r !== null);
  return {
    duplicateRank: new Set(ranks).size !== ranks.length,
    tooManyCatchAlls: places.filter((p) => p.rank === null).length > 1,
  };
}

/** In score mode, the ranked places must read 1st, 2nd, 3rd… with no gaps. */
function hasGaplessRanks(places: PlaceInput[]): boolean {
  const ranks = places
    .map((p) => p.rank)
    .filter((r): r is number => r !== null)
    .sort((a, b) => a - b);
  return ranks.every((r, i) => r === i + 1);
}

/** Shared by EventInputSchema and EventPatchSchema (when `places` is sent). */
function checkPlacesArray(
  places: PlaceInput[],
  placementMode: PlacementMode | undefined,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ['places']
): void {
  const { duplicateRank, tooManyCatchAlls } = placeRankIssues(places);
  if (duplicateRank) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "Two places can't share the same rank.",
    });
  }
  if (tooManyCatchAlls) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "Only one row can be 'everyone else'.",
    });
  }
  // Gap check only makes sense once ranks are at least distinct — a
  // duplicate would otherwise also fail this and pile on a second, more
  // confusing message about the same rows.
  if (placementMode === 'score' && !duplicateRank && !hasGaplessRanks(places)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'Places must go 1st, 2nd, 3rd… without gaps.',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Events

const EventInputBaseSchema = z.object({
  ayCode: z
    .string({ error: 'Missing academic year.' })
    .trim()
    .min(1, 'Missing academic year.'),
  name: z
    .string({ error: 'Name the event.' })
    .trim()
    .min(1, 'Name the event.')
    .max(EVENT_NAME_MAX, `Keep the name under ${EVENT_NAME_MAX} characters.`),
  heldOn: z
    .string()
    .regex(ISO_DATE, 'Enter the date as YYYY-MM-DD.')
    .nullable(),
  eventType: z.enum(CREATABLE_EVENT_TYPE_VALUES, {
    message: 'Choose whether this is an internal, external, or major event.',
  }),
  entrantKind: z.enum(ENTRANT_KIND_VALUES, {
    message: 'Choose who is placed: students, teams, or houses.',
  }),
  placementMode: z.enum(PLACEMENT_MODE_VALUES, {
    message: 'Choose how this event is placed: by score or by hand.',
  }),
  // null = not a scored event (placementMode 'pick'); required once
  // placementMode is 'score' — see the refinement below.
  maxScore: z
    .number({ error: 'Enter the highest possible score.' })
    .positive('Enter the highest possible score.')
    .nullable(),
  rankWithin: z.enum(RANK_WITHIN_VALUES, {
    message: 'Choose how entrants are ranked.',
  }),
  places: z
    .array(PlaceInputSchema)
    .min(1, 'Add at least one place.')
    .max(MAX_PLACES, `You can add up to ${MAX_PLACES} places.`),
});

export const EventInputSchema = EventInputBaseSchema.superRefine(
  (data, ctx) => {
    if (data.placementMode === 'score' && data.maxScore === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxScore'],
        message: 'Enter the highest possible score.',
      });
    }
    // Mirrors house_point_events_house_is_pick (migration 181): a raw score
    // has no meaning compared house-to-house without a scored roster
    // underneath it, so a house-entrant event is always judged by hand.
    if (data.entrantKind === 'house' && data.placementMode !== 'pick') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['placementMode'],
        message: 'Houses are placed by hand, not by score.',
      });
    }
    checkPlacesArray(data.places, data.placementMode, ctx);
  }
);
export type EventInput = z.infer<typeof EventInputSchema>;

// PATCH — every field but `ayCode` optional (an event never changes year,
// so there is nothing to patch), and `places` REPLACES the stored list when
// sent, rather than merging into it — there is no per-place PATCH endpoint.
//
// A patch can only validate the cross-field rules it can actually see: the
// route holds the *stored* row and the caller sends only the *changed*
// fields, so e.g. "score mode needs maxScore" is checked here only when
// BOTH keys are present in this same patch. Sending `maxScore` alone lets
// the stored `placementMode` decide, which this schema has no way to read.
export const EventPatchSchema = EventInputBaseSchema.omit({ ayCode: true })
  .partial()
  .superRefine((data, ctx) => {
    if (
      data.placementMode === 'score' &&
      'maxScore' in data &&
      data.maxScore === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxScore'],
        message: 'Enter the highest possible score.',
      });
    }
    if (
      data.entrantKind === 'house' &&
      data.placementMode !== undefined &&
      data.placementMode !== 'pick'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['placementMode'],
        message: 'Houses are placed by hand, not by score.',
      });
    }
    if (data.places) {
      checkPlacesArray(data.places, data.placementMode, ctx);
    }
  });
export type EventPatch = z.infer<typeof EventPatchSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Entries

// POST /events/[eventId]/entries — bulk-adds either students or whole
// houses to an event in one call (never both: they are different
// `entrant_kind` shapes, and mixing them in one request would silently
// misfile half the rows). Teams have their own creation route
// (TeamInputSchema) because a team also needs a name and is a shape of its
// own, not a bulk add.
export const AddEntriesSchema = z
  .object({
    sectionStudentIds: z
      .array(uuid('Unknown student.'))
      .min(1, 'Add at least one student.')
      .max(
        MAX_ADD_STUDENTS,
        `Add up to ${MAX_ADD_STUDENTS} students at a time.`
      )
      .optional(),
    houseIds: z
      .array(uuid('Unknown house.'))
      .min(1, 'Add at least one house.')
      .max(MAX_ADD_HOUSES, `There are only ${MAX_ADD_HOUSES} houses.`)
      .optional(),
  })
  .refine(
    (data) =>
      (data.sectionStudentIds !== undefined) !== (data.houseIds !== undefined),
    { message: 'Add students or houses, not both in the same request.' }
  );
export type AddEntriesInput = z.infer<typeof AddEntriesSchema>;

// PATCH one entry — a score (score mode) or a placeId (pick mode). Blank
// isn't zero here either: `score: null` clears a score back to "not
// entered", it does not mean "scored zero" (Hard Rule #3's distinction,
// carried into house points).
export const EntryPatchSchema = z
  .object({
    score: z.number().min(0, "Score can't be negative.").nullable().optional(),
    placeId: uuid('Unknown place.').nullable().optional(),
  })
  .refine((data) => data.score !== undefined || data.placeId !== undefined, {
    message: 'Nothing to update — change the score or the place.',
  });
export type EntryPatch = z.infer<typeof EntryPatchSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Teams

export const TeamInputSchema = z.object({
  name: z
    .string({ error: 'Name the team.' })
    .trim()
    .min(1, 'Name the team.')
    .max(TEAM_NAME_MAX, `Keep the name under ${TEAM_NAME_MAX} characters.`),
  sectionStudentIds: z
    .array(uuid('Unknown student.'))
    .min(1, 'Add at least one student.')
    .max(
      MAX_TEAM_STUDENTS,
      `A team can have up to ${MAX_TEAM_STUDENTS} students.`
    ),
});
export type TeamInput = z.infer<typeof TeamInputSchema>;

export const TeamPatchSchema = z
  .object({
    name: TeamInputSchema.shape.name.optional(),
    sectionStudentIds: TeamInputSchema.shape.sectionStudentIds.optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.sectionStudentIds !== undefined,
    { message: 'Nothing to update — change the name or the students.' }
  );
export type TeamPatch = z.infer<typeof TeamPatchSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Scales

// The standing per-event-type legend (house_point_scales) — unlike a place,
// a scale row is never edited in place by id; a PUT replaces the whole
// ladder for one event_type, so no `id` field is needed here.
export const ScaleRowSchema = PlaceInputSchema.omit({ id: true });
export type ScaleRow = z.infer<typeof ScaleRowSchema>;

// PUT — replaces the whole ladder for one event_type. `eventType` here
// includes 'attendance' (unlike EventInputSchema's create/update), because
// the scale for the Attendance Challenge's two flat bonuses already exists
// in the seed (migration 181) even though no event of that type can be
// created through EventInputSchema yet.
export const ScalesPutSchema = z.object({
  eventType: z.enum(EVENT_TYPE_VALUES, {
    message: 'Choose an event type.',
  }),
  rows: z
    .array(ScaleRowSchema)
    .min(1, 'Add at least one row.')
    .max(MAX_PLACES, `You can add up to ${MAX_PLACES} rows.`),
});
export type ScalesPutInput = z.infer<typeof ScalesPutSchema>;
