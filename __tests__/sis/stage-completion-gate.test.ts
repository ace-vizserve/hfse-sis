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
// edit dialog agree, the same way admissions-stage-freeze.test.ts is for
// isAdmissionsStageFrozen.

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

    it('Paid needs both', () => {
      expect(blockedKeys('fees', 'Paid', { invoice: 'INV-9' })).toEqual([
        'paymentDate',
      ]);
      expect(
        blockedKeys('fees', 'Paid', { paymentDate: '2026-08-01' })
      ).toEqual(['invoice']);
      expect(
        findStageCompletionBlockers('fees', 'Paid', {
          invoice: 'INV-9',
          paymentDate: '2026-08-01',
        })
      ).toEqual([]);
    });

    // feeStartDate is an extra on the stage but no status requires it.
    it('never asks for the fee start date', () => {
      for (const status of STAGE_STATUS_OPTIONS.fees) {
        expect(blockedKeys('fees', status, {})).not.toContain('startDate');
      }
    });
  });

  describe('assessment — Finished needs both grades', () => {
    it('passes when both grades are in', () => {
      expect(
        findStageCompletionBlockers('assessment', 'Finished', {
          math: 'B',
          english: 'A',
        })
      ).toEqual([]);
    });

    it('blocks on a blank Math grade, naming it', () => {
      expect(
        findStageCompletionBlockers('assessment', 'Finished', { english: 'A' })
      ).toEqual([{ fieldKey: 'math', label: 'Math grade' }]);
    });

    it('blocks on a blank English grade, naming it', () => {
      expect(
        findStageCompletionBlockers('assessment', 'Finished', { math: 'B' })
      ).toEqual([{ fieldKey: 'english', label: 'English grade' }]);
    });

    // The schedule and medical extras exist on the stage but are not gated.
    it('never asks for the schedule or the medical note', () => {
      const keys = blockedKeys('assessment', 'Finished', {});
      expect(keys).toEqual(['math', 'english']);
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
      expect(
        findStageCompletionBlockers('assessment', 'Ongoing Assessment', {})
      ).toEqual([]);
      expect(findStageCompletionBlockers('fees', 'Cancelled', {})).toEqual([]);
    });

    it('lets a free-text "Other…" status through — we only know the canonical ones', () => {
      expect(
        findStageCompletionBlockers('registration', 'Waiting on the bank', {})
      ).toEqual([]);
      expect(findStageCompletionBlockers('fees', 'Other…', {})).toEqual([]);
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

    // These three carry no extras at all, so there is nothing to require.
    // `documents` only becomes enforceable once the P-Files slots work lands.
    it('never blocks documents, contract or orientation', () => {
      for (const stage of ['documents', 'contract', 'orientation'] as const) {
        for (const status of STAGE_STATUS_OPTIONS[stage]) {
          expect(findStageCompletionBlockers(stage, status, {})).toEqual([]);
        }
        expect(STAGE_STATUS_REQUIRED_FIELDS[stage]).toBeUndefined();
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
