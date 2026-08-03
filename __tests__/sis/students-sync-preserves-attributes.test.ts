/**
 * The admissions -> SIS student sync must never clobber attributes that live
 * on `public.students` but are owned by the SIS, not by admissions.
 *
 * There are three today: `urgent_compassionate_allowance` (migration 015),
 * `vacation_leave_allowance_per_term` (048) and `house_id` (110). All three
 * are cross-AY by design — a house in particular is supposed to follow a
 * student from P1 to S4, which is the entire point of a house system.
 *
 * The risk is specific and silent. `app/api/students/sync/route.ts` updates via
 * `.upsert(..., { onConflict: 'id' })`. It is safe TODAY only because the
 * object it builds lists four named fields; PostgREST leaves unlisted columns
 * alone. The moment someone widens that to spread a whole row — a natural
 * refactor — every house nulls on the next nightly cron run, with no error and
 * no audit entry. Nobody would notice until a teacher asked why the house
 * column had emptied.
 *
 * So this test reads the source and asserts the write is field-scoped. That is
 * unusual, and deliberate: the property worth protecting is "this statement
 * does not mention the column", which no runtime assertion can express.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SIS_OWNED_COLUMNS = [
  'house_id',
  'urgent_compassionate_allowance',
  'vacation_leave_allowance_per_term',
];

const SYNC_SOURCES = [
  'app/api/students/sync/route.ts',
  'lib/sync/students.ts',
  'app/api/sis/students/auto-sync/route.ts',
];

describe('student sync never writes SIS-owned columns', () => {
  it.each(SYNC_SOURCES)('%s does not mention them', (path) => {
    const src = readFileSync(path, 'utf8');
    for (const column of SIS_OWNED_COLUMNS) {
      expect(
        src.includes(column),
        `${path} references \`${column}\`. The sync writes to public.students ` +
          `with a named-field object; naming a SIS-owned column here would let ` +
          `an admissions sync overwrite it. If this is intentional, the sync ` +
          `has grown a new responsibility and needs its own audit trail.`
      ).toBe(false);
    }
  });

  it('the sync still writes to public.students at all', () => {
    // Guards the guard: if the sync were refactored so none of these files
    // touch `students`, every assertion above would pass vacuously.
    const touches = SYNC_SOURCES.filter((p) =>
      readFileSync(p, 'utf8').includes("from('students')")
    );
    expect(touches.length).toBeGreaterThan(0);
  });

  it('spreading a whole row would be caught', () => {
    // The specific refactor this exists to stop: `.upsert(rows.map((u) => ({
    // ...u })))`. A spread of the source object into a students write is not
    // field-scoped and defeats the check above, so it is banned outright.
    for (const path of SYNC_SOURCES) {
      const src = readFileSync(path, 'utf8');
      const studentsWrites = src.match(
        /from\('students'\)\s*\.\s*(insert|upsert|update)\(([\s\S]{0,400}?)\)/g
      );
      for (const block of studentsWrites ?? []) {
        expect(
          /\.\.\.\w/.test(block),
          `${path} spreads an object into a public.students write. List the ` +
            `fields explicitly so SIS-owned columns cannot be clobbered.`
        ).toBe(false);
      }
    }
  });
});
