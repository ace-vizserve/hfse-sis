import { describe, expect, it } from 'vitest';

import {
  STAGE_COLUMN_MAP,
  STAGE_STATUS_OPTIONS,
  STAGE_STATUS_REQUIRED_FIELDS,
  findStageCompletionBlockers,
  stageCompletionMessage,
  type StageKey,
} from '@/lib/schemas/sis';

// Action item #1 from admin training session #1 (Wynne, @24:43): a stage can
// be marked finished while the data behind it is still blank. The rules key on
// (stage, STATUS), not on stage alone — "the required fields are depending on
// the status selected" — and they are checked on EVERY save against the row as
// it will stand afterwards, which is what clears the existing backlog of blank
// fields as records get touched.
//
// This pure test is the single guarantee the stage PATCH route and the stage
// edit dialog agree about what "finished" requires.
//
// It is unrelated to the post-enrolment stage FREEZE, which was a different
// rule and was removed on 2026-09-10 — see
// __tests__/sis/enrolled-record-stays-editable.test.ts.

/** Shorthand: the fieldKeys still blocking, in order. */
function blockedKeys(
  stage: StageKey,
  status: string | null | undefined,
  extras: Record<string, string | null | undefined>
): string[] {
  return findStageCompletionBlockers(stage, status, extras).map(
    (b) => b.fieldKey
  );
}

