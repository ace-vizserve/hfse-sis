/**
 * The shared comment scanner, tested where it lives.
 *
 * ⚠ WHY THIS FILE EXISTS AT ALL. These three behaviours were originally pinned
 * next to a LOCAL copy of the scanner inside
 * `__tests__/auth/view-role-call-sites.test.ts`, while the copy that
 * `__tests__/auth/active-role-never-authorises.test.ts` imports — the one
 * standing in front of the six authorization gates — had no test of its own.
 * That was exactly backwards: over-stripping is silent and reads as a PASS, so
 * the untested copy was the one where being wrong costs the most. Same
 * precedent as `__tests__/_utils/counting-supabase.test.ts` — a shared test
 * util gets its own suite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertScannableFiles,
  scanComments,
  stripComments,
} from '@/__tests__/_utils/strip-comments';

const ROOT = process.cwd();

describe('stripComments — the bug it was written for', () => {
  it('does not treat a block-comment opener inside a LINE comment as one', () => {
    // The real instance: a line comment naming a route folder with a wildcard.
    // The old two-regex helper read that as an open block comment and ran to
    // the next close delimiter forty lines later, deleting the call the guard
    // was counting.
    const source = [
      '// see `app/api/classroom/**` for the routes',
      'loadClassroomAccess(activeRole, userId, sectionId);',
      '/* a real block comment */',
      'const after = 1;',
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).toContain('loadClassroomAccess(activeRole');
    expect(stripped).toContain('const after = 1;');
    expect(stripped).not.toContain('a real block comment');
  });

  it('does not treat a line-comment opener inside a BLOCK comment as one', () => {
    // The failure mode of the obvious fix — swapping the two regexes. The `//`
    // in the URL would eat the closing delimiter and everything after it.
    const source = [
      '/* see https://example.invalid for why */',
      'resolveClassroomScope(activeRole, assignments);',
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).toContain('resolveClassroomScope(activeRole');
    expect(stripped).not.toContain('example.invalid');
  });

  it('leaves comment-looking text inside string literals alone', () => {
    const source = `const href = '/a//b'; const t = "/* not a comment */";`;
    expect(stripComments(source)).toBe(source);
  });

  it('keeps newlines so line numbers still line up', () => {
    const source = '/* one\ntwo */\nconst x = 1;';
    expect(stripComments(source).split('\n')).toHaveLength(3);
  });

  it('does not let an escaped quote close a string', () => {
    const source = `const s = 'it\\'s fine'; const after = 1;`;
    expect(stripComments(source)).toContain('const after = 1;');
  });
});

describe('scanComments reports where it finished', () => {
  it('ends in code mode on ordinary source', () => {
    expect(scanComments('const x = 1;\n').endMode).toBe('code');
  });

  it('ends in line mode on a file whose last line is a comment', () => {
    // Legitimate, and treated as clean: nothing was skipped, because there is
    // nothing after it.
    expect(scanComments('const x = 1;\n// trailing note').endMode).toBe('line');
  });

  it('ends in block mode on an unterminated block comment', () => {
    expect(scanComments('/* never closed\nconst x = 1;').endMode).toBe('block');
  });

  it('⚠ ends in a string mode on a regex literal containing a quote', () => {
    // THE CLASS THIS REPORTING EXISTS FOR. The scanner has no regex mode —
    // telling `/`-as-division from `/`-as-regex needs real parsing — so the
    // quote inside the pattern opens a string that is never closed, and every
    // line after it is swallowed.
    const source = `const q = s.replace(/"/g, '');\nconst after = 1;`;
    const { stripped, endMode } = scanComments(source);
    expect(endMode).toBe('double');
    // The damage, stated rather than implied: the scanner kept the text but
    // stopped tracking code, so a guard scanning this would be reasoning about
    // string content it believes is code.
    expect(stripped).toContain('const after = 1;');
  });
});

describe('assertScannableFiles', () => {
  it('passes on files that parse to completion', () => {
    expect(() =>
      assertScannableFiles([
        { path: 'a.ts', source: 'const x = 1;\n' },
        { path: 'b.ts', source: '// note\nconst y = 2;\n' },
      ])
    ).not.toThrow();
  });

  it('fails, and names the file and the mode it got stuck in', () => {
    let message = '';
    try {
      assertScannableFiles([
        { path: 'bad.ts', source: `s.replace(/"/g, '');` },
      ]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('bad.ts');
    expect(message).toContain('double');
  });

  it('⚠ catches the six REAL files in this repo that desync today', () => {
    // Not a synthetic fixture: these are live source files, and this is the
    // demonstration that the check catches the class in practice rather than
    // only in a hand-built example. None of them sits in any guard's scan set
    // today — that is luck, not design, which is the whole reason the check
    // exists.
    //
    // ⚠ TWO DISTINCT CAUSES, and the second was missed on the first count
    // (the review and I both said "four"; a full walk of lib + app +
    // components found six):
    //
    //   REGEX LITERAL CONTAINING A QUOTE — `.replace(/"/g, '""')`. The scanner
    //   has no regex mode, so the quote opens a string it never closes.
    //
    //   APOSTROPHE IN JSX PROSE — `nobody else's view changes.` sitting as
    //   plain JSX text, which is `code` to the scanner, so the apostrophe
    //   opens a single-quoted string. Only files with an ODD number of them
    //   end up stuck, which is why just two of the repo's many .tsx files
    //   appear here and why this class is easy to miss.
    //
    // If one is ever rewritten (`/"/g` → `/["]/g`, or `&apos;`) this test
    // fails with a shorter list. That is a good failure: drop the entry and
    // note it.
    const known = [
      // regex-literal class
      'lib/csv.ts',
      'lib/markbook/masterfile-export.ts',
      'lib/markbook/academic-overview-export.ts',
      'lib/notifications/email-frame.ts',
      // JSX-apostrophe class
      'components/attendance/drills/chart-drill-cards.tsx',
      'components/classroom/classroom-settings-form.tsx',
    ];
    for (const path of known) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(
        scanComments(source).endMode,
        `${path} was expected to desync the scanner`
      ).not.toBe('code');
      expect(() => assertScannableFiles([{ path, source }])).toThrow();
    }
  });

  it('is not fooled into thinking every file desyncs', () => {
    // The counterweight to the list above. If `scanComments` ever started
    // returning a non-code mode for everything, that test would still pass
    // while every guard in the repo began failing for no reason.
    for (const path of ['lib/auth/roles.ts', 'lib/auth/active-role.ts']) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(scanComments(source).endMode, path).toBe('code');
    }
  });
});
