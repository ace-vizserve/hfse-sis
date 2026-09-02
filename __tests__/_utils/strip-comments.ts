import { expect } from 'vitest';

/**
 * Remove comments from TypeScript source, one pass, tracking which kind we are
 * inside. For the source-scanning guards, which want to assert things about
 * CODE while leaving authors free to write prose about the rule above it.
 *
 * 🔴 WHY THIS IS NOT TWO REGEXES, WHICH IS WHAT EVERY GUARD IN THIS REPO USED.
 * Stripping block comments first and line comments second cannot tell a
 * block-comment opener apart from one sitting INSIDE a line comment.
 * `app/(classroom)/classroom/[sectionId]/layout.tsx` carries a line comment
 * naming the route folder with a wildcard, and that wildcard opened a block
 * comment for the regex, which then ran to the next close delimiter forty
 * lines later — silently deleting the code in between. In
 * `__tests__/auth/view-role-call-sites.test.ts` that swallowed the very
 * `loadClassroomAccess(` call the guard exists to classify, dropping its count
 * from 14 to 13. It was caught only because that file pins an exact count.
 *
 * ⚠ Swapping the order does not fix it — stripping line comments first breaks
 * a block comment containing a URL, whose `//` would eat the closing delimiter
 * and everything after. One pass with state is the only version correct in
 * both directions, and over-stripping is the dangerous failure for every
 * caller: these guards assert that something is ABSENT, so deleted code reads
 * as a pass.
 *
 * Strings are tracked so a comment-looking sequence inside a literal is not
 * mistaken for a comment. Template literals are treated as strings without
 * parsing `${…}`, which is enough for the files these guards scan.
 *
 * Newlines inside comments are preserved, so line numbers in the output still
 * line up with the input.
 */

/** Where the scanner was when it ran out of input. */
export type ScanMode =
  | 'code'
  | 'line'
  | 'block'
  | 'single'
  | 'double'
  | 'template';

export type ScanResult = {
  /** The source with comments removed. */
  stripped: string;
  /**
   * The mode the scanner ended in. Anything but `'code'` (or `'line'`, which a
   * file ending on a `//` comment with no trailing newline legitimately
   * reaches) means the scan DESYNCED partway through and the tail of
   * `stripped` is unreliable. See `assertScannableFiles`.
   */
  endMode: ScanMode;
};

/**
 * ⚠ THE ONE THING THIS SCANNER DOES NOT MODEL: REGULAR-EXPRESSION LITERALS.
 *
 * Telling `/` -as-division from `/` -as-regex needs the preceding token, which
 * is real parsing. So a regex containing a quote or a `//` desyncs the
 * scanner: `.replace(/"/g, '""')` reads as "enter a double-quoted string at
 * the first `"`", and everything until the next `"` — which is inside the
 * REPLACEMENT string — is treated as string content.
 *
 * ⚠ AND A SECOND CAUSE, missed on the first count: an APOSTROPHE IN JSX PROSE.
 * JSX text is `code` to this scanner, so `nobody else's view changes.` opens a
 * single-quoted string. Only an ODD number of them leaves the scanner stuck,
 * which is why just two of the repo's many `.tsx` files are affected and why
 * the class is easy to miss.
 *
 * Six files in this repo desync today — `lib/csv.ts`,
 * `lib/markbook/masterfile-export.ts`,
 * `lib/markbook/academic-overview-export.ts`,
 * `lib/notifications/email-frame.ts` (regex literals), plus
 * `components/attendance/drills/chart-drill-cards.tsx` and
 * `components/classroom/classroom-settings-form.tsx` (JSX apostrophes) — and
 * none is currently inside any guard's scan set. That is luck, not design, and
 * the failure is silent in the dangerous direction.
 *
 * Rather than build a regex mode — which is where scanners like this go to
 * die — the scanner REPORTS where it finished, and `assertScannableFiles`
 * turns "did not finish in code" into a test failure. One check, and it
 * catches the whole class rather than the instances we happen to know about.
 */
export function scanComments(text: string): ScanResult {
  let out = '';
  let i = 0;
  let mode: ScanMode = 'code';

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        mode = 'block';
        i += 2;
        continue;
      }
      if (c === "'") mode = 'single';
      else if (c === '"') mode = 'double';
      else if (c === '`') mode = 'template';
      out += c;
      i += 1;
      continue;
    }

    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      }
      i += 1;
      continue;
    }

    if (mode === 'block') {
      if (c === '*' && next === '/') {
        mode = 'code';
        i += 2;
        continue;
      }
      if (c === '\n') out += c;
      i += 1;
      continue;
    }

    // Inside a string literal. A backslash escapes whatever follows, so a
    // closing quote cannot be faked with an escaped one.
    if (c === '\\') {
      out += c + (next ?? '');
      i += 2;
      continue;
    }
    if (
      (mode === 'single' && c === "'") ||
      (mode === 'double' && c === '"') ||
      (mode === 'template' && c === '`')
    ) {
      mode = 'code';
    }
    out += c;
    i += 1;
  }

  return { stripped: out, endMode: mode };
}

export function stripComments(text: string): string {
  return scanComments(text).stripped;
}

/**
 * A file the scanner finished cleanly on. `'line'` counts: a file whose last
 * line is a `//` comment with no trailing newline ends there legitimately, and
 * nothing after it was skipped because there is nothing after it.
 */
function finishedCleanly(endMode: ScanMode): boolean {
  return endMode === 'code' || endMode === 'line';
}

/**
 * Assert the scanner read every one of these files to the end.
 *
 * ⚠ THIS IS THE ONLY ASSERTION THAT CAN TELL "NO OFFENDERS" APART FROM "NO
 * TEXT LEFT". Every guard built on `stripComments` asserts that something is
 * absent from the result, so a scan that silently threw away half a file
 * passes with flying colours. A file that ends mid-string or mid-block-comment
 * did exactly that.
 *
 * Call it once per guard with that guard's own scan set. When it fails, the
 * fix is usually to rewrite the offending regex literal (e.g. a character
 * class instead of a bare quote), not to widen this check.
 */
export function assertScannableFiles(
  files: ReadonlyArray<{ path: string; source: string }>
): void {
  const offenders = files
    .map((f) => ({ path: f.path, endMode: scanComments(f.source).endMode }))
    .filter((f) => !finishedCleanly(f.endMode))
    .map((f) => `${f.path} (ended in ${f.endMode} mode)`);

  expect(
    offenders,
    'The comment scanner desynced on these files and stopped tracking code ' +
      'partway through, so everything after that point was silently dropped ' +
      'from what this guard inspected — which for an absence guard reads as a ' +
      'PASS. The usual cause is a regular-expression literal containing a ' +
      'quote or a "//" (see the note on `scanComments`): `.replace(/"/g, …)` ' +
      'opens a string the scanner never closes. Rewrite the literal — ' +
      '`/["]/g` instead of `/"/g` — or exclude the file from this scan set on ' +
      'purpose.'
  ).toEqual([]);
}
