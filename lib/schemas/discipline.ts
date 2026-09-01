import { z } from 'zod';

import { isEmptyRichText, proseLength } from '@/lib/rich-text';

// Disciplinary records — action item #7 from the 2026-07-31 academics training.
//
// Every message here is written for a school admin, not a developer. The two
// source documents (an incident report and a first warning letter on
// attendance) were supplied by the school, and the fields below are theirs.

export const DISCIPLINE_RECORD_TYPE_VALUES = ['incident', 'letter'] as const;
export type DisciplineRecordType =
  (typeof DISCIPLINE_RECORD_TYPE_VALUES)[number];

export const DISCIPLINE_RECORD_TYPE_LABELS: Record<
  DisciplineRecordType,
  string
> = {
  incident: 'Incident',
  // "Sent", not "issued" — the hint below already says the school sent it home,
  // and the school's own document is a letter that goes home with a slip. One
  // word, used identically on the chip, the radio and the section list.
  letter: 'Letter sent',
};

// One line of help under each choice, so the difference is on the screen rather
// than in someone's head. The letter wording is deliberate: the one letter the
// school has shown us is triggered by the attendance register, not by anything
// on this list.
export const DISCIPLINE_RECORD_TYPE_HINTS: Record<
  DisciplineRecordType,
  string
> = {
  incident: 'Something that happened involving this student.',
  letter: 'A letter the school sent home about this student.',
};

export const DISCIPLINE_NATURE_MAX = 200;
export const DISCIPLINE_DETAILS_MAX = 4000;
export const DISCIPLINE_REMARKS_MAX = 1000;
export const DISCIPLINE_OFFICE_MAX = 100;
export const DISCIPLINE_URL_MAX = 2048;

/**
 * `http://` or `https://` and something after it.
 *
 * Deliberately loose. This is a paste box for a link somebody already has —
 * a SharePoint path with a query string a hundred characters long is normal,
 * and a validator strict enough to have an opinion about that would reject
 * real links. The one thing worth refusing is a value that is not a web
 * address at all, because it will look like a link on screen and do nothing.
 *
 * The scheme check is the security-relevant half: without it, `javascript:` or
 * `data:` reaches an `href`. Nothing renders this without the anchor also
 * carrying `rel="noopener noreferrer"`.
 */
const WEB_URL = /^https?:\/\/\S+$/i;

// `YYYY-MM-DD`, the shape a native date input submits and the shape Postgres
// takes for a `date` column. Compared as strings on purpose — building a Date
// from the value would drag the browser's timezone into a question that has
// nothing to do with time of day, and could move a record filed late at night
// to the wrong calendar day.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// `HH:MM`, matching a native time input. Seconds are neither collected nor
// wanted; the school's form has a clock time on it, not a stopwatch.
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Today in the school's own calendar terms, as `YYYY-MM-DD`.
 *
 * Local, not UTC. Singapore is UTC+8, so `toISOString()` would call anything
 * filed before 8am "yesterday" and reject a record the filer is looking at
 * right now.
 */
function todayLocalIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Body of POST /api/classroom/[sectionId]/students/[studentNumber]/discipline
 * and of PATCH on one record.
 *
 * The student and the class come from the URL, never from the body — the route
 * has already proved the caller may reach that student through that section,
 * and accepting either here would let a filer redirect a record onto a child
 * they cannot see.
 */
