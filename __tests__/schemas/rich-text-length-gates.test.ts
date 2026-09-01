import { describe, expect, it } from 'vitest';

import { DecideApprovalSchema } from '@/lib/schemas/approval-flows';
import { optionalText } from '@/lib/schemas/enrolment';
import { DocumentValidationSchema } from '@/lib/schemas/sis';

// THE LENGTH GATES THAT WERE STILL COUNTING MARKUP.
//
// A first pass converted the obvious `.max()` caps to measure prose. These
// four were missed, and each was found by a different agent swapping the call
// sites rather than by reading the schemas — which is the point: the gap is
// invisible from the schema file, and only shows up when you know the field
// became a formatting editor.
//
// The shared fact behind all of them: an editor that has been clicked into and
// left alone stores `<p></p>`. Seven characters that the writer never typed
// and cannot see.
const EMPTY_DOC = '<p></p>';

// Guard the premise the rest of the file rests on. If this ever stops being
// true, the tests below stop testing anything.
it('an empty editor document is non-empty by the string test these replaced', () => {
  expect(EMPTY_DOC.trim().length > 0).toBe(true);
});

describe('optionalText — the shared cap behind nine fields', () => {
  // Enrolment academics/admin notes, withdrawal notes, stage remarks, home
  // address, learning needs, discount details, assignment change notes.
  const cap200 = optionalText(200);

  it('measures the writing, not the tags', () => {
    // 200 characters of prose wrapped in marks is a valid 200-character note.
    // Against the raw string this is 200 + 30 and would have been refused,
    // while the counter on screen read exactly 200 / 200.
    const prose = 'a'.repeat(200);
    const formatted = `<p><strong><em>${prose}</em></strong></p>`;
    expect(cap200.safeParse(formatted).success).toBe(true);
  });

  it('still refuses writing that is genuinely too long', () => {
    expect(cap200.safeParse(`<p>${'a'.repeat(201)}</p>`).success).toBe(false);
  });

  it('clears the field when the editor is emptied', () => {
    // '' meant "cleared" before; `<p></p>` is what an emptied editor sends now,
    // and it has to mean the same thing or the field can never be blanked.
    expect(cap200.parse(EMPTY_DOC)).toBeNull();
    expect(cap200.parse('')).toBeNull();
    expect(cap200.parse('<p><br></p>')).toBeNull();
  });

  it('keeps real content', () => {
    expect(cap200.parse('<p>Moved to the afternoon class.</p>')).toBe(
      '<p>Moved to the afternoon class.</p>'
    );
  });
});

describe('DecideApprovalSchema — a rejection must carry a reason', () => {
  // The parent is shown this text and nothing else. A rejection with no reason
  // is the exact failure the rule was written to refuse.
  it('refuses a rejection whose note is an empty editor', () => {
    const result = DecideApprovalSchema.safeParse({
      action: 'reject',
      note: EMPTY_DOC,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a rejection with a real reason', () => {
    expect(
      DecideApprovalSchema.safeParse({
        action: 'reject',
        note: '<p>The certificate names a different child.</p>',
      }).success
    ).toBe(true);
  });

  it('still lets an approval carry no note at all', () => {
    expect(DecideApprovalSchema.safeParse({ action: 'approve' }).success).toBe(
      true
    );
  });

  it('does not spend the note budget on formatting', () => {
    const note = `<p><strong>${'a'.repeat(300)}</strong></p>`;
    expect(
      DecideApprovalSchema.safeParse({ action: 'approve', note }).success
    ).toBe(true);
  });
});

describe('DocumentValidationSchema — the 20-character floor is for the parent', () => {
  // This reason is emailed to a family. The floor exists so they are told
  // something they can act on.
  it('refuses thirteen typed characters dressed up as twenty', () => {
    // 13 characters + `<p></p>` is 20 by the raw string. It is not 20 words'
    // worth of explanation to a parent.
    const short = `<p>${'a'.repeat(13)}</p>`;
    expect(short.trim().length).toBeGreaterThanOrEqual(20);
    expect(
      DocumentValidationSchema.safeParse({
        status: 'Rejected',
        rejectionReason: short,
      }).success
    ).toBe(false);
  });

  it('refuses a single bolded word', () => {
    expect(
      DocumentValidationSchema.safeParse({
        status: 'Rejected',
        rejectionReason: '<p><strong>Unreadable</strong></p>',
      }).success
    ).toBe(false);
  });

  it('accepts a real explanation', () => {
    expect(
      DocumentValidationSchema.safeParse({
        status: 'Rejected',
        rejectionReason:
          '<p>The passport scan is cut off at the bottom edge. Please re-upload the whole page.</p>',
      }).success
    ).toBe(true);
  });

  it('needs no reason when the document is accepted', () => {
    expect(
      DocumentValidationSchema.safeParse({ status: 'Valid' }).success
    ).toBe(true);
  });
});
