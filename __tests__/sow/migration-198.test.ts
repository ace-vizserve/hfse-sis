import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 198 is a text test: the SQL is applied against the local stack by
 * `npm run local:migrate`, and this pins the shape every later SOW task
 * relies on (eight tables, all closed to `authenticated`, and a resolver that
 * allows 'subject_head' on the stage CONFIG only).
 */
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/198_scheme_of_work.sql'),
  'utf8'
);

const TABLES = [
  'schemes_of_work',
  'scheme_of_work_classes',
  'scheme_of_work_weeks',
  'scheme_of_work_submissions',
  'scheme_of_work_checks',
  'scheme_of_work_relief_notes',
  'scheme_of_work_signoffs',
  'subject_heads',
];

describe('migration 198 — scheme of work tables', () => {
  it.each(TABLES)('creates %s', (t) => {
    expect(sql).toMatch(
      new RegExp(`create table if not exists public\\.${t}\\s*\\(`)
    );
  });

  it.each(TABLES)('revokes all on %s from authenticated', (t) => {
    expect(sql).toMatch(
      new RegExp(`revoke all on public\\.${t}\\s+from authenticated`)
    );
  });

  it('lets an approval stage resolve to a subject head', () => {
    expect(sql).toContain(
      "check (resolver in ('named', 'form_adviser', 'subject_head'))"
    );
  });

  it('keeps one relief note per teacher, class, subject and day', () => {
    // lib/sow/relief.ts upserts on exactly this key.
    expect(sql).toMatch(
      /create unique index if not exists scheme_of_work_relief_notes_one_per_day\s+on public\.scheme_of_work_relief_notes \(relief_teacher_user_id, section_id, subject_id, taught_on\)/
    );
  });

  it('leaves approval_request_stages alone (a subject-head step is stored as named)', () => {
    expect(sql).not.toMatch(/alter table\s+public\.approval_request_stages/i);
  });
});
