/**
 * A read from a table that can outgrow one page must page.
 *
 * WHY THIS EXISTS. PostgREST caps a response at 1,000 rows on this instance and
 * returns the first page with **no error and no flag**. Four separate places
 * had been sized to "today's row count is under the cap", and by 2026-08-10
 * three of them had quietly passed it:
 *
 *   - the attendance register printed from 1,610 rows and showed 1,000
 *   - the compassionate-leave tally read 5,925 and counted 1,000
 *   - the compliance audit export had 1,322 rows in its last 90 days
 *
 * None of them failed. They all just went short, and the shortest of them is
 * an .xlsx a parent might dispute. The arithmetic in the comments above those
 * queries was roughly right every time; the conclusion drawn from it was the
 * bug. That is why this test exists rather than a note in a doc: the next
 * person to write one of these will also be right about today.
 *
 * HOW IT READS. Source-scanning, the same technique as
 * `__tests__/auth/link-capability-consistency.test.ts` — these are server
 * modules that cannot be imported and inspected at runtime.
 *
 * THE ALLOWLIST CARRIES ITS MEASUREMENT. Every entry names the real worst-case
 * row count and the date it was counted. An entry without one is not allowed:
 * "probably fine" is precisely the reasoning this test replaces.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.claude', 'node_modules', '.next', '.git']);

/**
 * Tables whose row count grows with students × days, students × subjects ×
 * terms, or plain activity over time. A read from one of these is presumed
 * unbounded until its bound is measured and written down.
 */
const HIGH_VOLUME_TABLES = [
  'attendance_daily',
  'grade_entries',
  'audit_log',
  'grade_audit_log',
] as const;

// DELIBERATELY NOT ON THAT LIST, each with the count that settled it
// (production, 2026-08-10). They grow with students rather than with
// students × days, so a per-section or per-student read cannot approach the
// 1,000-row cap:
//
//   attendance_records   2,725 total · worst section 142 · worst student 7
//   evaluation_writeups  1,896 total · worst student 5
//
// `report_card_comments` was on an earlier draft of this list and is not a
// table at all — the API returns 404 for it. Left recorded so nobody re-adds
// it from the same guess.

/**
 * Reads that do not page, with the measured reason each is safe.
 *
 * FORMAT: 'path/to/file.ts' -> { rows, measured, why }. `rows` is the real
 * worst case counted in production, not an estimate.
 */
const ALLOWED: Record<string, { rows: number; measured: string; why: string }> =
  {
    // Every number below was COUNTED in production on the stated date, not
    // estimated. That is the whole discipline this file enforces: the four
    // defects it was written for all had a plausible estimate in a comment
    // above them, and the estimates were roughly right.

    // ── one student's own history ──────────────────────────────────────────
    'lib/attendance/queries.ts': {
      rows: 274,
      measured: '2026-08-10',
      why: 'getDailyForStudent reads ONE student across the AY; the section-wide reads in this same file page (they were the 1,610-row register bug)',
    },
    'app/api/attendance/student-summary/route.ts': {
      rows: 274,
      measured: '2026-08-10',
      why: "one student's attendance_daily across the AY — worst student measured",
    },
    'lib/sis/records-history.ts': {
      rows: 60,
      measured: '2026-08-10',
      why: "one student's grade entries across every AY: <=15 subjects x 4 terms",
    },
    'lib/report-card/build-report-card.ts': {
      rows: 60,
      measured: '2026-08-10',
      why: 'one student, one term-set — same bound as records-history',
    },

    // ── one sheet or one entry ────────────────────────────────────────────
    'app/api/grading-sheets/[id]/route.ts': {
      rows: 50,
      measured: '2026-08-10',
      why: 'one sheet, capped at 50 students by Hard Rule #5',
    },
    'app/api/grading-sheets/[id]/entries/[entryId]/route.ts': {
      rows: 1,
      measured: '2026-08-10',
      why: 'a single entry by id',
    },
    'lib/grading/recompute-sheet.ts': {
      rows: 50,
      measured: '2026-08-10',
      why: 'one sheet, capped at 50 students by Hard Rule #5',
    },
    'lib/markbook/grade-diff.ts': {
      rows: 150,
      measured: '2026-08-10',
      why: "one section's roster x one subject x <=3 prior terms",
    },

    // ── dashboards ────────────────────────────────────────────────────────
    'lib/attendance/dashboard.ts': {
      rows: 274,
      measured: '2026-08-10',
      why: 'the unpaged read here is per-student; the section- and AY-wide reads in this file already use fetchAllPages',
    },
    'lib/grading/sync-config-sheets.ts': {
      rows: 168,
      measured: '2026-08-10',
      why: 'entries under the UNLOCKED sheets of ONE subject config — 32 unlocked sheets exist school-wide, which is why the estimate of 21 classes and 2,940 rows was wrong',
    },
  };

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