describe('findStageCompletionBlockers', () => {
  describe('registration — Finished needs the invoice and the payment date', () => {
    const ok = { invoice: 'INV-001', paymentDate: '2026-08-01' };

    it('passes when both are filled in', () => {
      expect(
        findStageCompletionBlockers('registration', 'Finished', ok)
      ).toEqual([]);
    });

    it('blocks on a blank invoice, naming it', () => {
      const result = findStageCompletionBlockers('registration', 'Finished', {
        ...ok,
        invoice: '',
      });
      expect(result).toEqual([{ fieldKey: 'invoice', label: 'Invoice' }]);
    });

    it('blocks on a blank payment date, naming it', () => {
      const result = findStageCompletionBlockers('registration', 'Finished', {
        ...ok,
        paymentDate: null,
      });
      expect(result).toEqual([
        { fieldKey: 'paymentDate', label: 'Payment date' },
      ]);
    });

    it('lists both, in the order the rule declares them', () => {
      expect(blockedKeys('registration', 'Finished', {})).toEqual([
        'invoice',
        'paymentDate',
      ]);
    });
  });

  describe('fees — Invoiced/Re-invoiced need only the invoice, Paid needs both', () => {
    it('Invoiced does not ask for a payment date', () => {
      expect(
        findStageCompletionBlockers('fees', 'Invoiced', { invoice: 'INV-9' })
      ).toEqual([]);
    });

    it('Re-invoiced does not ask for a payment date either', () => {
      expect(
        findStageCompletionBlockers('fees', 'Re-invoiced', { invoice: 'INV-9' })
      ).toEqual([]);
    });

    it('Invoiced blocks on a blank invoice', () => {
      expect(
        blockedKeys('fees', 'Invoiced', { paymentDate: '2026-08-01' })
      ).toEqual(['invoice']);
    });

    it('Re-invoiced blocks on a blank invoice', () => {
      expect(blockedKeys('fees', 'Re-invoiced', {})).toEqual(['invoice']);
    });

    it('Paid needs all three', () => {
      expect(
        blockedKeys('fees', 'Paid', {
          invoice: 'INV-9',
          startDate: '2026-08-01',
        })
      ).toEqual(['paymentDate']);
      expect(
        blockedKeys('fees', 'Paid', {
          paymentDate: '2026-08-01',
          startDate: '2026-08-01',
        })
      ).toEqual(['invoice']);
      expect(
        findStageCompletionBlockers('fees', 'Paid', {
          invoice: 'INV-9',
          paymentDate: '2026-08-01',
          startDate: '2026-08-01',
        })
      ).toEqual([]);
    });

    // `startDate` became required at Paid on 2026-09-12, closing a gap Mr Ace
    // asked about. Only Paid — an invoice that has been sent has no start date
    // yet. Cost when it shipped: 2 of the 425 records already at Paid.
    it('asks for the start date at Paid, and only at Paid', () => {
      expect(blockedKeys('fees', 'Paid', {})).toContain('startDate');
      for (const status of STAGE_STATUS_OPTIONS.fees) {
        if (status === 'Paid') continue;
        expect(blockedKeys('fees', status, {})).not.toContain('startDate');
      }
    });
  });

  describe('assessment — the sitting date, then both grades', () => {
    const sat = { schedule: '2026-05-01' };

    it('passes when the date and both grades are in', () => {
      expect(
        findStageCompletionBlockers('assessment', 'Finished', {
          ...sat,
          math: 'B',
          english: 'A',
        })
      ).toEqual([]);
    });

    it('blocks on a blank Math grade, naming it', () => {
      expect(
        findStageCompletionBlockers('assessment', 'Finished', {
          ...sat,
          english: 'A',
        })
      ).toEqual([{ fieldKey: 'math', label: 'Math grade' }]);
    });

    it('blocks on a blank English grade, naming it', () => {
      expect(
        findStageCompletionBlockers('assessment', 'Finished', {
          ...sat,
          math: 'B',
        })
      ).toEqual([{ fieldKey: 'english', label: 'English grade' }]);
    });

    // `schedule` became required on 2026-09-12: a sitting cannot be under way
    // or finished without a date it was held on. Cost when it shipped: 4 of
    // the 87 records already at Finished.
    it('asks for the sitting date once it is under way or done', () => {
      expect(blockedKeys('assessment', 'Ongoing Assessment', {})).toEqual([
        'schedule',
      ]);
      expect(blockedKeys('assessment', 'Finished', {})).toEqual([
        'schedule',
        'math',
        'english',
      ]);
    });

    // Medical stays ungated ON PURPOSE — filled on 4 of 495 records, missing
    // on 83 of the 87 at Finished. Requiring it would freeze the stage for
    // nearly everyone who has finished a sitting.
    it('never asks for the medical note', () => {
      for (const status of STAGE_STATUS_OPTIONS.assessment) {
        expect(blockedKeys('assessment', status, {})).not.toContain('medical');
      }
    });
  });

  describe('supplies — Claimed needs the claimed date', () => {
    it('passes when the date is in', () => {
      expect(
        findStageCompletionBlockers('supplies', 'Claimed', {
          claimedDate: '2026-08-01',
        })
      ).toEqual([]);
    });

    it('blocks on a blank claimed date, naming it', () => {
      expect(findStageCompletionBlockers('supplies', 'Claimed', {})).toEqual([
        { fieldKey: 'claimedDate', label: 'Claimed date' },
      ]);
    });
  });

  describe('application — Cancelled/Withdrawn need a reason', () => {
    it('passes when the reason is in', () => {
      for (const status of ['Cancelled', 'Withdrawn']) {
        expect(
          findStageCompletionBlockers('application', status, {
            terminalReason: 'financial',
          })
        ).toEqual([]);
      }
    });

    it('blocks on a blank reason, naming it', () => {
      for (const status of ['Cancelled', 'Withdrawn']) {
        expect(findStageCompletionBlockers('application', status, {})).toEqual([
          { fieldKey: 'terminalReason', label: 'Reason' },
        ]);
      }
    });

    // validateTerminalReason is the stricter gate (known enum value, and notes
    // when the reason is 'other'). This map only states presence, so the UI can
    // read one source for "what does this status require".
    it('never asks for the terminal notes', () => {
      expect(
        blockedKeys('application', 'Cancelled', { terminalReason: 'other' })
      ).toEqual([]);
    });
  });

  describe('what is NOT gated', () => {
    it('treats a whitespace-only value as missing', () => {
      expect(
        blockedKeys('registration', 'Finished', {
          invoice: '   ',
          paymentDate: '\t\n ',
        })
      ).toEqual(['invoice', 'paymentDate']);
    });

    it('lets a status with no rule through', () => {
      expect(
        findStageCompletionBlockers('registration', 'Pending', {})
      ).toEqual([]);
      expect(findStageCompletionBlockers('supplies', 'Pending', {})).toEqual(
        []
      );
      expect(findStageCompletionBlockers('fees', 'Cancelled', {})).toEqual([]);
    });

    it('lets a free-text "Other…" status through — we only know the canonical ones', () => {
      expect(
        findStageCompletionBlockers('registration', 'Waiting on the bank', {})
      ).toEqual([]);
      expect(findStageCompletionBlockers('fees', 'Other…', {})).toEqual([]);
    });

    // The status is free text, so a person can type anything into the
    // "Other…" box — including a word that happens to name something every
    // JavaScript object inherits. Indexing the rules map without an own-property
    // guard resolves those to functions, and the blocker loop then throws on a
    // value that is not iterable: the dialog crashes mid-render and the save
    // 500s. This function promises never to throw, so it must answer "nothing
    // is gated" for all of them.
    it('treats an inherited object member typed as a status as ungated', () => {
      for (const status of [
        'constructor',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toString',
        'valueOf',
        '__proto__',
      ]) {
        for (const stage of ['registration', 'fees', 'application'] as const) {
          expect(() =>
            findStageCompletionBlockers(stage, status, {})
          ).not.toThrow();
          expect(
            findStageCompletionBlockers(stage, status, {}),
            `${stage}/${status}`
          ).toEqual([]);
        }
      }
    });

    it('lets a blank or missing status through', () => {
      for (const status of [null, undefined, '', '   ']) {
        expect(findStageCompletionBlockers('registration', status, {})).toEqual(
          []
        );
        expect(findStageCompletionBlockers('fees', status, {})).toEqual([]);
      }
    });

    // DELIBERATE, and it must stay this way. The class stage has no edit
    // dialog, so no human could ever satisfy a rule on it; its columns are
    // written by the Enrolled flip and the assign-section route. Enforcing
    // classAY / classLevel / classSection against write paths that never set
    // them would risk breaking section assignment in order to fix a blank
    // field. Nobody should "complete" the map by adding a class rule.
    it('never blocks the class stage, at any of its statuses', () => {
      for (const status of STAGE_STATUS_OPTIONS.class) {
        expect(findStageCompletionBlockers('class', status, {})).toEqual([]);
      }
      expect(STAGE_STATUS_REQUIRED_FIELDS.class).toBeUndefined();
    });

    // These two carry no extras at all, so there is nothing to require.
    // `documents` only becomes enforceable once the P-Files slots work lands.
    //
    // ⚠ `orientation` used to be named here, and in the source comment beside
    // STAGE_STATUS_REQUIRED_FIELDS, as a stage with no extras. That was wrong
    // — it has always had a Schedule date — and the wrong sentence is why it
    // went unenforced for so long. It has a rule now; see below.
    it('never blocks documents or contract', () => {
      for (const stage of ['documents', 'contract'] as const) {
        for (const status of STAGE_STATUS_OPTIONS[stage]) {
          expect(findStageCompletionBlockers(stage, status, {})).toEqual([]);
        }
        expect(STAGE_STATUS_REQUIRED_FIELDS[stage]).toBeUndefined();
      }
    });

    it('blocks orientation at Finished, and nowhere else', () => {
      expect(blockedKeys('orientation', 'Finished', {})).toEqual([
        'scheduleDate',
      ]);
      for (const status of STAGE_STATUS_OPTIONS.orientation) {
        if (status === 'Finished') continue;
        expect(findStageCompletionBlockers('orientation', status, {})).toEqual(
          []
        );
      }
    });
  });

  // The merge is the CALLER's job — the route merges the incoming payload over
  // the stored row and passes the result in. This function reads nothing else,
  // so a value that was already on the record satisfies the rule even when the
  // save itself carries no extras at all (a Remarks-only edit on a complete
  // record).
  it('reads effectiveExtras only — a stored value already satisfies the rule', () => {
    expect(
      findStageCompletionBlockers('registration', 'Finished', {
        invoice: 'INV-001',
        paymentDate: '2026-08-01',
      })
    ).toEqual([]);
  });

  it('never throws on odd input', () => {
    expect(() =>
      findStageCompletionBlockers('fees', 'Paid', {
        invoice: undefined,
        paymentDate: null,
      })
    ).not.toThrow();
  });
});

