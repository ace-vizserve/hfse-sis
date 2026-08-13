/**
 * The `<stage>UpdatedBy` columns on `*_enrolment_status` are misspelled in the
 * database, and the spelling is not ours to fix.
 *
 * WHY THIS EXISTS. That table is part of the frozen parent-portal DDL
 * (`docs/context/10a-parent-portal-ddl.md`), created by migrations 012 / 087 /
 * 099. Nine stages carry an "updated by" column and **eight of them lost the
 * capital B**: `classUpdatedby`, `feeUpdatedby`, `contractUpdatedby` and so on.
 * `orientationUpdateby` lost the "d" as well. Exactly one — `applicationUpdatedBy`
 * — is spelled the way anyone would guess, which is worse than none being right,
 * because it teaches the guess.
 *
 * Verified against production on 2026-08-13 by selecting all four plausible
 * spellings of each and keeping whichever did not 400. The list below is that
 * result, not a reading of the migrations.
 *
 * WHAT IT COSTS WHEN SOMEBODY GUESSES. Two live bugs, and only one of them was
 * visible:
 *
 *   - `assign-section/route.ts` SELECTed `classUpdatedBy`, so assigning a class
 *     to an enrolled student died on a red toast — "column
 *     ay2026_enrolment_status.classUpdatedBy does not exist". Loud, and reported
 *     by Mr Ace on 2026-08-13.
 *   - `section-transfer.ts` UPDATEd the same wrong key. PostgREST rejects the
 *     whole statement, so `classSection`, `classLevel`, `classStatus` and
 *     `classUpdatedDate` were never written either — and that call site only
 *     `console.warn`s, by an explicit design decision that the grading side is
 *     the source of truth. So every section transfer left the admissions row
 *     stale and said nothing.
 *
 * The second is the reason this is a test and not a code comment: the same typo,
 * in a place where nothing turns red.
 *
 * HOW IT READS. Source-scanning, like
 * `__tests__/data/no-unpaginated-high-volume-reads.test.ts` — these are server
 * modules that cannot be imported and inspected at runtime. It checks only the
 * two places a string reaches PostgREST: the field list inside `.select(...)`,
 * and the keys of an object passed to `.update()` / `.insert()` / `.upsert()`.
 * Property access on a returned row (`statusRow.classUpdatedBy`) is deliberately
 * NOT checked — that name is whatever the select aliased it to, and aliasing the
 * ugly column back to camelCase is the encouraged fix.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const SKIP_DIRS = new Set([
  '.claude',
  'node_modules',
  '.next',
  '.git',
  '__tests__',
]);

/**
 * The spellings that exist. Measured against production 2026-08-13, not read
 * off the migrations — though the two agree.
 */
const REAL_COLUMNS = new Set([
  'applicationUpdatedBy', // the only one with a capital B
  'registrationUpdatedby',
  'documentUpdatedby',
  'assessmentUpdatedby',
  'contractUpdatedby',
  'feeUpdatedby',
  'classUpdatedby',
  'suppliesUpdatedby',
  'orientationUpdateby', // no "d" either
]);

/** Any token that LOOKS like one of them, correctly spelled or not. */
const FAMILY =
  /\b(?:application|registration|document|assessment|contract|fee|class|supplies|orientation)Updated?[Bb]y\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * The object literal starting at `open` (the index of its `{`), by brace
 * matching. Returns null when the argument is not a literal — a spread variable
 * or a builder call, which this test cannot see into and does not try to.
 */
function objectLiteralAt(source: string, open: number): string | null {
  if (source[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Every column name this file hands to PostgREST, with where it sits. */
function postgrestColumns(
  source: string
): { name: string; line: number; how: string }[] {
  const found: { name: string; line: number; how: string }[] = [];

  // 1. Field lists inside .select('…'). A field may be aliased as
  //    `alias:realColumn`, in which case the DB only ever sees the right side.
  const selects = /\.select\(\s*(['"`])([\s\S]*?)\1/g;
  for (let m = selects.exec(source); m; m = selects.exec(source)) {
    for (const field of m[2].split(',')) {
      const token = field.trim();
      if (!token) continue;
      const dbSide = token.includes(':')
        ? token.slice(token.indexOf(':') + 1).trim()
        : token;
      if (FAMILY.test(dbSide)) {
        found.push({
          name: dbSide,
          line: lineOf(source, m.index),
          how: 'select',
        });
      }
    }
  }

  // 2. Keys of a write payload.
  const writes = /\.(update|insert|upsert)\(\s*/g;
  for (let m = writes.exec(source); m; m = writes.exec(source)) {
    const body = objectLiteralAt(source, m.index + m[0].length);
    if (body === null) continue;
    const keys = /(?:^|[,{])\s*(?:'|")?([A-Za-z_$][\w$]*)(?:'|")?\s*:/g;
    for (let k = keys.exec(body); k; k = keys.exec(body)) {
      if (FAMILY.test(k[1])) {
        found.push({
          name: k[1],
          line: lineOf(source, m.index),
          how: `${m[1]} payload`,
        });
      }
    }
  }

  return found;
}

const OFFENDERS = walk(join(REPO_ROOT, 'lib'))
  .concat(walk(join(REPO_ROOT, 'app')))
  .concat(walk(join(REPO_ROOT, 'scripts')))
  .flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    if (!FAMILY.test(source)) return [];
    return postgrestColumns(source)
      .filter((c) => !REAL_COLUMNS.has(c.name))
      .map((c) => `${relative(file)}:${c.line} — ${c.how} uses "${c.name}"`);
  });

describe('*_enrolment_status "updated by" column spellings', () => {
  it('every column sent to PostgREST is spelled the way the database spells it', () => {
    expect(
      OFFENDERS,
      OFFENDERS.length
        ? `\n\nThese names do not exist in the database:\n\n  ${OFFENDERS.join(
            '\n  '
          )}\n\nThe real spellings are:\n\n  ${[...REAL_COLUMNS].join(
            '\n  '
          )}\n\nIn a .select() you may alias the ugly name back — ` +
            `'classUpdatedBy:classUpdatedby' — so the row you get keeps a sane key. ` +
            `In an update/insert payload the key must be the real column.\n`
        : undefined
    ).toEqual([]);
  });

  it('knows about every stage, so a new one cannot be added unnoticed', () => {
    expect(REAL_COLUMNS.size).toBe(9);
  });
});
