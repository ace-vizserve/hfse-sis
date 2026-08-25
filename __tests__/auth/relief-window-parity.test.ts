import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isReliefLive } from '@/lib/auth/teacher-assignments';
import { reliefStatus } from '@/lib/relief/display';

// Relief cover carries a date window (migration 123). The window is written
// TWICE — once as `public.relief_is_live` in SQL, once as `isReliefLive` in
// TypeScript — and this file is why that is survivable.
//
// ⚠ IT IS WRITTEN TWICE ON PURPOSE, not by oversight. Five callers of
// `loadEffectiveAssignmentsForUser` pass the SERVICE client, which bypasses RLS
// outright, so a window enforced only in SQL would be skipped by all five and a
// substitute would get a class they are not covering yet. And a window enforced
// only in TypeScript would leave every direct RLS-scoped read ungated. Both
// layers need it.
//
// ⚠ WHAT THIS GUARDS IS EXACTLY WHAT WENT WRONG IN MIGRATION 115: the window in
// SQL and the window in the app disagreed, so a teacher could act in one layer
// and not the other, and nothing anywhere raised an error. 115 exists solely to
// reconcile them.
//
// The tests can't call Postgres — this suite has no database — so parity is
// held three ways instead:
//   1. the TypeScript truth table below, asserted directly;
//   2. every relief test in the SQL calls the shared function rather than
//      inlining a date comparison (the "one site forgot the window" bug);
//   3. the SQL function's own body is null-permissive and inclusive on both
//      bounds, matching the TypeScript.
//
// The live round-trip against the real function belongs in
// `scripts/verify-relief-window.ts`, run after the migration is applied.

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '123_relief_cover_dates.sql'),
  'utf8'
);

// The migration's header explains the 115 failure by quoting the very patterns
// these tests hunt for, so scanning the raw file finds the prose and not the
// code. Everything below reads the executable statements only.
const SQL = MIGRATION.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const TODAY = '2026-08-24';

// start, end, expected-live, why
const CASES: Array<[string | null, string | null, boolean, string]> = [
  [null, null, true, 'no window at all — every row created before 123'],
  [null, '2026-08-25', true, 'open start, end still ahead'],
  [null, '2026-08-24', true, 'open start, ends today — inclusive'],
  [null, '2026-08-23', false, 'open start, ended yesterday'],
  ['2026-08-23', null, true, 'started yesterday, open-ended'],
  ['2026-08-24', null, true, 'starts today, open-ended — inclusive'],
  ['2026-08-25', null, false, 'scheduled for tomorrow, not live yet'],
  ['2026-08-23', '2026-08-25', true, 'today sits inside the window'],
  ['2026-08-24', '2026-08-24', true, 'single-day cover, today'],
  ['2026-08-25', '2026-08-30', false, 'whole window is in the future'],
  ['2026-08-18', '2026-08-22', false, 'whole window is in the past'],
];

describe('isReliefLive', () => {
  it.each(CASES)(
    'start=%s end=%s → %s (%s)',
    (startedOn, endedOn, expected) => {
      expect(isReliefLive(startedOn, endedOn, TODAY)).toBe(expected);
    }
  );

  it('treats undefined the same as null, since the columns are optional', () => {
    expect(isReliefLive(undefined, undefined, TODAY)).toBe(true);
  });

  it('defaults to the Singapore date when no day is passed', () => {
    // Only that it resolves a real ISO date and does not throw — the value
    // itself is sgToday()'s business and is tested in lib/dates.
    expect(isReliefLive(null, null)).toBe(true);
  });
});

describe('what the screen says vs what the gate does', () => {
  // The display layer splits "not live" into `scheduled` and `ended`, which the
  // predicate cannot tell apart. That extra detail is fine; disagreeing about
  // whether the cover is LIVE is not — it would put a name on screen that reads
  // as having access it does not have.
  it.each(CASES)(
    'start=%s end=%s → active exactly when live (%s)',
    (startedOn, endedOn, expected) => {
      expect(reliefStatus(startedOn, endedOn, TODAY) === 'active').toBe(
        isReliefLive(startedOn, endedOn, TODAY)
      );
      expect(reliefStatus(startedOn, endedOn, TODAY) === 'active').toBe(
        expected
      );
    }
  );

  it('calls a future window scheduled and a past one ended', () => {
    expect(reliefStatus('2026-08-25', null, TODAY)).toBe('scheduled');
    expect(reliefStatus(null, '2026-08-23', TODAY)).toBe('ended');
    // A window entirely in the past is ended, not scheduled — the end date is
    // checked first, because a row can be both started and finished.
    expect(reliefStatus('2026-08-18', '2026-08-22', TODAY)).toBe('ended');
  });
});

