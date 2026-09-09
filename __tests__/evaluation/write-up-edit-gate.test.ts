import { describe, it, expect } from 'vitest';

import { canEditWriteups } from '@/lib/evaluation/edit-gate';

// Who may TYPE in a write-up field. Three conditions, and each of them exists
// because getting it wrong has a specific cost:
//
//   role              — only a teacher is gated at all; oversight roles fill
//                       gaps when an adviser is late (KD #28).
//   hasVirtueTheme    — the theme is the prompt they write against, and a hard
//                       publish gate. No theme, nothing to write against.
//   isAdviserOfRecord — the write-up becomes the form class adviser's comment
//                       on the report card, and that card prints ONE name
//                       (KD #158). A co-adviser advises the class in every
//                       other respect and does not write this.
//
// The third is the newest and the least obvious, so it is worth saying plainly
// what it is protecting against: without it, a co-adviser reaches an editable
// roster and `app/api/evaluation/writeups/route.ts` — which has never admitted
// anyone but the adviser of record — answers 403 on every autosave. The route
// is right. This predicate is what makes the page agree with it.

describe('canEditWriteups', () => {
  describe('a teacher who is the adviser of record', () => {
    it('may edit once the virtue theme is set', () => {
      expect(canEditWriteups('teacher', true, true)).toBe(true);
    });

    it('may not edit before the theme is set', () => {
      expect(canEditWriteups('teacher', false, true)).toBe(false);
    });
  });

  describe('a co-adviser', () => {
    it('may not edit, even with the theme set', () => {
      // The case that matters. Every other condition is satisfied — the class
      // is genuinely theirs, the theme is set, they hold the teacher role —
      // and the answer is still no, because the comment prints one name.
      expect(canEditWriteups('teacher', true, false)).toBe(false);
    });

    it('is not told the theme is what is stopping them', () => {
      // Both false. Asserted so the two reasons cannot be collapsed into one
      // flag later: the page shows a different sentence for each, and setting
      // the theme would change nothing for a co-adviser.
      expect(canEditWriteups('teacher', false, false)).toBe(false);
    });
  });

  describe('oversight roles', () => {
    // They are admitted by role and hold no assignment row to check, so the
    // page passes `true` for the third argument. Asserted across the board
    // anyway: if a caller ever passes `false`, an academic coordinator must not
    // silently lose the ability to fix a late adviser's write-up.
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as const) {
      it(`lets ${role} edit regardless of theme or adviser row`, () => {
        expect(canEditWriteups(role, false, false)).toBe(true);
        expect(canEditWriteups(role, true, true)).toBe(true);
      });
    }
  });

  it('treats a null role as not-a-teacher, and that is only safe upstream', () => {
    // ⚠ RECORDED, NOT ENDORSED. The predicate gates `teacher` and lets
    // everything else through, so a null role returns true — it is an
    // allowlist of one, not a permission check. What actually keeps a nobody
    // out is the role redirect at the top of
    // app/(evaluation)/evaluation/sections/[sectionId]/page.tsx and
    // requireRole in the route. Pinned so that if this ever becomes the only
    // thing standing between a session and a write-up field, the test says so.
    expect(canEditWriteups(null, true, true)).toBe(true);
  });
});
