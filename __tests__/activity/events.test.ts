import { describe, it, expect } from 'vitest';

import {
  buildDeclarationEvents,
  buildGradeChangeEvents,
  initialsFromName,
  sortEventsNewestFirst,
} from '@/lib/activity/events';
import type { ActivityEvent } from '@/lib/activity/events';
import type { RequestLadder } from '@/lib/approvals/inbox';

const NAMES = new Map([
  ['u-adviser', 'Radhika Putrevu'],
  ['u-officer', 'Elaine Wee'],
  ['u-registrar', 'Lhen Mendoza'],
  ['u-teacher', 'Grace Lim'],
]);

function ladder(overrides: Partial<RequestLadder> = {}): RequestLadder {
  return {
    requestId: 'req-1',
    flow: 'student_declaration',
    subjectType: 'student_declaration',
    subjectId: 'dec-1',
    status: 'approved',
    currentStageOrder: 2,
    filedByEmail: 'parent@example.com',
    filedAt: '2026-08-24T00:12:00.000Z',
    decidedAt: '2026-08-27T02:01:20.000Z',
    stages: [
      {
        stageOrder: 1,
        label: 'Form class adviser',
        resolver: 'form_adviser',
        status: 'approved',
        sectionId: 'sec-1',
        approverPool: [],
        decidedBy: 'u-adviser',
        decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
        decidedAt: '2026-08-24T01:40:00.000Z',
        decisionNote: 'Family already has the flights.',
      },
      {
        stageOrder: 2,
        label: 'Officer in charge',
        resolver: 'named',
        status: 'approved',
        sectionId: null,
        approverPool: ['u-officer'],
        decidedBy: 'u-officer',
        decidedByEmail: 'elaine.wee@hfse.edu.sg',
        decidedAt: '2026-08-27T02:01:19.000Z',
        decisionNote: null,
      },
    ],
    ...overrides,
  };
}

describe('initialsFromName', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFromName('Radhika Putrevu')).toBe('RP');
  });

  it('falls back to the local part of an email', () => {
    expect(initialsFromName('elaine.wee@hfse.edu.sg')).toBe('EW');
  });

  it('never throws on empty input', () => {
    expect(initialsFromName('')).toBe('—');
  });
});

describe('buildDeclarationEvents', () => {
  it('emits one filed event and one event per decided step', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 1,
      registerWriteError: null,
    });

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.tone)).toEqual([
      'started',
      'went-through',
      'went-through',
    ]);
  });

  it('names a parent as the filer and never their email address', () => {
    const [filed] = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });

    expect(filed.actorLabel).toBe('A parent');
    expect(filed.predicate).toBe('filed Amelia Ng, travel 3 Sep.');
    expect(JSON.stringify(filed)).not.toContain('parent@example.com');
  });

  it('carries a decision note as a quoted detail', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });
    const adviser = events.find((e) => e.actorLabel === 'Radhika Putrevu');

    expect(adviser?.details).toEqual([
      { kind: 'note', text: 'Family already has the flights.' },
    ]);
  });

  // The register write lands in the same second as the final approval, so it
  // is a payload on that row rather than a row of its own.
  it('hangs the register outcome on the last approval, not a separate event', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 1,
      registerWriteError: null,
    });
    const last = events.find((e) => e.actorLabel === 'Elaine Wee');

    expect(events).toHaveLength(3);
    expect(last?.details).toEqual([
      { kind: 'outcome', text: '1 day marked as excused on the register' },
    ]);
  });

  it('pluralises the register outcome', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Jonah Fernandes, absence 24–26 Aug',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 3,
      registerWriteError: null,
    });
    const last = events.find((e) => e.actorLabel === 'Elaine Wee');

    expect(last?.details?.[0]).toEqual({
      kind: 'outcome',
      text: '3 days marked as excused on the register',
    });
  });

  it('says so plainly when the register write failed', () => {
    const events = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: 'term not found',
    });
    const last = events.find((e) => e.actorLabel === 'Elaine Wee');

    expect(last?.details).toEqual([
      {
        kind: 'outcome',
        text: 'The register could not be marked. An administrator needs to finish this.',
      },
    ]);
  });

  // ⚠ A rejection stops the ladder; later steps stay 'waiting' forever.
  it('emits nothing for steps the ladder never reached', () => {
    const rejected = ladder({
      status: 'rejected',
      stages: [
        {
          stageOrder: 1,
          label: 'Form class adviser',
          resolver: 'form_adviser',
          status: 'approved',
          sectionId: 'sec-1',
          approverPool: [],
          decidedBy: 'u-adviser',
          decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
          decidedAt: '2026-08-20T00:00:00.000Z',
          decisionNote: null,
        },
        {
          stageOrder: 2,
          label: 'Officer in charge',
          resolver: 'named',
          status: 'rejected',
          sectionId: null,
          approverPool: ['u-officer'],
          decidedBy: 'u-officer',
          decidedByEmail: 'elaine.wee@hfse.edu.sg',
          decidedAt: '2026-08-27T08:22:00.000Z',
          decisionNote: 'Please re-send with the medical certificate attached.',
        },
        {
          stageOrder: 3,
          label: 'Principal',
          resolver: 'named',
          status: 'waiting',
          sectionId: null,
          approverPool: ['u-registrar'],
          decidedBy: null,
          decidedByEmail: null,
          decidedAt: null,
          decisionNote: null,
        },
      ],
    });

    const events = buildDeclarationEvents({
      ladder: rejected,
      subjectLabel: 'Idris Rahman, absence 20–21 Aug',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });

    expect(events).toHaveLength(3);
    expect(events.some((e) => e.predicate.includes('Principal'))).toBe(false);
    expect(events.at(-1)?.tone).toBe('turned-down');
  });

  it('never writes a register outcome onto a turned-down filing', () => {
    const rejected = ladder({
      status: 'rejected',
      stages: [
        {
          stageOrder: 1,
          label: 'Form class adviser',
          resolver: 'form_adviser',
          status: 'rejected',
          sectionId: 'sec-1',
          approverPool: [],
          decidedBy: 'u-adviser',
          decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
          decidedAt: '2026-08-20T00:00:00.000Z',
          decisionNote: null,
        },
      ],
    });

    const events = buildDeclarationEvents({
      ladder: rejected,
      subjectLabel: 'Idris Rahman, absence 20–21 Aug',
      nameById: NAMES,
      registerWrittenAt: '2026-08-27T02:01:20.000Z',
      registerDaysWritten: 2,
      registerWriteError: null,
    });

    expect(events.every((e) => e.details === null)).toBe(true);
  });

  it('gives every event a stable id derived from its own identity', () => {
    const input = {
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    };

    expect(buildDeclarationEvents(input).map((e) => e.id)).toEqual(
      buildDeclarationEvents(input).map((e) => e.id)
    );
    expect(buildDeclarationEvents(input).map((e) => e.id)).toEqual([
      'student_declaration:req-1:filed',
      'student_declaration:req-1:step:1',
      'student_declaration:req-1:step:2',
    ]);
  });

  it('links to the filing on the declarations page', () => {
    const [filed] = buildDeclarationEvents({
      ladder: ladder(),
      subjectLabel: 'Amelia Ng, travel 3 Sep',
      nameById: NAMES,
      registerWrittenAt: null,
      registerDaysWritten: null,
      registerWriteError: null,
    });

    expect(filed.href).toBe('/attendance/declarations?req=req-1');
  });
});

