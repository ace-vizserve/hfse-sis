import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A DOCUMENT CHASE EMAIL IS NOT ALWAYS ABOUT AN EXPIRY DATE.
//
// Both chase emails — the renewal one and the application one — are sent for
// all five `statusKind` values, but the school's revised copy was written
// around a single example, "expires in 21 days", and typed that phrase into
// the subject, the heading and the message as fixed text. Applied literally a
// parent whose passport we have NEVER RECEIVED is told it expires in 21 days.
//
// These tests exist to stop that sentence coming back. The rule they encode:
// a document we do not hold is never described with a date, and the word
// "expire" appears only when the status is genuinely an expiry one.

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

import {
  sendReminder,
  type ReminderContext,
  type ReminderKind,
  type SlotStatusKind,
} from '@/lib/notifications/email-pfile-reminder';

const envelope = {
  kind: 'parent' as const,
  to: 'parent@example.com',
  cc: [],
  primaryRole: 'mother' as const,
};

const base: ReminderContext = {
  studentName: 'Aiden Tan',
  level: 'Primary Six',
  section: 'Diligence',
  slotKey: 'passport',
  slotLabel: 'Student Passport',
  statusKind: 'missing',
  expiryDateIso: null,
  kind: 'renewal',
  enroleeNumber: 'E260001',
  ayCode: 'AY2026',
};

/**
 * The copy lives in multi-line template literals, so the rendered HTML carries
 * line breaks and indentation in the middle of sentences. A reader sees none
 * of that — the mail client collapses it — so these tests read the collapsed
 * form, which is the sentence the parent actually gets.
 */
function collapse(html: string): string {
  return html.replace(/\s+/g, ' ');
}

/** Send one reminder and hand back exactly what the parent receives. */
async function send(
  statusKind: SlotStatusKind,
  kind: ReminderKind,
  expiryDateIso: string | null = null
): Promise<{ subject: string; html: string }> {
  await sendReminder({ ...base, statusKind, kind, expiryDateIso }, envelope);
  const last = sent.at(-1);
  if (!last) throw new Error('no email was sent');
  return { subject: last.subject, html: collapse(last.html) };
}

/** 21 days out, so the descriptor reads "expires in 21 days". */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = 'test-key';
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.restoreAllMocks();
});

// The statuses that describe a document the school does not hold a valid
// copy of. None of them has an expiry date to report.
const DATELESS: SlotStatusKind[] = ['missing', 'toFollow', 'rejected'];

describe.each(['renewal', 'initial-chase'] as const)(
  '%s chase, for a document with no expiry date',
  (kind) => {
    it.each(DATELESS)('never says "expire" for %s', async (statusKind) => {
      const { subject, html } = await send(statusKind, kind);
      expect(subject.toLowerCase()).not.toContain('expire');
      expect(html.toLowerCase()).not.toContain('expire');
    });

    it.each(DATELESS)('prints no expiry line for %s', async (statusKind) => {
      const { html } = await send(statusKind, kind);
      expect(html).not.toContain('Document expiry:');
    });

    it.each(DATELESS)(
      'still names the child and the document for %s',
      async (statusKind) => {
        const { subject, html } = await send(statusKind, kind);
        expect(subject).toContain('Aiden Tan');
        expect(subject).toContain('Student Passport');
        expect(html).toContain('Aiden Tan');
        expect(html).toContain('Primary Six Diligence');
      }
    );
  }
);

describe('renewal chase wording', () => {
  it('reports the expiry in the subject when there is one', async () => {
    const { subject, html } = await send('expiringSoon', 'renewal', inDays(21));
    expect(subject).toBe(
      'Action Needed: Submit Updated Student Passport for Aiden Tan (Expires in 21 days)'
    );
    expect(html).toContain('Student Passport on file expires in 21 days');
    expect(html).toContain('Document expiry:');
  });

  it('says the document has not arrived when it is missing', async () => {
    const { subject, html } = await send('missing', 'renewal');
    expect(subject).toBe(
      'Action Needed: Submit Student Passport for Aiden Tan (Not yet received)'
    );
    expect(html).toContain('we have not yet received');
  });

  it('asks for a replacement when the last upload was rejected', async () => {
    const { subject, html } = await send('rejected', 'renewal');
    expect(subject).toContain('(Needs replacement)');
    expect(html).toContain('needs to be replaced');
    // The parent DID send something. Telling them nothing arrived makes them
    // send the same file again.
    expect(html).not.toContain('have not yet received');
  });
});

describe('application chase wording', () => {
  it('carries no expiry bracket — the document was never submitted', async () => {
    const { subject } = await send('missing', 'initial-chase');
    expect(subject).toBe(
      'Action Needed: Submit Student Passport for Aiden Tan'
    );
  });

  it('says "not submitted" only when nothing was submitted', async () => {
    const missing = await send('missing', 'initial-chase');
    expect(missing.html).toContain('has not been submitted');

    const rejected = await send('rejected', 'initial-chase');
    expect(rejected.html).toContain('needs to be replaced');
    expect(rejected.html).not.toContain('has not been submitted');
  });
});

describe('every chase email', () => {
  const ALL: SlotStatusKind[] = [
    'expired',
    'expiringSoon',
    'rejected',
    'missing',
    'toFollow',
  ];

  it.each(ALL)('tells the parent where to upload (%s)', async (statusKind) => {
    const { html } = await send(statusKind, 'renewal', inDays(5));
    expect(html).toContain('under your enrolment details page');
    expect(html).toContain('to confirm receipt');
  });

  it.each(ALL)(
    'points at the school office, not the registrar (%s)',
    async (statusKind) => {
      const { html } = await send(statusKind, 'initial-chase', inDays(5));
      expect(html).toContain('the school office');
      expect(html).not.toContain('registrar');
      expect(html).toContain('Sign in to the parent portal');
    }
  );
});

describe('rejection email', () => {
  it('names the child, and does not claim this is about admission', async () => {
    await sendReminder(
      {
        ...base,
        statusKind: 'rejected',
        kind: 'rejection',
        rejectionReason: '<p>The scan is cut off at the bottom.</p>',
      },
      envelope
    );
    const last = sent.at(-1);
    if (!last) throw new Error('no email was sent');
    const html = collapse(last.html);
    expect(last.subject).toBe(
      'Action Needed: Student Passport for Aiden Tan does not meet requirements'
    );
    // This email also fires for children who are already enrolled.
    expect(last.subject).not.toContain('admission');
    expect(html).toContain('the school office');
    expect(html).not.toContain('registrar');
  });
});
