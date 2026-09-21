import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/171_realtime_broadcast_badges.sql'),
  'utf8'
);

describe('migration 171 — broadcast badge triggers', () => {
  it('swallows exceptions in every trigger function', () => {
    // A failed broadcast must never roll back the write beneath it. audit_log
    // takes a row on every grade entry (Hard Rule #6, append-only).
    const handlers = SQL.match(/exception\s+when\s+others\s+then/gi) ?? [];
    expect(handlers.length).toBe(2);
  });

  it('gates the audit_log trigger on the six P-Files actions in a WHEN clause', () => {
    // The WHEN clause is what keeps a grade-entry audit row out of the
    // function entirely. Without it the filter would run per row in plpgsql.
    const when = SQL.match(/when\s*\(\s*new\.action\s+in\s*\(([^)]*)\)/i);
    expect(when).not.toBeNull();
    for (const action of [
      'pfile.upload',
      'pfile.reminder.sent',
      'sis.document.approve',
      'sis.document.reject',
      'sis.documents.auto-expire',
      'sis.documents.auto-revive',
    ]) {
      expect(when![1]).toContain(action);
    }
  });

  it('removes nothing from the supabase_realtime publication', () => {
    // Both transports stay live so reverting the client commit is a complete
    // rollback. Publication cleanup is its own migration, gated on a browser
    // verification.
    expect(SQL).not.toMatch(
      /drop\s+table|publication\s+supabase_realtime\s+drop/i
    );
  });
});
