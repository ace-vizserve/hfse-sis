/**
 * An Actor dropdown is built by asking for actors, never by reading the log.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE PAGINATION GUARD.
 *
 * `__tests__/data/no-unpaginated-high-volume-reads.test.ts` is the general
 * guard, and it structurally CANNOT catch this one. It reads a fixed 900-char
 * window from each `.from('audit_log')` and passes the statement if it sees a
 * `.range(` anywhere inside. On these pages the actor query sits a few lines
 * above the paginated log query, so the window over-reads into the neighbour's
 * `.range(` and the actor read is waved through. That over-read is deliberate
 * — tightening the window to the first `;` breaks the
 * `let q = …; q = q.eq(…); await q.range(…)` builder shape these very pages
 * use, and would flag eight files that page perfectly well. So the general
 * guard keeps its window, and this specific shape gets its own test.
 *
 * WHAT WENT WRONG (measured in production, 2026-08-30).
 *
 * Three module audit-log pages build an Actor filter. Each derived it by
 * selecting the `actor_email` COLUMN and de-duplicating in JavaScript:
 *
 *   markbook    306 rows   9 actors   `.limit(200)` listed 8   <-- one missing
 *   attendance  138 rows   8 actors   `.limit(200)` listed 8
 *   evaluation   29 rows   4 actors   unbounded, listed 4
 *
 * A row limit is not an actor limit. Ordered by email, 200 rows can be two
 * people who were busy. Only markbook was actually wrong, and the trap is the
 * other two: the obvious "make them consistent" fix is to put `.limit(200)` on
 * evaluation, which is the single change capable of breaking the one page that
 * was right.
 *
 * The fix is `audit_actor_emails` (migration 133) — `select distinct` in the
 * database, SECURITY INVOKER so migration 006's read policy still applies.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

/** Every page that renders an Actor <Select>, and the label it passes. */
const PAGES_WITH_AN_ACTOR_DROPDOWN = [
  { file: 'app/(markbook)/markbook/audit-log/page.tsx', label: 'markbook' },
  {
    file: 'app/(attendance)/attendance/audit-log/page.tsx',
    label: 'attendance',
  },
  {
    file: 'app/(evaluation)/evaluation/audit-log/page.tsx',
    label: 'evaluation',
  },
] as const;

/**
 * The other four audit-log pages. They accept an `?actor=` filter but build no
 * dropdown at all — recorded here because "there are four dropdowns" was the
 * stated premise of the work, and the answer was three. If one of these ever
 * grows an Actor <Select>, the list above is what has to grow with it.
 */
const PAGES_WITHOUT_ONE = [
  'app/(sis)/sis/audit-log/page.tsx',
  'app/(records)/records/audit-log/page.tsx',
  'app/(p-files)/p-files/audit-log/page.tsx',
  'app/(admissions)/admissions/audit-log/page.tsx',
] as const;

function read(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

describe('the Actor dropdown asks the database for actors', () => {
  it('every page with a dropdown goes through the shared RPC helper', () => {
    const notUsingIt = PAGES_WITH_AN_ACTOR_DROPDOWN.filter(
      ({ file }) => !read(file).includes('loadAuditActorEmails')
    ).map(({ file }) => file);
    expect(notUsingIt).toEqual([]);
  });

  it('no page derives actor options by selecting the actor_email column', () => {
    // The exact shape that was wrong. `.select('actor_email')` on its own is a
    // projection of the log; the whole point is to stop reading rows to count
    // people. The log query itself selects actor_email as part of a longer
    // column list, which this does not match.
    const stillReadingRows = [
      ...PAGES_WITH_AN_ACTOR_DROPDOWN.map((p) => p.file),
      ...PAGES_WITHOUT_ONE,
    ].filter((file) => /\.select\(\s*'actor_email'\s*\)/.test(read(file)));
    expect(stillReadingRows).toEqual([]);
  });

  it('no page bounds its actor list with a row limit', () => {
    // Guards the specific regression this work exists to prevent: "make
    // evaluation consistent with its siblings" by adding `.limit(200)`.
    const limited = PAGES_WITH_AN_ACTOR_DROPDOWN.filter(({ file }) =>
      /\.order\(\s*'actor_email'\s*\)[\s\S]{0,80}?\.limit\(/.test(read(file))
    ).map(({ file }) => file);
    expect(limited).toEqual([]);
  });

  it('each page names itself, so a failed actor list says which page', () => {
    const unlabelled = PAGES_WITH_AN_ACTOR_DROPDOWN.filter(
      ({ file, label }) => !read(file).includes(`'${label}'`)
    ).map(({ file }) => file);
    expect(unlabelled).toEqual([]);
  });
});

describe('the RPC that backs it', () => {
  const migration = read('supabase/migrations/133_audit_actor_emails.sql');

  // The header explains at length what this function is NOT — it names
  // SECURITY DEFINER, and it names migration 132 to say it does not depend on
  // it. Both negative assertions below therefore have to read the STATEMENTS,
  // not the prose, or the explanation trips the test it is explaining.
  const statements = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('is declared stable and SECURITY INVOKER, not SECURITY DEFINER', () => {
    expect(statements).toMatch(/security\s+invoker/i);
    expect(statements).not.toMatch(/security\s+definer/i);
    expect(statements).toMatch(/\bstable\b/i);
  });

  it('keeps its execute grant to authenticated', () => {
    // Migration 114 revoked exactly this kind of grant on a policy helper and
    // blanked every teacher's Teachers tab until 116 restored it. The caller
    // here is a server component on the user's cookie client, which is
    // `authenticated` — without the grant all three dropdowns raise
    // `permission denied for function audit_actor_emails`.
    expect(migration).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.audit_actor_emails\(text\[\]\)\s+to\s+authenticated\s*;/i
    );
  });

  it('does the de-duplication in SQL', () => {
    expect(migration).toMatch(/select\s+distinct/i);
  });

  it('does not depend on migration 132, which is also unapplied', () => {
    // 132_ay_enrolment_indexes.sql is written and not yet applied either, so
    // 133 must stand on its own whichever order they land in.
    expect(statements).not.toMatch(/enrolment_applications|ay_enrolment/i);
    expect(statements).toMatch(/public\.audit_log\b/);
  });
});
