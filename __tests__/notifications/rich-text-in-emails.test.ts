import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// EVERY RICH-TEXT FIELD IS STRIPPED BEFORE IT REACHES A RECIPIENT.
//
// Four text boxes now store HTML: the change-request justification and
// decision note, the Final Grade "reason for change", and the P-Files document
// rejection reason. `escapeHtml` was written when all four were plain, and it
// does exactly the wrong thing to markup — it makes the tags VISIBLE. Without
// the stripper an HOD opens the approval request and reads
// `<p><strong>Please review</strong> — the score was 78.</p>`.
//
// The templates compose and post in one call, with no exported render
// function, so the sent mail is the seam these tests read.

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ subject: string; html: string }>,
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (args: { subject: string; html: string }) => {
        sent.push(args);
        return { data: { id: 'mock-id' }, error: null };
      },
    };
  },
}));

import { notifyAnnualLetterChanged } from '@/lib/notifications/email-annual-letter';
import {
  notifyRequestApproved,
  notifyRequestFiled,
  notifyRequestRejected,
} from '@/lib/notifications/email-change-request';
import { sendReminder } from '@/lib/notifications/email-pfile-reminder';

// What a teacher actually types once the editor is a rich-text one: a bold
// run, an em dash, and a second paragraph.
const FORMATTED_JUSTIFICATION =
  '<p><strong>Please review</strong> — the score was 78.</p>' +
  '<p>The rubric was misread on question 4.</p>';

/** The body of the last mail this template posted. */
function lastHtml(): string {
  const last = sent.at(-1);
  if (!last) throw new Error('no email was sent');
  return last.html;
}

/**
 * The frame legitimately contains markup of its own — tables, inline styles,
 * the logo. What must never appear is the ESCAPED form of a tag the teacher's
 * editor produced, because that is what the reader sees as literal text.
 */
function expectNoVisibleTags(html: string) {
  expect(html).not.toContain('&lt;p&gt;');
  expect(html).not.toContain('&lt;strong&gt;');
  expect(html).not.toContain('&lt;/p&gt;');
  expect(html).not.toContain('&lt;em&gt;');
  expect(html).not.toContain('&lt;ul&gt;');
}

const REQUEST = {
  id: '11111111-1111-1111-1111-111111111111',
  grading_sheet_id: '22222222-2222-2222-2222-222222222222',
  field_changed: 'qa_score',
  current_value: '78',
  proposed_value: '85',
  reason_category: 'data_entry_error',
  justification: FORMATTED_JUSTIFICATION,
  requested_by_email: 'teacher@hfse.edu.sg',
  requested_at: '2026-09-01T00:00:00.000Z',
  reviewed_by_email: 'hod@hfse.edu.sg',
  decision_note: null as string | null,
  student_label: 'Ravi Kumar',
  sheet_label: 'G5 Diamond · Mathematics · T1',
};

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe('change-request emails', () => {
  it('renders a formatted justification as readable prose, not as tags', async () => {
    await notifyRequestFiled(REQUEST, [
      { id: 'approver-1', email: 'hod@hfse.edu.sg' },
    ]);

    const html = lastHtml();
    expect(html).toContain('Please review — the score was 78.');
    expect(html).toContain('The rubric was misread on question 4.');
    expectNoVisibleTags(html);
  });

  it('does not let the editor smuggle markup into the mail body', async () => {
    // `toPlainText` runs the value through the TipTap schema, so a tag the
    // editor never allowed is gone before `escapeHtml` ever sees it — and the
    // words that were inside it survive as words.
    await notifyRequestFiled(
      {
        ...REQUEST,
        justification:
          '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
      },
      [{ id: 'approver-1', email: 'hod@hfse.edu.sg' }]
    );

    const html = lastHtml();
    expect(html).toContain('ok');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onerror');
  });

  it('strips the decision note on an approval', async () => {
    await notifyRequestApproved(
      { ...REQUEST, decision_note: '<p>Applied on <em>Monday</em>.</p>' },
      'teacher@hfse.edu.sg',
      []
    );

    const html = lastHtml();
    expect(html).toContain('Applied on Monday.');
    expectNoVisibleTags(html);
  });

  it('treats an editor that was opened and left alone as no note at all', async () => {
    // `<p></p>` is seven characters and perfectly truthy. Testing the column
    // rather than the prose printed a bare "Note:" heading with nothing under
    // it on every approval where the approver tabbed through the box.
    await notifyRequestApproved(
      { ...REQUEST, decision_note: '<p></p>' },
      'teacher@hfse.edu.sg',
      []
    );

    expect(lastHtml()).not.toContain('Note:');
  });

  it('strips the reason on a rejection, and falls back when it is blank', async () => {
    await notifyRequestRejected(
      {
        ...REQUEST,
        decision_note: '<p><strong>Not</strong> enough evidence.</p>',
      },
      'teacher@hfse.edu.sg'
    );
    expect(lastHtml()).toContain('Not enough evidence.');
    expectNoVisibleTags(lastHtml());

    await notifyRequestRejected(
      { ...REQUEST, decision_note: '<p><br></p>' },
      'teacher@hfse.edu.sg'
    );
    expect(lastHtml()).toContain('(no reason provided)');
  });

  it('leaves the scalars in the summary table exactly as they were', async () => {
    // Only the two rich-text fields are stripped. A student name carrying an
    // ampersand still has to arrive escaped, or the mail is malformed.
    await notifyRequestFiled({ ...REQUEST, student_label: 'Ravi & Sara' }, [
      { id: 'approver-1', email: 'hod@hfse.edu.sg' },
    ]);

    expect(lastHtml()).toContain('Ravi &amp; Sara');
  });
});

describe('final-grade change email', () => {
  it('renders the reason as prose', async () => {
    await notifyAnnualLetterChanged(
      {
        studentName: 'Ravi Kumar',
        subjectCode: 'MUS',
        sectionName: 'G5 Diamond',
        termLabel: 'Term 4',
        before: 'Passed',
        after: 'Merit',
        reason: '<p>Moderated after the <em>portfolio</em> review.</p>',
        actorEmail: 'coordinator@hfse.edu.sg',
      },
      ['admin@hfse.edu.sg']
    );

    const html = lastHtml();
    expect(html).toContain('Moderated after the portfolio review.');
    expectNoVisibleTags(html);
  });
});

describe('P-Files document rejection email', () => {
  const envelope = {
    kind: 'parent' as const,
    to: 'parent@example.com',
    cc: [],
    primaryRole: 'mother' as const,
  };

  const ctx = {
    studentName: 'Ravi Kumar',
    level: 'G5',
    section: 'Diamond',
    slotKey: 'passport',
    slotLabel: 'Passport',
    statusKind: 'rejected' as const,
    expiryDateIso: null,
    kind: 'rejection' as const,
    enroleeNumber: 'E-0001',
    ayCode: 'AY2026',
  };

  it('sends the parent the reason, not the markup around it', async () => {
    await sendReminder(
      {
        ...ctx,
        rejectionReason:
          '<p>The photo is <strong>blurry</strong>.</p><p>Please rescan it.</p>',
      },
      envelope
    );

    const html = lastHtml();
    expect(html).toContain('The photo is blurry.');
    expect(html).toContain('Please rescan it.');
    expectNoVisibleTags(html);
  });

  it('falls back when the reason strips to nothing', async () => {
    await sendReminder({ ...ctx, rejectionReason: '<p>   </p>' }, envelope);
    expect(lastHtml()).toContain('(no reason provided)');
  });
});