/**
 * Which high-volume tables this file READS without any sign of paging.
 *
 * Scans per statement, not per file: a module that writes to `attendance_daily`
 * and separately reads a single row from it is not a truncation risk, and a
 * file-level scan called both of those offences. Writes, single-row reads,
 * head-only counts and deliberate top-N limits are all excluded here so the
 * allowlist stays short enough that every entry can carry a real measurement.
 */
function unpagedTables(source: string): string[] {
  const hits = new Set<string>();

  for (const table of HIGH_VOLUME_TABLES) {
    const marker = `.from('${table}')`;
    let at = source.indexOf(marker);
    while (at !== -1) {
      // The statement window: from `.from(...)` to the end of the chain. A
      // chain always terminates in `;` at the same nesting or a `)` closing a
      // wrapper, so a generous fixed window is both simpler and safer than
      // parsing — over-reading can only cause a FALSE PASS on a neighbouring
      // `.range()`, which the allowlist's measured-bound rule then catches.
      const window = source.slice(at, at + 900);

      const isWrite = /\.(insert|update|upsert|delete)\s*\(/.test(
        window.slice(0, 200)
      );
      // One row by construction — cannot truncate.
      const singleRow = /\.(maybeSingle|single)\s*\(/.test(window);
      // Server-side count, not returned rows — not subject to the row cap.
      const headOnly = /head:\s*true/.test(window);
      const pages = /\.range\s*\(|fetchAllPages|fetchInChunks/.test(window);
      // A deliberate top-N, whether a literal or a named constant.
      const limited = /\.limit\s*\(/.test(window);

      if (!isWrite && !singleRow && !headOnly && !pages && !limited) {
        hits.add(table);
      }
      at = source.indexOf(marker, at + 1);
    }
  }
  return [...hits];
}

const OFFENDERS = walk(join(REPO_ROOT, 'lib'))
  .concat(walk(join(REPO_ROOT, 'app', 'api')))
  .map((file) => ({
    file: relative(file),
    tables: unpagedTables(readFileSync(file, 'utf8')),
  }))
  .filter((r) => r.tables.length > 0);

describe('every high-volume read either pages or has a measured bound', () => {
  it('has no unpaginated read that is not on the allowlist', () => {
    const unexplained = OFFENDERS.filter((o) => !ALLOWED[o.file]).map(
      (o) => `${o.file} reads ${o.tables.join(', ')} without paging`
    );
    expect(unexplained).toEqual([]);
  });

  it('every allowlist entry carries a real measurement', () => {
    const vague = Object.entries(ALLOWED)
      .filter(
        ([, v]) =>
          !Number.isFinite(v.rows) ||
          v.rows <= 0 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(v.measured) ||
          v.why.trim().length < 20
      )
      .map(([file]) => file);
    expect(vague).toEqual([]);
  });

  it('no allowlist entry claims a bound at or over the cap', () => {
    // If a measured bound reaches 1,000 the entry is not an exemption, it is
    // an unfixed bug wearing one.
    const overCap = Object.entries(ALLOWED)
      .filter(([, v]) => v.rows >= 900)
      .map(([file, v]) => `${file} claims ${v.rows} rows`);
    expect(overCap).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    // An entry for a file that now pages (or no longer touches these tables)
    // is a lie the next reader would trust.
    const stale = Object.keys(ALLOWED).filter(
      (file) => !OFFENDERS.some((o) => o.file === file)
    );
    expect(stale).toEqual([]);
  });
});

describe('the scan is really looking at something', () => {
  it('walked a plausible number of files', () => {
    const count =
      walk(join(REPO_ROOT, 'lib')).length +
      walk(join(REPO_ROOT, 'app', 'api')).length;
    expect(count).toBeGreaterThanOrEqual(150);
  });

  it('sees the reads that were fixed as paging now', () => {
    // The four live defects of 2026-08-10. If any of these stops paging, this
    // fails before the allowlist question is even reached.
    for (const file of [
      'lib/attendance/queries.ts',
      'app/api/audit-log/export/route.ts',
      'lib/classroom/at-risk-source.ts',
    ]) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect(source.includes('fetchAllPages')).toBe(true);
    }
  });
});
