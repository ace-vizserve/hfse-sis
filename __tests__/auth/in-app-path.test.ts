/**
 * The open-redirect guard on the view switcher's destination.
 *
 * Switching views used to always land on `/`. The wrong-view notice has to put
 * the viewer back where they were, so the switch route now takes a destination
 * from the client — and a client-supplied destination is the classic
 * open-redirect shape. `safeInAppPath` is the whole check, so the rejections
 * are asserted one attack at a time rather than as a single "rejects bad
 * input" case: each row below passes a naive `startsWith('/')` or a naive
 * "contains ://" test, which is how this bug normally ships.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SWITCH_DESTINATION,
  safeInAppPath,
} from '@/lib/auth/in-app-path';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);

describe('safeInAppPath — real destinations are accepted', () => {
  it.each([
    ['/', '/'],
    ['/classroom', '/classroom'],
    ['/attendance/abc-123', '/attendance/abc-123'],
    // The query string is the reason the button reads the live URL rather than
    // rebuilding one from route params — a dropped `?term_id=` would silently
    // reset the viewer's chosen term.
    ['/attendance/abc-123?term_id=t2', '/attendance/abc-123?term_id=t2'],
    [
      '/classroom/s1/write-ups?term_id=t3#roster',
      '/classroom/s1/write-ups?term_id=t3#roster',
    ],
    ['/markbook/report-cards/stu-1', '/markbook/report-cards/stu-1'],
  ])('%s', (input, expected) => {
    expect(safeInAppPath(input)).toBe(expected);
  });

  it('normalises rather than echoing, so what is returned is what was checked', () => {
    // Rebuilt from the parsed URL parts. `/a/./b` resolving to `/a/b` is the
    // visible proof that the value went through the parser.
    expect(safeInAppPath('/a/./b')).toBe('/a/b');
  });
});

describe('safeInAppPath — the attacks it exists for', () => {
  it.each([
    // A plain absolute URL. The obvious one.
    ['https://evil.example/steal'],
    ['http://evil.example'],
    // Protocol-relative: starts with "/", and the browser reads it as another
    // HOST. This is the one a naive startsWith('/') check lets straight past.
    ['//evil.example'],
    ['//evil.example/path'],
    // The backslash spelling of the same thing — browsers normalise "\" to "/".
    ['/\\evil.example'],
    ['/\\\\evil.example'],
    ['\\\\evil.example'],
    // Scheme smuggled behind stripped whitespace or control characters.
    [`/${TAB}https://evil.example`],
    [`/${NEWLINE}//evil.example`],
    [`${CR}//evil.example`],
    [` //evil.example`],
    [`/path${NUL}`],
    // Not a path at all.
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['mailto:someone@example.com'],
    // Relative, so it would resolve against wherever the client happens to be.
    ['classroom'],
    ['../admin'],
    [''],
  ])('rejects %j', (input) => {
    expect(safeInAppPath(input)).toBeNull();
  });

  it('rejects anything that is not a string', () => {
    for (const value of [
      undefined,
      null,
      42,
      true,
      {},
      [],
      { toString: () => '/' },
    ]) {
      expect(safeInAppPath(value)).toBeNull();
    }
  });

  it('rejects an absurdly long value before parsing it', () => {
    expect(safeInAppPath('/' + 'a'.repeat(5000))).toBeNull();
  });

  it('the fallback destination is in-app itself', () => {
    // Guards the one value every rejection falls back to. If this ever became
    // something else, every rejection above would start redirecting there.
    expect(safeInAppPath(DEFAULT_SWITCH_DESTINATION)).toBe('/');
  });
});
