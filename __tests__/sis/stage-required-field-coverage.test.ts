import { describe, expect, it } from 'vitest';

import {
  findStageCompletionBlockers,
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_STATUS_OPTIONS,
  STAGE_STATUS_REQUIRED_FIELDS,
  STATUS_OPTIONAL_STAGES,
  type StageKey,
} from '@/lib/schemas/sis';

// Three stages had fields that no status ever required, so a record could
// reach a finished-looking status with the field behind it blank. Closed
// 2026-09-12 at Mr Ace's request: "fix orientation, assessment and fees gaps".
//
// Each rule below was chosen against production counts, not taste — the
// requirement is enforced on EVERY save, so a rule whose field is mostly
// missing does not clear a backlog, it freezes the stage.

describe('the gaps that were closed', () => {
  it('orientation requires its schedule date once it is Finished', () => {
    expect(
      findStageCompletionBlockers('orientation', 'Finished', {
        scheduleDate: null,
      }).map((b) => b.fieldKey)
    ).toEqual(['scheduleDate']);
  });

  it('orientation still lets Pending stand without a date', () => {
    // an orientation that has not happened yet may genuinely have no date
    expect(
      findStageCompletionBlockers('orientation', 'Pending', {
        scheduleDate: null,
      })
    ).toEqual([]);
  });

  it('assessment requires the sitting date once it is under way or done', () => {
    expect(
      findStageCompletionBlockers('assessment', 'Ongoing Assessment', {
        schedule: null,
      }).map((b) => b.fieldKey)
    ).toEqual(['schedule']);

    expect(
      findStageCompletionBlockers('assessment', 'Finished', {
        schedule: null,
        math: 'A',
        english: 'B',
      }).map((b) => b.fieldKey)
    ).toEqual(['schedule']);
  });

  it('assessment keeps demanding both grades at Finished', () => {
    expect(
      findStageCompletionBlockers('assessment', 'Finished', {
        schedule: '2026-05-01',
        math: null,
        english: null,
      }).map((b) => b.fieldKey)
    ).toEqual(['math', 'english']);
  });

  it('assessment does NOT require Medical — the school does not collect it', () => {
    // Filled on 4 of 495 records, missing on 83 of the 87 at Finished.
    // Requiring it would freeze the stage for almost everyone. This test
    // exists so adding it later is a decision, not an accident.
    const blockers = findStageCompletionBlockers('assessment', 'Finished', {
      schedule: '2026-05-01',
      math: 'A',
      english: 'B',
      medical: null,
    });
    expect(blockers).toEqual([]);
  });

  it('fees requires the start date once it is Paid', () => {
    expect(
      findStageCompletionBlockers('fees', 'Paid', {
        invoice: 'HFSE1',
        paymentDate: '2026-01-01',
        startDate: null,
      }).map((b) => b.fieldKey)
    ).toEqual(['startDate']);
  });

  it('fees leaves Invoiced alone — only an invoice number is due then', () => {
    expect(
      findStageCompletionBlockers('fees', 'Invoiced', {
        invoice: 'HFSE1',
        paymentDate: null,
        startDate: null,
      })
    ).toEqual([]);
  });
});

describe('every rule points at a field that exists', () => {
  it.each(STAGE_KEYS)('%s', (stageKey) => {
    const byStatus = STAGE_STATUS_REQUIRED_FIELDS[stageKey] ?? {};
    const known = new Set(
      (STAGE_COLUMN_MAP[stageKey]?.extras ?? []).map((e) => e.fieldKey)
    );
    for (const [status, fields] of Object.entries(byStatus)) {
      for (const f of fields) {
        expect(
          known.has(f),
          `${stageKey}/${status} requires "${f}", which is not a field on that stage`
        ).toBe(true);
      }
      // a rule keyed on a status nobody can pick is dead weight
      const options = STAGE_STATUS_OPTIONS[stageKey] ?? [];
      expect(
        options.includes(status),
        `${stageKey} has a rule for "${status}", which is not one of its statuses`
      ).toBe(true);
    }
  });
});

describe('which stages still have an unenforced field', () => {
  // Not a failure — a ledger. When a stage carries a field no status ever
  // asks for, it should be because somebody decided that, and this test is
  // where the decision is written down.
  const EXPECTED_UNENFORCED: Record<string, string[]> = {
    // the terminal-reason path demands notes through validateTerminalReason
    // instead, which additionally checks the reason is a known value
    application: ['terminalNotes'],
    assessment: ['medical'],
    // `class` has no dialog at all, so nothing can be enforced on it
    class: ['classAY', 'classLevel', 'classSection'],
  };

  it('matches what we have decided to leave alone', () => {
    const actual: Record<string, string[]> = {};
    for (const stageKey of STAGE_KEYS) {
      const extras = STAGE_COLUMN_MAP[stageKey]?.extras ?? [];
      if (extras.length === 0) continue;
      const byStatus = STAGE_STATUS_REQUIRED_FIELDS[stageKey] ?? {};
      const covered = new Set(Object.values(byStatus).flat());
      const uncovered = extras
        .map((e) => e.fieldKey)
        .filter((k) => !covered.has(k));
      if (uncovered.length) actual[stageKey] = uncovered;
    }
    expect(actual).toEqual(EXPECTED_UNENFORCED);
  });

  it('class is the only stage exempt from needing a status', () => {
    expect([...STATUS_OPTIONAL_STAGES]).toEqual(['class' as StageKey]);
  });
});
