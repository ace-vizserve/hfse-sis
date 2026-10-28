import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration 200 is a text test, like 198's: it pins that a scheme of work has
 * no track any more — one scheme per term, subject and level — and that a
 * clash stops the migration instead of deleting a scheme.
 */
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/200_sow_drop_track.sql'),
  'utf8'
);

describe('migration 200 — a scheme of work has no track', () => {
  it('drops the old (term, subject, level, track) key', () => {
    expect(sql).toMatch(
      /drop constraint if exists schemes_of_work_term_subject_level_track_key/
    );
  });

  it('drops the track column', () => {
    expect(sql).toMatch(/drop column if exists track/);
  });

  it('keeps one scheme per term, subject and level', () => {
    expect(sql).toMatch(
      /add constraint schemes_of_work_term_subject_level_key\s+unique \(term_id, subject_id, level_id\)/
    );
  });

  it('stops on a clash rather than deleting a scheme', () => {
    expect(sql).toMatch(/raise exception/);
    expect(sql).not.toMatch(/delete from/i);
  });
});
