import { describe, expect, it } from 'vitest';

import {
  stageFromInvoices,
  tileNeedsStartDate,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import type { StageSnapshot } from '@/lib/qbo/stage-state';

const TODAY = '2026-10-21';

const snap = (s: Partial<StageSnapshot> = {}): StageSnapshot => ({
  status: 'Ready for invoicing',
  invoice: null,
  paymentDate: null,
  startDate: null,
  ...s,
});
const inv = (
  docNumber: string | null,
  txnDate: string,
  state: TileInvoice['state'],
  more: Partial<TileInvoice> = {}
): TileInvoice => ({
  docNumber,
  txnDate,
  state,
  dueDate: null,
  paymentDate: null,
  total: 100,
  balance: state === 'open' ? 100 : 0,
  ...more,
});
const run = (
  stage: 'registration' | 'fees',
  invoices: TileInvoice[],
  current: StageSnapshot = snap()
) => stageFromInvoices(stage, invoices, current, TODAY);

describe('stageFromInvoices — nothing tied', () => {
  it('no tied invoice: the stage is left alone, whatever it holds', () => {
    expect(run('registration', [])).toBeNull();
    expect(
      run(
        'fees',
        [],
        snap({ status: 'Paid', invoice: 'HFSE1', paymentDate: '2026-07-15' })
      )
    ).toBeNull();
  });
  it('Cancelled is never overwritten', () => {
    expect(
      run(
        'fees',
        [inv('HFSE1', '2026-09-01', 'open')],
        snap({ status: 'Cancelled' })
      )
    ).toBeNull();
    expect(
      run(
        'registration',
        [inv('HFSE1', '2026-09-01', 'paid', { paymentDate: '2026-09-02' })],
        snap({ status: ' Cancelled ' })
      )
    ).toBeNull();
  });
});

describe('stageFromInvoices — open invoices', () => {
  it('one open invoice: Unpaid + number, payment date cleared', () => {
    expect(
      run(
        'registration',
        [inv('HFSE062301', '2026-09-01', 'open')],
        snap({ paymentDate: '2026-01-01' })
      )
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE062301', paymentDate: null });
  });
  it('part paid: Partially paid', () => {
    expect(
      run('fees', [inv('HFSE1', '2026-09-01', 'open', { balance: 40 })])
    ).toEqual({ status: 'Partially paid', invoice: 'HFSE1' });
  });
  it('open past its due date: Overdue (beats part paid)', () => {
    expect(
      run('fees', [
        inv('HFSE1', '2026-09-01', 'open', {
          balance: 40,
          dueDate: '2026-10-20',
        }),
      ])
    ).toEqual({ status: 'Overdue', invoice: 'HFSE1' });
  });
  it('due today is not overdue yet', () => {
    expect(
      run('fees', [inv('HFSE1', '2026-09-01', 'open', { dueDate: TODAY })])
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE1' });
  });
  it('a paid invoice past due does not make the stage overdue', () => {
    expect(
      run('fees', [
        inv('HFSE1', '2026-08-01', 'paid', {
          dueDate: '2026-08-15',
          paymentDate: '2026-08-10',
        }),
        inv('HFSE2', '2026-09-01', 'open', { dueDate: '2026-12-01' }),
      ])
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE2' });
  });
  it('several tied: the newest live number leads; any open → not Paid', () => {
    expect(
      run('registration', [
        inv('HFSE10', '2026-09-01', 'open'),
        inv('HFSE9', '2026-09-01', 'paid', { paymentDate: '2026-09-02' }),
        inv('HFSE20', '2026-10-01', 'voided'),
      ])
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE10' });
  });
  it('no change from the stage: null', () => {
    expect(
      run(
        'registration',
        [inv('HFSE1', '2026-09-01', 'open')],
        snap({ status: 'Unpaid', invoice: ' HFSE1 ' })
      )
    ).toBeNull();
  });
  it('an invoice with no number is skipped for the number', () => {
    expect(run('fees', [inv(null, '2026-09-01', 'open')])).toBeNull();
  });
});

describe('stageFromInvoices — all paid', () => {
  it('Registration: Paid + latest payment date', () => {
    expect(
      run('registration', [
        inv('HFSE1', '2026-08-01', 'paid', { paymentDate: '2026-08-03' }),
        inv('HFSE2', '2026-09-01', 'paid', { paymentDate: '2026-09-05' }),
      ])
    ).toEqual({ status: 'Paid', invoice: 'HFSE2', paymentDate: '2026-09-05' });
  });
  it('Fees with a start date: Paid', () => {
    expect(
      run(
        'fees',
        [inv('HFSE1', '2026-08-01', 'paid', { paymentDate: '2026-08-03' })],
        snap({ status: 'Unpaid', invoice: 'HFSE1', startDate: '2026-08-10' })
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-08-03' });
  });
  it('Fees without a start date: number + payment date, status left', () => {
    const invoices = [
      inv('HFSE1', '2026-08-01', 'paid', { paymentDate: '2026-08-03' }),
    ];
    const current = snap({ status: 'Unpaid', invoice: 'HFSE1' });
    expect(run('fees', invoices, current)).toEqual({
      paymentDate: '2026-08-03',
    });
    expect(tileNeedsStartDate('fees', invoices, current)).toBe(true);
  });
  it('paid with no payment date recorded: only the number', () => {
    expect(run('registration', [inv('HFSE1', '2026-08-01', 'paid')])).toEqual({
      invoice: 'HFSE1',
    });
  });
});

describe('stageFromInvoices — all voided', () => {
  it('Voided + the latest voided number, payment date cleared', () => {
    expect(
      run(
        'fees',
        [
          inv('HFSE1', '2026-08-01', 'voided'),
          inv('HFSE2', '2026-09-01', 'voided'),
        ],
        snap({ status: 'Unpaid', invoice: 'HFSE2', paymentDate: '2026-09-01' })
      )
    ).toEqual({ status: 'Voided', paymentDate: null });
  });
  it('Ready for invoicing and Not required are kept', () => {
    for (const status of ['Ready for invoicing', 'Not required'])
      expect(
        run(
          'registration',
          [inv('HFSE1', '2026-08-01', 'voided')],
          snap({ status })
        )
      ).toBeNull();
  });
  it('a blank stage turns Voided', () => {
    expect(
      run(
        'registration',
        [inv('HFSE1', '2026-08-01', 'voided')],
        snap({ status: null })
      )
    ).toEqual({ status: 'Voided', invoice: 'HFSE1' });
  });
});

describe('tileNeedsStartDate — false branches', () => {
  const paid = [
    inv('HFSE1', '2026-08-01', 'paid', { paymentDate: '2026-08-03' }),
  ];
  it('already Paid or Cancelled', () => {
    expect(tileNeedsStartDate('fees', paid, snap({ status: 'Paid' }))).toBe(
      false
    );
    expect(
      tileNeedsStartDate('fees', paid, snap({ status: 'Cancelled' }))
    ).toBe(false);
  });
  it('has a start date, is Registration, or has nothing live', () => {
    expect(
      tileNeedsStartDate('fees', paid, snap({ startDate: '2026-08-10' }))
    ).toBe(false);
    expect(tileNeedsStartDate('registration', paid, snap())).toBe(false);
    expect(tileNeedsStartDate('fees', [], snap())).toBe(false);
  });
});
