import { describe, expect, it } from 'vitest';

import {
  billingStageTone,
  canCreateFromStage,
  createFromStageHref,
  showsOpenInvoice,
  showsQuickBooksNote,
  stageCardLine,
  stageFromParams,
  summarizeStageInvoices,
  type StageBilling,
} from '@/lib/billing/stage-card';
import type { TileInvoice } from '@/lib/billing/stage-from-invoices';
import {
  BILLING_STAGE_LOOK,
  billingStatusLook,
  stageTone,
} from '@/lib/sis/stage-tone';

const inv = (
  o: Partial<TileInvoice & { qboInvoiceId: string }>
): TileInvoice & { qboInvoiceId: string } => ({
  qboInvoiceId: '101',
  docNumber: 'HFSE069006',
  txnDate: '2026-10-21',
  dueDate: '2026-11-04',
  state: 'open',
  paymentDate: null,
  total: 500,
  balance: 500,
  ...o,
});

const base = {
  stage: 'registration' as const,
  invoice: null,
  paymentDate: null,
  startDate: null,
  updatedBy: null,
  updatedAt: null,
  billing: null,
};

describe('billingStageTone', () => {
  it('maps every status on its exact value', () => {
    expect(billingStageTone(null)).toBe('blank');
    expect(billingStageTone('  ')).toBe('blank');
    expect(billingStageTone('Ready for invoicing')).toBe('ready');
    expect(billingStageTone('Unpaid')).toBe('unpaid');
    expect(billingStageTone('Partially paid')).toBe('partial');
    expect(billingStageTone('Overdue')).toBe('overdue');
    expect(billingStageTone('Paid')).toBe('paid');
    expect(billingStageTone('Voided')).toBe('muted');
    expect(billingStageTone('Not required')).toBe('paid');
    expect(billingStageTone('Cancelled')).toBe('muted');
    expect(billingStageTone(' partially PAID ')).toBe('partial');
  });
});

describe('one tone table for Registration / Fees', () => {
  it('chip, stripe and badge agree', () => {
    const look = (s: string) => billingStatusLook(s)!;
    expect(look('Paid')).toBe(BILLING_STAGE_LOOK.paid);
    expect(look('Not required')).toBe(BILLING_STAGE_LOOK.paid);
    expect(look('Paid').stripe).toBe('bg-brand-mint');
    expect(look('Overdue').stripe).toBe('bg-destructive');
    expect(look('Overdue').badge).toBe('blocked');
    expect(look('Partially paid').stripe).toBe('bg-brand-amber');
    expect(look('Unpaid').stripe).toBe('bg-brand-indigo');
    expect(look('Unpaid').badge).toBe('default');
    expect(look('Ready for invoicing').disc).toBe('pending');
    expect(look('Ready for invoicing').badge).toBe('warning');
    expect(look('Voided')).toBe(BILLING_STAGE_LOOK.muted);
    expect(look('Cancelled')).toBe(BILLING_STAGE_LOOK.muted);
    expect(billingStatusLook('Finished')).toBeNull();
  });
});

describe('stageTone (Enrollment tab stripes and counts)', () => {
  it('never reads Partially paid or Unpaid as paid', () => {
    expect(stageTone('Partially paid')).toBe('active');
    expect(stageTone('Unpaid')).toBe('active');
    expect(stageTone('Paid')).toBe('done');
  });
  it('done = Paid or Not required; Ready for invoicing waits', () => {
    expect(stageTone('Not required')).toBe('done');
    expect(stageTone('Ready for invoicing')).toBe('pending');
    expect(stageTone('Overdue')).toBe('pending');
    expect(stageTone('Voided')).toBe('pending');
    expect(stageTone('Cancelled')).toBe('failed');
    expect(stageTone(null)).toBe('empty');
  });
  it('keeps the other stages', () => {
    expect(stageTone('Finished')).toBe('done');
    expect(stageTone('Enrolled (Conditional)')).toBe('done');
    expect(stageTone('Pending')).toBe('pending');
    expect(stageTone('Ongoing Assessment')).toBe('active');
  });
  it('reads legacy lowercase values', () => {
    expect(stageTone('finished')).toBe('done');
    expect(stageTone(' PENDING ')).toBe('pending');
  });
});

