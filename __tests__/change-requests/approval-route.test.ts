import { describe, expect, it } from 'vitest';

import {
  GRADE_CHANGE_SUBJECT_TYPE,
  pickGradeChangeFlow,
  type PickGradeChangeFlowInput,
} from '@/lib/change-requests/approval-route';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  STAGED_APPROVAL_FLOWS,
  STAGED_FLOW_DESCRIPTIONS,
  STAGED_FLOW_LABELS,
} from '@/lib/schemas/approval-flows';

const NOW = new Date('2026-09-11T04:00:00.000Z');

function pick(overrides: Partial<PickGradeChangeFlowInput>) {
  return pickGradeChangeFlow({
    sheetTermNumber: 1,
    publications: [],
    revokedPublications: [],
    publicationLog: [],
    now: NOW,
    ...overrides,
  });
}

describe('pickGradeChangeFlow — a card re-published after parents saw it', () => {
  // Publishing upserts ONE row per (section, term). Re-publishing with a later
  // start overwrites the start parents already had, so the live row alone
  // would say nobody has seen the card. The log keeps every window.

  it('goes to the board when an earlier window opened before the re-publish', () => {
    expect(
      pick({
        // The live row now says "opens 1 October" — later than today.
        publications: [
          { termNumber: 1, publishFrom: '2026-10-01T00:00:00.000Z' },
        ],
        publicationLog: [
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-09-01T00:00:00.000Z',
            at: '2026-08-30T00:00:00.000Z',
          },
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-10-01T00:00:00.000Z',
            at: '2026-09-05T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('uses the normal flow when the earlier window was replaced before it ever opened', () => {
    expect(
      pick({
        publications: [
          { termNumber: 1, publishFrom: '2026-10-01T00:00:00.000Z' },
        ],
        publicationLog: [
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-09-20T00:00:00.000Z',
            at: '2026-08-30T00:00:00.000Z',
          },
          // Moved later on 5 September — the 20 September start never arrived.
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-10-01T00:00:00.000Z',
            at: '2026-09-05T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });

  it('judges the latest logged window against now', () => {
    const latest = {
      sectionId: 'sec-a',
      termNumber: 1,
      kind: 'create' as const,
      at: '2026-08-30T00:00:00.000Z',
    };
    expect(
      pick({
        publicationLog: [
          { ...latest, publishFrom: '2026-09-10T00:00:00.000Z' },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
    expect(
      pick({
        publicationLog: [
          { ...latest, publishFrom: '2026-09-12T00:00:00.000Z' },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });

  it('a window closed by an unpublish counts only if it opened first', () => {
    const create = {
      sectionId: 'sec-a',
      termNumber: 1,
      kind: 'create' as const,
      publishFrom: '2026-09-04T00:00:00.000Z',
      at: '2026-09-01T00:00:00.000Z',
    };
    expect(
      pick({
        publicationLog: [
          create,
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'delete',
            // An unpublish row whose own publish_from was lost still ends
            // the window before it.
            publishFrom: null,
            at: '2026-09-03T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
    expect(
      pick({
        publicationLog: [
          create,
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'delete',
            publishFrom: null,
            at: '2026-09-06T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('orders the log itself — rows can arrive in any order', () => {
    expect(
      pick({
        publicationLog: [
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-10-01T00:00:00.000Z',
            at: '2026-09-05T00:00:00.000Z',
          },
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-09-01T00:00:00.000Z',
            at: '2026-08-30T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('never lets one class’s later publish end another class’s window', () => {
    // A child who moved: section A's window was replaced before opening, and
    // section B's publish on a different day must not be read as A's "next".
    expect(
      pick({
        publicationLog: [
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-09-02T00:00:00.000Z',
            at: '2026-09-01T00:00:00.000Z',
          },
          {
            sectionId: 'sec-b',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-12-01T00:00:00.000Z',
            at: '2026-09-01T12:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('an earlier term card in the log does NOT cover a later term grade', () => {
    expect(
      pick({
        sheetTermNumber: 2,
        publicationLog: [
          {
            sectionId: 'sec-a',
            termNumber: 1,
            kind: 'create',
            publishFrom: '2026-06-01T00:00:00.000Z',
            at: '2026-05-30T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });
});

describe('pickGradeChangeFlow', () => {
  it('uses the normal flow when no report card was ever published', () => {
    expect(pick({})).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });

  it('uses the normal flow when the card is only scheduled for later', () => {
    expect(
      pick({
        publications: [
          { termNumber: 1, publishFrom: '2026-09-12T00:00:00.000Z' },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });

  it('goes to the board while the card is open to parents', () => {
    expect(
      pick({
        publications: [
          { termNumber: 1, publishFrom: '2026-09-01T00:00:00.000Z' },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('counts a window opening at exactly this moment', () => {
    expect(
      pick({
        publications: [{ termNumber: 1, publishFrom: NOW.toISOString() }],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('still goes to the board after the window has closed', () => {
    // Only publish_from is consulted: a card parents could see last month has
    // been seen, whether or not the window is still open.
    expect(
      pick({
        publications: [
          { termNumber: 1, publishFrom: '2026-06-01T00:00:00.000Z' },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('goes to the board when the card was taken down after it opened', () => {
    expect(
      pick({
        revokedPublications: [
          {
            termNumber: 1,
            publishFrom: '2026-09-01T00:00:00.000Z',
            revokedAt: '2026-09-03T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('uses the normal flow when the card was taken down before it opened', () => {
    expect(
      pick({
        revokedPublications: [
          {
            termNumber: 1,
            publishFrom: '2026-09-20T00:00:00.000Z',
            revokedAt: '2026-09-03T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });

  it('a later term card covers an earlier term grade', () => {
    // Term 1 grades print on every later card.
    expect(
      pick({
        sheetTermNumber: 1,
        publications: [
          { termNumber: 3, publishFrom: '2026-09-01T00:00:00.000Z' },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
    expect(
      pick({
        sheetTermNumber: 2,
        revokedPublications: [
          {
            termNumber: 4,
            publishFrom: '2026-09-01T00:00:00.000Z',
            revokedAt: '2026-09-02T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_AEB_APPROVAL_FLOW);
  });

  it('an earlier term card does NOT cover a later term grade', () => {
    expect(
      pick({
        sheetTermNumber: 3,
        publications: [
          { termNumber: 1, publishFrom: '2026-06-01T00:00:00.000Z' },
          { termNumber: 2, publishFrom: '2026-08-01T00:00:00.000Z' },
        ],
        revokedPublications: [
          {
            termNumber: 2,
            publishFrom: '2026-08-01T00:00:00.000Z',
            revokedAt: '2026-08-05T00:00:00.000Z',
          },
        ],
      })
    ).toBe(GRADE_CHANGE_APPROVAL_FLOW);
  });
});

describe('the grade-change flows are registered', () => {
  it('both keys are staged flows with a label and a description', () => {
    for (const flow of [
      GRADE_CHANGE_APPROVAL_FLOW,
      GRADE_CHANGE_AEB_APPROVAL_FLOW,
    ]) {
      expect(STAGED_APPROVAL_FLOWS).toContain(flow);
      expect(STAGED_FLOW_LABELS[flow]).toBeTruthy();
      expect(STAGED_FLOW_DESCRIPTIONS[flow]).toBeTruthy();
    }
  });

  it('names its subject the way the engine stores it', () => {
    expect(GRADE_CHANGE_SUBJECT_TYPE).toBe('grade_change_request');
  });
});