describe('stageCompletionMessage', () => {
  it('words a single missing field', () => {
    const blockers = findStageCompletionBlockers('assessment', 'Finished', {
      schedule: '2026-05-01',
      english: 'A',
    });
    expect(stageCompletionMessage('assessment', 'Finished', blockers)).toBe(
      'Assessment is set to Finished, so Math grade has to be filled in first.'
    );
  });

  it('words two missing fields', () => {
    const blockers = findStageCompletionBlockers(
      'registration',
      'Finished',
      {}
    );
    expect(stageCompletionMessage('registration', 'Finished', blockers)).toBe(
      'Registration is set to Finished, so Invoice and Payment date have to be filled in first.'
    );
  });

  it('comma-lists three or more, with "and" before the last', () => {
    expect(
      stageCompletionMessage('fees', 'Paid', [
        { fieldKey: 'invoice', label: 'Invoice' },
        { fieldKey: 'paymentDate', label: 'Payment date' },
        { fieldKey: 'startDate', label: 'Start date' },
      ])
    ).toBe(
      'Fees is set to Paid, so Invoice, Payment date and Start date have to be filled in first.'
    );
  });

  it('says nothing when nothing is missing', () => {
    expect(stageCompletionMessage('fees', 'Paid', [])).toBe('');
  });
});