describe('summarizeStageInvoices', () => {
  it('leads with the newest live invoice and sums what is owed', () => {
    const s = summarizeStageInvoices([
      inv({
        qboInvoiceId: '9',
        docNumber: 'HFSE069001',
        txnDate: '2026-09-01',
        state: 'voided',
        balance: 0,
      }),
      inv({ qboInvoiceId: '10', balance: 200 }),
    ]);
    expect(s.lead).toEqual({
      qboInvoiceId: '10',
      docNumber: 'HFSE069006',
      state: 'open',
    });
    expect(s).toMatchObject({
      hasLive: true,
      allPaid: false,
      owed: 200,
      total: 500,
      dueDate: '2026-11-04',
    });
  });
  it('voided only: leads with the voided one, nothing live', () => {
    const s = summarizeStageInvoices([inv({ state: 'voided', balance: 0 })]);
    expect(s.lead?.qboInvoiceId).toBe('101');
    expect(s.hasLive).toBe(false);
    expect(s.allPaid).toBe(false);
  });
  it('none tied', () => {
    expect(summarizeStageInvoices([])).toMatchObject({
      lead: null,
      hasLive: false,
    });
  });
});

describe('stageCardLine', () => {
  const open: StageBilling = summarizeStageInvoices([inv({ balance: 200 })]);
  it('Unpaid: number, owed, due', () =>
    expect(
      stageCardLine({
        ...base,
        status: 'Unpaid',
        billing: summarizeStageInvoices([inv({})]),
      }).text
    ).toBe('HFSE069006 · S$500.00 owed · due 4 Nov'));
  it('Partially paid: owed of total', () =>
    expect(
      stageCardLine({ ...base, status: 'Partially paid', billing: open }).text
    ).toBe('HFSE069006 · S$200.00 of S$500.00 owed'));
  it('Overdue: was due', () =>
    expect(
      stageCardLine({
        ...base,
        status: 'Overdue',
        billing: summarizeStageInvoices([inv({})]),
      }).text
    ).toBe('HFSE069006 · S$500.00 owed · was due 4 Nov'));
  it('Paid: number and paid date', () =>
    expect(
      stageCardLine({
        ...base,
        status: 'Paid',
        billing: summarizeStageInvoices([
          inv({
            docNumber: 'HFSE062240',
            state: 'paid',
            balance: 0,
            paymentDate: '2026-10-12',
          }),
        ]),
      }).text
    ).toBe('HFSE062240 · paid 12 Oct 2026'));
  it('Paid from the stage alone (not linked)', () =>
    expect(
      stageCardLine({
        ...base,
        status: 'Paid',
        invoice: 'HFSE062240',
        paymentDate: '2026-10-12',
      }).text
    ).toBe('HFSE062240 · paid 12 Oct 2026'));
  it('Ready for invoicing: who ticked it, when', () =>
    expect(
      stageCardLine({
        ...base,
        status: 'Ready for invoicing',
        updatedBy: 'Miss Luz',
        updatedAt: '2026-10-20T03:00:00+00:00',
      }).text
    ).toBe('Ticked by Miss Luz on 20 Oct 2026. No invoice yet.'));
  it('Ready for invoicing: the day is Singapore’s', () =>
    expect(
      stageCardLine({
        ...base,
        status: 'Ready for invoicing',
        updatedBy: 'Miss Luz',
        updatedAt: '2026-10-20T17:30:00Z',
      }).text
    ).toBe('Ticked by Miss Luz on 21 Oct 2026. No invoice yet.'));
  it('owed with nothing tied: invoiced before Billing', () => {
    expect(
      stageCardLine({
        ...base,
        status: 'Unpaid',
        invoice: 'HFSE050001',
        connected: true,
      }).text
    ).toBe(
      'Invoiced before Billing: HFSE050001. Tick Ready for invoicing in Edit to bill here.'
    );
    expect(
      stageCardLine({ ...base, status: 'Overdue', connected: true }).text
    ).toBe(
      'Invoiced before Billing. Tick Ready for invoicing in Edit to bill here.'
    );
    // Not connected: the card can't know what is tied.
    expect(
      stageCardLine({ ...base, status: 'Unpaid', invoice: 'HFSE050001' }).text
    ).toBe('HFSE050001');
  });
  it('Voided, Not required, Cancelled, Not set', () => {
    expect(
      stageCardLine({ ...base, status: 'Voided', invoice: 'HFSE069003' }).text
    ).toBe('HFSE069003 was voided. Tick Ready for invoicing to bill again.');
    expect(stageCardLine({ ...base, status: 'Not required' }).text).toBe(
      'No fee for this student.'
    );
    expect(stageCardLine({ ...base, status: 'Cancelled' }).text).toBe(
      'The application stopped here.'
    );
    expect(stageCardLine({ ...base, status: null }).text).toBe(
      'Nobody has asked for an invoice yet.'
    );
  });
  it('Fees paid in QuickBooks with no start date asks for it', () => {
    const paid = summarizeStageInvoices([
      inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' }),
    ]);
    expect(
      stageCardLine({ ...base, stage: 'fees', status: 'Unpaid', billing: paid })
    ).toEqual({
      text: 'Paid in QuickBooks — add the start date',
      attention: true,
    });
    expect(
      stageCardLine({
        ...base,
        stage: 'fees',
        status: 'Unpaid',
        startDate: '2027-01-07',
        billing: paid,
      }).attention
    ).toBe(false);
  });
});