export const DisciplineRecordSchema = z
  .object({
    record_type: z.enum(DISCIPLINE_RECORD_TYPE_VALUES, {
      message: 'Choose whether this is an incident or a letter.',
    }),

    occurred_on: z
      .string({ error: 'Enter the date this happened.' })
      .regex(ISO_DATE, 'Enter the date this happened.')
      // The database has no "not in the future" constraint on purpose — a CHECK
      // against `current_date` is not immutable and would revalidate on a dump
      // and restore, so a record that was legal the day it was filed could block
      // a restore months later. The rule lives here instead, where it can be a
      // sentence rather than a constraint name.
      .refine((value) => value <= todayLocalIso(), {
        message: 'That date is in the future. Check the date and try again.',
      }),

    // Optional because the school's own form is regularly filed without one, and
    // a letter has a date but no clock time at all.
    occurred_at_time: z
      .string()
      .regex(ISO_TIME, 'Enter the time as HH:MM, or leave it blank.')
      .nullish(),

    // THE THREE WRITTEN FIELDS COUNT WORDS, NOT FORMATTING. They are typed in
    // a formatting editor, so the stored value is HTML: `<strong><em><u>`
    // alone would eat a fifth of the 200 characters allowed for `nature`, and
    // the filer would be told their one short line is too long with nothing on
    // screen to explain it. The limits were written about what a person types,
    // so that is what is measured.
    // ⚠ `nature` IS NOT RICH TEXT, AND MUST NOT BE MEASURED AS IF IT WERE.
    // Unlike `details` and `remarks` above, it is a single-line `<Input>` in
    // `discipline-record-form.tsx` — a short label like "Pushing in the
    // canteen queue" — and it is printed raw as a heading on three screens.
    // It holds no markup, so the plain string IS what the filer typed.
    //
    // It briefly went through the prose helpers during the rich-text sweep,
    // which was harmless (the two agree exactly on plain text) but wrong in a
    // way that misleads: it told the next reader this column holds HTML, and
    // it paid for an HTML parse on every validation to answer a question about
    // a one-line label. Converting a field here is a claim about how it is
    // EDITED — check the form before making it.
    nature: z
      .string({ error: 'Say briefly what kind of thing this was.' })
      .trim()
      .min(1, 'Say briefly what kind of thing this was.')
      .max(
        DISCIPLINE_NATURE_MAX,
        `Keep this under ${DISCIPLINE_NATURE_MAX} characters — the full story goes in the details below.`
      ),

    details: z
      .string()
      .trim()
      .refine((value) => proseLength(value) <= DISCIPLINE_DETAILS_MAX, {
        message: `That is longer than ${DISCIPLINE_DETAILS_MAX} characters. Shorten it, or link to the full report instead.`,
      })
      .default(''),

    remarks: z
      .string()
      .trim()
      .refine((value) => proseLength(value) <= DISCIPLINE_REMARKS_MAX, {
        message: `Keep remarks under ${DISCIPLINE_REMARKS_MAX} characters.`,
      })
      .nullish(),

    // A link to the paperwork — the incident report, the letter that went home,
    // or the slip the parent signed and returned. One field for all three
    // because they are the same shape (migration 121).
    //
    // The empty string is accepted and means "no link": a form that has been
    // opened, typed into and cleared submits `''`, not `undefined`, and refusing
    // that would make clearing a link impossible. `toColumns` in
    // lib/discipline/mutations.ts turns it into a real NULL.
    document_url: z
      .string()
      .trim()
      .max(
        DISCIPLINE_URL_MAX,
        'That link is too long to store. Use a shorter one.'
      )
      .refine((value) => value === '' || WEB_URL.test(value), {
        message: 'Paste the full web address, starting with https://',
      })
      .nullish(),

    // When the parent's signed slip came back (migration 122). Null = not yet.
    // The school's warning letter carries a tear-off acknowledgement receipt due
    // back in two days, so a letter is not finished when it is sent.
    acknowledged_on: z
      .string()
      .regex(ISO_DATE, 'Enter the date the signed slip came back.')
      .refine((value) => value <= todayLocalIso(), {
        message: 'That date is in the future. Check the date and try again.',
      })
      .nullish(),

    // The school's form identifies the filer by office ("Academics"), not by
    // class role — Chandana, 2026-08-14: incidents are filed by "the person in
    // charge who is present at the venue". We already know the account; this is
    // their own wording for where they were acting from.
    filed_by_office: z
      .string()
      .trim()
      .max(
        DISCIPLINE_OFFICE_MAX,
        `Keep this under ${DISCIPLINE_OFFICE_MAX} characters.`
      )
      .nullish(),
  })
  .superRefine((data, ctx) => {
    if (!data.acknowledged_on) return;

    // Both rules below are CHECK constraints too (migration 122). Restated
    // here so the answer arrives as a sentence the person filing can act on,
    // rather than as a constraint name in a 500.
    if (data.record_type !== 'letter') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acknowledged_on'],
        message:
          'Only a letter can be acknowledged by a parent. Clear this date, or change this to a letter.',
      });
      return;
    }

    if (data.acknowledged_on < data.occurred_on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acknowledged_on'],
        message:
          'The slip came back before the letter went out. Check both dates.',
      });
    }
  });

export type DisciplineRecordInput = z.infer<typeof DisciplineRecordSchema>;

/**
 * What a FORM holds, as opposed to what the route receives.
 *
 * The two differ by one field: `details` has a `.default('')`, so it is
 * optional going in and guaranteed coming out. React Hook Form is typed on the
 * way in, so a form declared against the output type disagrees with its own
 * resolver about that single key — which surfaces as a wall of `Resolver<...>`
 * mismatches rather than as anything to do with `details`.
 */
export type DisciplineRecordFormValues = z.input<typeof DisciplineRecordSchema>;