// The typo guard. Iterates the map rather than hardcoding, so a future rule
// naming a field or a status that does not exist fails here instead of
// silently never firing in production.
describe('STAGE_STATUS_REQUIRED_FIELDS is consistent with the stage vocabulary', () => {
  const entries = Object.entries(STAGE_STATUS_REQUIRED_FIELDS) as Array<
    [StageKey, Record<string, readonly string[]>]
  >;

  it('has rules to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('names only statuses that exist in STAGE_STATUS_OPTIONS for that stage', () => {
    for (const [stage, byStatus] of entries) {
      for (const status of Object.keys(byStatus)) {
        expect(
          STAGE_STATUS_OPTIONS[stage],
          `${stage} has no status "${status}"`
        ).toContain(status);
      }
    }
  });

  it('names only fieldKeys that exist in STAGE_COLUMN_MAP extras for that stage', () => {
    for (const [stage, byStatus] of entries) {
      const known = STAGE_COLUMN_MAP[stage].extras.map((e) => e.fieldKey);
      for (const [status, fieldKeys] of Object.entries(byStatus)) {
        expect(
          fieldKeys.length,
          `${stage}/${status} has no fields`
        ).toBeGreaterThan(0);
        for (const fieldKey of fieldKeys) {
          expect(
            known,
            `${stage}/${status} names unknown field "${fieldKey}"`
          ).toContain(fieldKey);
        }
      }
    }
  });

  it('gives every named field a real label, never a raw key fallback', () => {
    for (const [stage, byStatus] of entries) {
      for (const [status, fieldKeys] of Object.entries(byStatus)) {
        const blockers = findStageCompletionBlockers(stage, status, {});
        expect(blockers.map((b) => b.fieldKey)).toEqual([...fieldKeys]);
        for (const b of blockers) {
          expect(b.label, `${stage}/${status}/${b.fieldKey}`).not.toBe(
            b.fieldKey
          );
        }
      }
    }
  });
});
