import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/203_parent_events.sql'),
  'utf8'
);

describe('migration 203 — parent events', () => {
  it('creates the three tables', () => {
    for (const t of [
      'parent_events',
      'parent_event_submissions',
      'parent_event_registrations',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          String.raw`create table (if not exists )?public\.${t}\b`,
          'i'
        )
      );
    }
  });

  it('keeps one registration per child per event and one submission per parent per event', () => {
    expect(sql).toMatch(/unique \(event_id, student_id\)/i);
    expect(sql).toMatch(/unique \(event_id, parent_email\)/i);
  });

  it("indexes registrations by child for the parent's events list", () => {
    expect(sql).toMatch(
      /create index if not exists parent_event_registrations_student_id_idx\s+on public\.parent_event_registrations \(student_id\)/i
    );
  });

  it('constrains status and answer_mode', () => {
    expect(sql).toMatch(
      /check \(status in \('registered', ?'not_joining'\)\)/i
    );
    expect(sql).toMatch(/check \(answer_mode in \('consent', ?'register'\)\)/i);
  });

  it('enables RLS on all three tables with no policies', () => {
    expect(sql.match(/enable row level security/gi)?.length).toBe(3);
    expect(sql).not.toMatch(/create policy/i);
  });
});