describe('buildGradeChangeEvents', () => {
  const base = {
    id: 'gcr-1',
    fieldChanged: 'written_work',
    slotIndex: 3,
    currentValue: '18',
    proposedValue: '21',
    studentLabel: 'Samira Bakhtiari',
    requestedById: 'u-teacher',
    requestedByEmail: 'grace.lim@hfse.edu.sg',
    requestedAt: '2026-08-27T00:47:00.000Z',
    status: 'applied',
    reviewedById: 'u-officer',
    reviewedByEmail: 'elaine.wee@hfse.edu.sg',
    reviewedAt: '2026-08-27T02:00:00.000Z',
    decisionNote: null,
    appliedById: 'u-registrar',
    appliedAt: '2026-08-27T03:05:00.000Z',
    nameById: NAMES,
    href: '/markbook/change-requests?req=gcr-1',
  };

  it('says "You" when the viewer is the one who asked', () => {
    const [asked] = buildGradeChangeEvents({ ...base, viewerId: 'u-teacher' });

    expect(asked.actorLabel).toBe('You');
    expect(asked.predicate).toBe(
      'asked to change Written Work 3 for Samira Bakhtiari.'
    );
  });

  it('names the teacher when the viewer is somebody else', () => {
    const [asked] = buildGradeChangeEvents({ ...base, viewerId: 'u-officer' });

    expect(asked.actorLabel).toBe('Grace Lim');
  });

  it('emits asked, reviewed and applied, in that order', () => {
    const events = buildGradeChangeEvents({ ...base, viewerId: 'u-officer' });

    expect(events.map((e) => e.id)).toEqual([
      'grade_change:gcr-1:requested',
      'grade_change:gcr-1:reviewed',
      'grade_change:gcr-1:applied',
    ]);
    expect(events.at(-1)?.details).toEqual([
      { kind: 'outcome', text: 'Written Work 3 · 18 → 21' },
    ]);
  });

  it('stops at asked while the request is still pending', () => {
    const events = buildGradeChangeEvents({
      ...base,
      viewerId: 'u-officer',
      status: 'pending',
      reviewedAt: null,
      reviewedByEmail: null,
      reviewedById: null,
      appliedAt: null,
      appliedById: null,
    });

    expect(events).toHaveLength(1);
  });

  it('marks a rejection as turned down and carries its reason', () => {
    const events = buildGradeChangeEvents({
      ...base,
      viewerId: 'u-officer',
      status: 'rejected',
      decisionNote: 'The original mark is correct.',
      appliedAt: null,
      appliedById: null,
    });

    expect(events.at(-1)?.tone).toBe('turned-down');
    expect(events.at(-1)?.details).toEqual([
      { kind: 'note', text: 'The original mark is correct.' },
    ]);
  });
});

describe('sortEventsNewestFirst', () => {
  it('sorts by time descending and breaks ties on id', () => {
    const at = '2026-08-27T02:00:00.000Z';
    const mk = (id: string, t: string): ActivityEvent => ({
      id,
      flow: 'student_declaration',
      requestId: id,
      at: t,
      tone: 'started',
      actorLabel: 'Someone',
      actorInitials: '—',
      predicate: 'did something.',
      details: null,
      href: '/attendance/declarations',
    });

    const sorted = sortEventsNewestFirst([
      mk('b', at),
      mk('a', at),
      mk('c', '2026-08-28T00:00:00.000Z'),
    ]);

    expect(sorted.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});
