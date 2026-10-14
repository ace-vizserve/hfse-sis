import { describe, expect, it } from 'vitest';

import { handledFields } from '@/lib/qbo/sync-fields';

const base = { state: 'paid', paymentDate: '2026-10-01', docNumber: '1042' };

describe('handledFields', () => {
  it('saves nothing when the stage write failed', () => {
    expect(handledFields({ ...base, stageInStep: false })).toEqual({});
  });
  it('saves state, payment date and number once the stage is in step', () => {
    expect(handledFields({ ...base, stageInStep: true })).toEqual({
      state: 'paid',
      payment_date: '2026-10-01',
      doc_number: '1042',
    });
  });
});
