import { z } from 'zod';

import { eventAppliesToSection } from '@/lib/attendance/event-scope';
import { LEVEL_CODES, type LevelCode } from '@/lib/sis/levels';

// A parent-facing event (migration 203): the details staff set, its short-link
// slug, and where it sits in its lifecycle. Pure — no I/O. Row mapping from the
// table's snake_case columns is the caller's job.

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-05')
  .refine(
    (v) => {
      // Reject impossible days such as 2026-02-31 (Date would roll them over).
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    },
    { message: 'Enter a real date.' }
  );
const isoTimestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: 'Use a valid date and time',
});

export const EventScopeSchema = z.object({
  audience: z.enum(['all', 'primary', 'secondary']),
  levels: z.array(z.enum(LEVEL_CODES)),
  sectionIds: z.array(z.string()),
});

export const EventDetailsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Give the event a title')
      .max(120, 'Keep the title to 120 characters or fewer.'),
    description: z
      .string()
      .max(4000, 'Keep the description to 4,000 characters or fewer.')
      .default(''),
    startsOn: isoDate,
    endsOn: isoDate.nullable().optional(),
    timeLabel: z
      .string()
      .trim()
      .max(60, 'Keep the time to 60 characters or fewer.')
      .default(''),
    venue: z
      .string()
      .trim()
      .max(120, 'Keep the venue to 120 characters or fewer.')
      .default(''),
    scope: EventScopeSchema,
    answerMode: z.enum(['consent', 'register'], {
      message:
        'Choose how parents answer: Allowing / Not allowing, or Register / Not joining.',
    }),
    opensAt: isoTimestamp,
    closesAt: isoTimestamp,
  })
  .superRefine((v, ctx) => {
    if (v.endsOn && v.endsOn < v.startsOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'The end date cannot be before the start date',
      });
    }
    if (Date.parse(v.opensAt) >= Date.parse(v.closesAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'Registration must close after it opens',
      });
    }
  });

export type EventDetails = z.infer<typeof EventDetailsSchema>;
export type EventScope = z.infer<typeof EventScopeSchema>;
export type { LevelCode };

const SLUG_MAX = 40;

/** Short-link slug: lowercase ascii, hyphens, ≤ 40 chars, `-2`, `-3`… if taken. */
export function slugifyEventTitle(title: string, taken: Set<string>): string {
  const base = cleanEventSlug(title) || 'event';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate =
      base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '') + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Any text as a link slug: lowercase ascii, hyphens, ≤ 40 chars ('' when nothing is left). */
export function cleanEventSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

export type EventStatus =
  | 'not_published'
  | 'upcoming'
  | 'open'
  | 'closed'
  | 'past';

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  not_published: 'Not published',
  upcoming: 'Opens soon',
  open: 'Open',
  closed: 'Closed',
  past: 'Past',
};

export type EventTiming = {
  publishedAt: string | null;
  opensAt: string;
  closesAt: string;
  closedEarlyAt: string | null;
  startsOn: string;
  endsOn: string | null;
};

// School timezone: "past" is judged on the Singapore calendar date, so an event
// ending 6 Nov is still current until Singapore midnight, not UTC midnight.
function singaporeDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function eventStatus(e: EventTiming, now: Date): EventStatus {
  if (!e.publishedAt) return 'not_published';
  if (singaporeDate(now) > (e.endsOn ?? e.startsOn)) return 'past';
  const t = now.getTime();
  if (e.closedEarlyAt && t >= Date.parse(e.closedEarlyAt)) return 'closed';
  if (t >= Date.parse(e.closesAt)) return 'closed';
  if (t < Date.parse(e.opensAt)) return 'upcoming';
  return 'open';
}

/** Does this event apply to this child? Same precedence as the attendance register. */
export function eventIsFor(
  e: {
    audience: 'all' | 'primary' | 'secondary';
    levels: readonly LevelCode[];
    sectionIds: readonly string[];
  },
  child: { levelCode: string; sectionId: string }
): boolean {
  return eventAppliesToSection(
    { audience: e.audience, levels: e.levels, sectionIds: e.sectionIds },
    { levelCode: child.levelCode, sectionId: child.sectionId }
  );
}

export function canRegister(e: EventTiming, now: Date): boolean {
  return eventStatus(e, now) === 'open';
}
