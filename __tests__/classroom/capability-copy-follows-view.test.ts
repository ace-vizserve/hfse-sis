/**
 * The second of Phase 3a's two named label defects, confirmed rather than
 * assumed.
 *
 * `/classroom/[sectionId]` told a teaching admin standing in HER OWN form
 * class: "Read-only oversight view — every panel available for review." She is
 * the form adviser of record for it. The brief's claim was that this line
 * fixes itself once the layout resolves capability through the lens, because
 * she then resolves to `adviser` — this file is the check that it actually
 * does, since "it should follow" is exactly the kind of reasoning that ships a
 * defect.
 *
 * Two halves, because neither alone is the confirmation:
 *   1. the real resolver answers `adviser` for her own section in the Teacher
 *      view, and `oversight` in the Admin view;
 *   2. the layout still picks its sentence by that capability, from a map with
 *      one entry per capability — so (1) settles which sentence renders.
 *
 * Half 2 reads the source because `CAPABILITY_COPY` is module-local to a
 * server layout, and Next.js route files may not carry arbitrary named
 * exports. Brittle to a rename, which is the point: a rename should land here
 * and be re-confirmed rather than quietly stop covering anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AssignmentRow } from '@/lib/auth/teacher-assignments';
import {
  capabilityForSection,
  resolveClassroomScope,
} from '@/lib/classroom/scope';

const LAYOUT = 'app/(classroom)/classroom/[sectionId]/layout.tsx';
const HER_CLASS = 'sec-hers';

const herAdviserRow: AssignmentRow = {
  id: 'adv-1',
  teacher_user_id: 'u-teaching-admin',
  section_id: HER_CLASS,
  subject_id: null,
  role: 'form_adviser',
};

function copyMap(): Record<string, string> {
  const source = readFileSync(join(process.cwd(), LAYOUT), 'utf8');
  const block = source.match(
    /const CAPABILITY_COPY: Record<string, string> = \{([\s\S]*?)\n\};/
  );
  expect(
    block,
    `${LAYOUT} no longer declares CAPABILITY_COPY the way this test reads it`
  ).not.toBeNull();
  const entries = [
    ...block![1].matchAll(/(\w+):\s*\n?\s*'((?:[^'\\]|\\.)*)'/g),
  ];
  return Object.fromEntries(entries.map((m) => [m[1], m[2]]));
}

describe('the classroom header copy follows the view, not the account', () => {
  it('a teaching admin in the Teacher view is the ADVISER of her own class', () => {
    const scope = resolveClassroomScope('teacher', [herAdviserRow]);
    expect(capabilityForSection(scope, HER_CLASS)).toBe('adviser');
  });

  it('and oversight over it again in the Admin view', () => {
    const scope = resolveClassroomScope('school_admin', [herAdviserRow]);
    expect(capabilityForSection(scope, HER_CLASS)).toBe('oversight');
  });

  it('the layout has one sentence per capability and picks by capability', () => {
    const copy = copyMap();
    expect(Object.keys(copy).sort()).toEqual([
      'adviser',
      'oversight',
      'subject',
    ]);

    const source = readFileSync(join(process.cwd(), LAYOUT), 'utf8');
    expect(source).toContain('CAPABILITY_COPY[capability]');
  });

  it('so the sentence she now reads is the adviser one, not the oversight one', () => {
    const copy = copyMap();
    const scope = resolveClassroomScope('teacher', [herAdviserRow]);
    const capability = capabilityForSection(scope, HER_CLASS)!;

    expect(copy[capability]).toContain('You are the form adviser');
    expect(copy[capability]).not.toContain('Read-only oversight view');
    // The oversight line is still correct for a coordinator and must stay.
    expect(copy.oversight).toContain('Read-only oversight view');
  });
});
