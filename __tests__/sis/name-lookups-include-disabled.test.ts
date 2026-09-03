/**
 * A name lookup must not be built on a list that excludes people.
 *
 * This is the surviving half of a test written for a design that has since
 * been replaced. The design is gone; the defect it caught is not, so the
 * guard stays.
 *
 * ⚠ THE FAILURE MODE IS SILENCE. These two surfaces resolve a user id into a
 * person's name, and both DROP any id they cannot resolve — so a list that is
 * too narrow does not refuse anything, it renders a blank where a person
 * should be. That is exactly how the `school_admin` form advisers came to show
 * as "no adviser at all" on six screens (Markbook, Attendance, Evaluation,
 * Classroom, Records and the SIS home page), and as "(unknown user)" beside a
 * raw uuid on their own section's Teachers tab.
 *
 * Whoever HOLDS a class is the name of record whether or not they can sign in
 * today, so a name lookup must ask for disabled accounts too. Recording who
 * teaches a class is a different question from whether that person can log in
 * this morning.
 *
 * A source grep, deliberately: both surfaces are server components whose
 * behaviour here is a single argument, and rendering them to assert "this list
 * came from that helper" would test the mock rather than the wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Source with comments stripped — the assertion is about what the file
 *  CALLS, and these files naturally name the helper in prose as well. */
const source = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('the surfaces that only resolve a NAME', () => {
  it.each([
    ['the form adviser of each section', 'lib/sis/staff.ts'],
    ['the grading sheets list', 'app/(markbook)/markbook/grading/page.tsx'],
  ])('%s asks for disabled accounts too', (_label, path) => {
    expect(source(path)).toContain(
      'getTeacherList({ excludeDisabled: false })'
    );
  });
});
