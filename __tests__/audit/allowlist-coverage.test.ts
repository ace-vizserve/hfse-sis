/**
 * Guards against the exact drift found in the 2026-07-24 audit-log coverage
 * sweep: each of the 7 per-module `/<module>/audit-log` pages (KD #9)
 * hand-maintains its own `.in('action', [...])` allowlist array, and
 * nothing links those 7 arrays to the `AuditAction` union in
 * lib/audit/log-action.ts. That sweep found 9 live-emitted actions (plus a
 * 10th, sis.level.create, that was missing from its own dead-code
 * "historical display" cluster) present in zero pages' allowlists — the
 * rows were written to audit_log correctly but permanently invisible on
 * every /audit-log page. This test fails the moment that happens again.
 *
 * The 7 pages can't be `import`ed directly (they're async Next.js Server
 * Components with top-level Supabase calls), so this reads each one as
 * text and extracts its allowlist array by regex — the same mechanical
 * extraction the original audit did by hand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALL_AUDIT_ACTIONS } from '@/lib/audit/log-action';

const AUDIT_LOG_PAGES = [
  'app/(markbook)/markbook/audit-log/page.tsx',
  'app/(attendance)/attendance/audit-log/page.tsx',
  'app/(evaluation)/evaluation/audit-log/page.tsx',
  'app/(p-files)/p-files/audit-log/page.tsx',
  'app/(records)/records/audit-log/page.tsx',
  'app/(admissions)/admissions/audit-log/page.tsx',
  'app/(sis)/sis/audit-log/page.tsx',
];

// Every page names its allowlist constant `..._ALLOWLIST` or `..._ACTIONS`
// (verified across all 7 — see the audit findings). Matching on that
// naming convention, rather than hardcoding each page's exact constant
// name, means a future rename doesn't silently break this test's ability
// to find the array.
const ALLOWLIST_DECL_RE =
  /(?:export\s+)?const\s+\w*AUDIT_(?:ALLOWLIST|ACTIONS)\w*\s*=\s*\[([\s\S]*?)\]/;

function extractAllowlist(relativePath: string): string[] {
  const text = readFileSync(join(process.cwd(), relativePath), 'utf8');
  const match = ALLOWLIST_DECL_RE.exec(text);
  if (!match) {
    throw new Error(
      `Could not find an *_ALLOWLIST/*_ACTIONS const array in ${relativePath} — ` +
        'has the audit-log page been restructured? Update ALLOWLIST_DECL_RE ' +
        'in this test to match.'
    );
  }
  return Array.from(match[1].matchAll(/['"]([a-z0-9_.-]+)['"]/gi)).map(
    (m) => m[1]
  );
}

describe('audit-log allowlist coverage', () => {
  const perPage = AUDIT_LOG_PAGES.map((path) => ({
    path,
    actions: new Set(extractAllowlist(path)),
  }));

  it('each page actually has a non-empty allowlist (extraction sanity check)', () => {
    for (const { path, actions } of perPage) {
      expect(
        actions.size,
        `${path} extracted an empty allowlist`
      ).toBeGreaterThan(0);
    }
  });

  it('every AuditAction is visible on at least one module audit-log page', () => {
    const coveredEverywhere = new Set<string>();
    for (const { actions } of perPage) {
      for (const action of actions) coveredEverywhere.add(action);
    }

    // Actions this codebase deliberately keeps logged-but-dead for old rows
    // (Hard Rule #6, append-only) are STILL required to be listed somewhere
    // — that's the whole point of retaining them — so there is no exemption
    // set here. If an action is genuinely retired with no historical rows
    // left to display, the fix is to delete it from ALL_AUDIT_ACTIONS
    // (lib/audit/log-action.ts) and its humanize.ts label, not to carve out
    // an exception in this test.
    const invisible = ALL_AUDIT_ACTIONS.filter(
      (action) => !coveredEverywhere.has(action)
    );

    expect(invisible).toEqual([]);
  });
});
