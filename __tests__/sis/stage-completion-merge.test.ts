import { describe, expect, it } from 'vitest';

import {
  STAGE_COLUMN_MAP,
  findStageCompletionBlockers,
  stageCompletionMessage,
} from '@/lib/schemas/sis';
import { resolveEffectiveStageValues } from '@/lib/sis/stage-completion';

// Phase 2 of the stage completion gate: the stage PATCH route enforces
// STAGE_STATUS_REQUIRED_FIELDS on the row as it will stand AFTER the save.
// Phase 1's test (stage-completion-gate.test.ts) covers the RULES; this one
// covers the MERGE that feeds them, which is the logic Phase 2 added.
//
// The merge is what makes the feature what the school asked for: the gate
// judges the record, not the keystroke. A Remarks-only edit on a record whose
// invoice was never filled in is refused — deliberately.

const registration = STAGE_COLUMN_MAP.registration;
const fees = STAGE_COLUMN_MAP.fees;

/** A registration row as it sits in ay{YYYY}_enrolment_status, keyed by the
 *  real database column names. */
function storedRegistration(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    registrationStatus: 'Finished',
    registrationRemarks: 'was fine',
    registrationInvoice: 'INV-001',
    registrationPaymentDate: '2026-08-01',
    ...overrides,
  };
}

describe('resolveEffectiveStageValues — the payload merged over the stored row', () => {
  it('takes the payload value when a key is supplied', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration(),
      'Finished',
      { invoice: 'INV-999' }
    );
    expect(result.extras.invoice).toBe('INV-999');
  });

  it('falls back to the stored value when a key is omitted', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration(),
      'Finished',
      { invoice: 'INV-999' }
    );
    // paymentDate was never mentioned by the payload.
    expect(result.extras.paymentDate).toBe('2026-08-01');
  });

  it('falls back to the stored value for every key when extras is absent', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration(),
      'Finished',
      undefined
    );
    expect(result.extras).toEqual({
      invoice: 'INV-001',
      paymentDate: '2026-08-01',
    });
  });

  it('treats an explicit empty string as blank, beating a filled stored value', () => {
    // Clearing a required field has to be REFUSED, not silently ignored —
    // the route writes '' as null, so the gate must read it that way too.
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration(),
      'Finished',
      { invoice: '' }
    );
    expect(result.extras.invoice).toBeNull();
  });

  it('treats an explicit null the same way', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration(),
      'Finished',
      { invoice: null }
    );
    expect(result.extras.invoice).toBeNull();
  });

  it('treats a whitespace-only value as blank', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration(),
      'Finished',
      { invoice: '   ' }
    );
    expect(result.extras.invoice).toBeNull();
  });

  it('reads a blank stored value as blank', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration({ registrationInvoice: '' }),
      'Finished',
      undefined
    );
    expect(result.extras.invoice).toBeNull();
  });

  it('only ever returns the fieldKeys this stage declares', () => {
    const result = resolveEffectiveStageValues(
      registration,
      storedRegistration({ feeInvoice: 'INV-FEES' }),
      'Finished',
      undefined
    );
    expect(Object.keys(result.extras).sort()).toEqual([
      'invoice',
      'paymentDate',
    ]);
  });

  describe('status', () => {
    it('takes the payload status over the stored one', () => {
      const result = resolveEffectiveStageValues(
        registration,
        storedRegistration({ registrationStatus: 'Ongoing' }),
        'Finished',
        undefined
      );
      expect(result.status).toBe('Finished');
    });

    it('falls back to the stored status when none is supplied', () => {
      const result = resolveEffectiveStageValues(
        registration,
        storedRegistration({ registrationStatus: 'Finished' }),
        undefined,
        undefined
      );
      expect(result.status).toBe('Finished');
    });

    it('reads a cleared status as blank', () => {
      const result = resolveEffectiveStageValues(
        registration,
        storedRegistration(),
        null,
        undefined
      );
      expect(result.status).toBeNull();
    });
  });
});

describe('the merged row is what the gate judges', () => {
  /** What the route does: merge, then ask for blockers. */
  function blockersFor(
    cols: typeof registration,
    stage: 'registration' | 'fees',
    stored: Record<string, unknown>,
    payloadStatus: string | null | undefined,
    payloadExtras: Record<string, string | null> | undefined
  ) {
    const effective = resolveEffectiveStageValues(
      cols,
      stored,
      payloadStatus,
      payloadExtras
    );
    return findStageCompletionBlockers(stage, effective.status, {
      ...effective.extras,
    });
  }

  it('lets a Remarks-only edit through on a record that is already complete', () => {
    // The stored values satisfy a rule the payload never mentions.
    expect(
      blockersFor(
        registration,
        'registration',
        storedRegistration(),
        'Finished',
        undefined
      )
    ).toEqual([]);
  });

  it('REFUSES a Remarks-only edit when the stored invoice is blank', () => {
    // The headline case. The record is incomplete, so it is refused even
    // though this edit never touched the invoice — that is the feature.
    const blockers = blockersFor(
      registration,
      'registration',
      storedRegistration({ registrationInvoice: null }),
      'Finished',
      undefined
    );
    expect(blockers).toEqual([{ fieldKey: 'invoice', label: 'Invoice' }]);
    expect(stageCompletionMessage('registration', 'Finished', blockers)).toBe(
      'Registration is set to Finished, so Invoice has to be filled in first.'
    );
  });

  it('REFUSES an edit that clears a required field, even though the stored value was fine', () => {
    const blockers = blockersFor(
      registration,
      'registration',
      storedRegistration(),
      'Finished',
      { invoice: '' }
    );
    expect(blockers).toEqual([{ fieldKey: 'invoice', label: 'Invoice' }]);
  });

  it('lets the edit through when the payload supplies what the stored row was missing', () => {
    expect(
      blockersFor(
        registration,
        'registration',
        storedRegistration({ registrationInvoice: null }),
        'Finished',
        { invoice: 'INV-002' }
      )
    ).toEqual([]);
  });

  it('names both missing fields when the payload moves fees to Paid on an empty row', () => {
    const blockers = blockersFor(
      fees,
      'fees',
      { feeStatus: 'Invoiced', feeInvoice: null, feePaymentDate: null },
      'Paid',
      undefined
    );
    expect(blockers.map((b) => b.fieldKey)).toEqual(['invoice', 'paymentDate']);
    expect(stageCompletionMessage('fees', 'Paid', blockers)).toBe(
      'Fees is set to Paid, so Invoice and Payment date have to be filled in first.'
    );
  });

  it('does not gate a status that carries no rule, however blank the row is', () => {
    expect(
      blockersFor(
        fees,
        'fees',
        { feeStatus: 'Pending', feeInvoice: null, feePaymentDate: null },
        'Pending',
        undefined
      )
    ).toEqual([]);
  });

  it('uses the STORED status when the payload does not move it — the backlog case', () => {
    // A record parked at Paid with nothing behind it: touching anything at
    // all now has to complete it.
    const blockers = blockersFor(
      fees,
      'fees',
      { feeStatus: 'Paid', feeInvoice: 'INV-7', feePaymentDate: null },
      undefined,
      undefined
    );
    expect(blockers).toEqual([
      { fieldKey: 'paymentDate', label: 'Payment date' },
    ]);
  });
});