describe('Create invoice in Billing', () => {
  it('shows with no live tied invoice, not on Cancelled / Not required', () => {
    expect(canCreateFromStage('Ready for invoicing', null)).toBe(true);
    expect(canCreateFromStage(null, null)).toBe(true);
    expect(
      canCreateFromStage(
        'Voided',
        summarizeStageInvoices([inv({ state: 'voided' })])
      )
    ).toBe(true);
    expect(
      canCreateFromStage('Unpaid', summarizeStageInvoices([inv({})]))
    ).toBe(false);
    // Invoiced before Billing, never tied: no second invoice.
    expect(canCreateFromStage('Paid', null)).toBe(false);
    expect(canCreateFromStage('Unpaid', null)).toBe(false);
    expect(canCreateFromStage('Cancelled', null)).toBe(false);
    expect(canCreateFromStage('Not required', null)).toBe(false);
  });
  it('Ready for invoicing after a void shows no QuickBooks note and no Open link', () => {
    const voided = summarizeStageInvoices([inv({ state: 'voided' })]);
    expect(showsQuickBooksNote('Ready for invoicing', voided)).toBe(false);
    expect(showsOpenInvoice('Ready for invoicing', voided)).toBe(false);
    expect(canCreateFromStage('Ready for invoicing', voided)).toBe(true);
  });
  it('Not required / Cancelled show no QuickBooks note', () => {
    const tied = summarizeStageInvoices([inv({})]);
    expect(showsQuickBooksNote('Not required', tied)).toBe(false);
    expect(showsQuickBooksNote(' Cancelled ', tied)).toBe(false);
  });
  it('QuickBooks-filled statuses show the note and the Open link', () => {
    const tied = summarizeStageInvoices([inv({})]);
    const voided = summarizeStageInvoices([inv({ state: 'voided' })]);
    expect(showsQuickBooksNote('Unpaid', tied)).toBe(true);
    expect(showsOpenInvoice('Unpaid', tied)).toBe(true);
    expect(showsQuickBooksNote('Voided', voided)).toBe(true);
    expect(showsOpenInvoice('Voided', voided)).toBe(true);
    // Nothing tied: nothing to note or open.
    expect(showsQuickBooksNote('Unpaid', null)).toBe(false);
    expect(showsOpenInvoice('Unpaid', null)).toBe(false);
  });
  it('links to Billing with the stage and year', () => {
    expect(createFromStageHref('H270134', 'fees', 'AY2027')).toBe(
      '/billing/H270134?new=invoice&stage=fees&ay=AY2027'
    );
    expect(stageFromParams('fees', 'ay2027')).toEqual({
      stage: 'fees',
      ayCode: 'AY2027',
    });
    expect(stageFromParams('contract', 'AY2027')).toBeNull();
    expect(stageFromParams('fees', '2027')).toBeNull();
  });
});