describe('the SQL half', () => {
  // The 115 bug in one assertion: an ACCESS site that tests the relief column
  // without also testing the window grants access outside it.
  //
  // The read policy is the one deliberate exception — it decides what a
  // substitute may SEE, not what they may do — so it is excluded by name rather
  // than by loosening the rule for everyone.
  it('never tests the relief column without the window, outside the policy', () => {
    const policyAt = SQL.indexOf(
      'create policy teacher_assignments_scoped_read'
    );
    const accessOnly = policyAt === -1 ? SQL : SQL.slice(0, policyAt);
    const lines = accessOnly.split('\n');
    const offenders: string[] = [];

    lines.forEach((line, i) => {
      if (!/relief_teacher_user_id\s*=\s*auth\.uid\(\)/.test(line)) return;
      // The window may sit on the same line or the next one — the call sites
      // wrap for line length.
      const window = `${line}\n${lines[i + 1] ?? ''}`;
      if (!window.includes('relief_is_live')) {
        offenders.push(`line ${i + 1}: ${line.trim()}`);
      }
    });

    expect(offenders).toEqual([]);
  });

  it('gates the three ACCESS helpers', () => {
    // Match the CALL shape specifically — the helpers qualify the row as `ta.`.
    // The definition, its COMMENT and the two grants all name the function too
    // and must not be counted.
    const calls = SQL.match(/relief_is_live\(ta\.relief_started_on/g) ?? [];
    expect(calls.length).toBe(3);

    for (const site of [
      'is_teacher_for_section',
      'is_adviser_for_section',
      'is_teacher_for_sheet',
    ]) {
      expect(SQL).toContain(site);
    }
  });

  it('leaves the READ policy unwindowed, on purpose', () => {
    // ⚠ If this fails because somebody added the window to the policy, do not
    // "fix" the test. A substitute has to see a cover booked for next week to
    // prepare for it (Mr Ace, 2026-08-24) — and windowing the policy would push
    // every "you're covering" screen onto the service client to get around our
    // own RLS. Reading the row is not access; the three helpers above are.
    const policy = SQL.slice(
      SQL.indexOf('create policy teacher_assignments_scoped_read')
    );
    expect(policy).toContain('relief_teacher_user_id = auth.uid()');
    expect(policy).not.toContain('relief_is_live');
  });

  it('grants EXECUTE to authenticated, or every teacher loses the table', () => {
    // Migration 114 revoked exactly this and blanked every cookie-scoped read
    // of teacher_assignments in production; 116 exists only to repair it. The
    // read policy calls relief_is_live, and policies evaluate as the caller.
    expect(MIGRATION).toMatch(
      /grant execute on function public\.relief_is_live\(date, date\) to authenticated/
    );
  });

  it('is null-permissive and inclusive on both bounds, like the TypeScript', () => {
    const body = MIGRATION.slice(
      MIGRATION.indexOf('create or replace function public.relief_is_live')
    ).slice(0, 800);

    // Null start / null end mean unbounded, not "not live".
    expect(body).toMatch(/p_started_on is null/);
    expect(body).toMatch(/p_ended_on is null/);
    // Inclusive: a cover starting today is live today, one ending today too.
    expect(body).toMatch(/p_started_on <= /);
    expect(body).toMatch(/p_ended_on >= /);
    // Same clock as sgToday().
    expect(body).toContain("now() at time zone 'Asia/Singapore'");
  });

  it('keeps the substantive arm unwindowed — your own class never lapses', () => {
    // Every site ORs teacher_user_id against the windowed relief arm. If a
    // window ever lands on teacher_user_id, a teacher loses their own class.
    // The lookbehind matters: `relief_teacher_user_id` ends with the substring
    // `teacher_user_id`, so without it this matches the relief arm every time
    // and the assertion can never pass.
    expect(SQL).not.toMatch(
      /(?<!relief_)teacher_user_id\s*=\s*auth\.uid\(\)\s*\n?\s*and public\.relief_is_live/
    );
  });
});
