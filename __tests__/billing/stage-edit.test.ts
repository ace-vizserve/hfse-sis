import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { StageBilling } from '@/lib/billing/stage-card';
import {
  BILLING_EDIT_CHOICES,
  billingEditShape,
  canCancelStage,
  canSaveChoice,
  cancelPayload,
  choosePayload,
  chooseSubtitle,
  initialChoice,
  invoicedSummary,
  remarksPayload,
} from '@/lib/billing/stage-edit';
import { qboLockViolation } from '@/lib/qbo/stage-lock';

const billing = (over: Partial<StageBilling> = {}): StageBilling => ({
  lead: { qboInvoiceId: '77', docNumber: 'HFSE069012', state: 'open' },
  hasLive: true,
  allPaid: false,
  owed: 200,
  total: 200,
  dueDate: '2026-11-20',
  paymentDate: null,
  ...over,
});

describe('which shape the Registration / Fees edit takes', () => {
  it('a live tied invoice → invoiced, otherwise choose', () => {
    expect(billingEditShape(true)).toBe('invoiced');
    expect(billingEditShape(false)).toBe('choose');
  });
});

describe('the choose shape', () => {
  it('offers exactly the three staff statuses, with their lines', () => {
    expect(BILLING_EDIT_CHOICES).toEqual([
      { value: 'Ready for invoicing', help: 'Shows up for whoever invoices.' },
      { value: 'Not required', help: 'No fee for this student.' },
      { value: 'Cancelled', help: 'The application stopped here.' },
    ]);
  });

  it('never offers what the server refuses with no live invoice', () => {
    const before = { status: null, invoice: null, paymentDate: null };
    for (const c of BILLING_EDIT_CHOICES) {
      expect(
        qboLockViolation(before, { status: c.value }, { hasLiveInvoice: false })
      ).toBeNull();
    }
  });

  it('preselects a staff status; blank, Voided and owed statuses pick nothing', () => {
    expect(initialChoice('Ready for invoicing')).toBe('Ready for invoicing');
    expect(initialChoice('Not required')).toBe('Not required');
    expect(initialChoice('Cancelled')).toBe('Cancelled');
    expect(initialChoice(null)).toBe('');
    expect(initialChoice('Voided')).toBe('');
    expect(initialChoice('Unpaid')).toBe('');
  });

  it('Save waits for a pick', () => {
    expect(canSaveChoice('')).toBe(false);
    expect(canSaveChoice(initialChoice('Voided'))).toBe(false);
    expect(canSaveChoice(initialChoice('Not required'))).toBe(true);
  });

  it('says why there is no invoice', () => {
    expect(chooseSubtitle(null, null)).toBe('No invoice yet.');
    expect(chooseSubtitle('Ready for invoicing', 'HFSE1')).toBe(
      'No invoice yet.'
    );
    expect(chooseSubtitle('Voided', 'HFSE069001')).toBe(
      'The last invoice (HFSE069001) was voided.'
    );
  });

  it('sends the pick and the remarks; the start date only when changed', () => {
    expect(
      choosePayload({ choice: 'Not required', remarks: '<p>x</p>' })
    ).toEqual({ status: 'Not required', remarks: '<p>x</p>' });
    expect(
      choosePayload({
        choice: 'Ready for invoicing',
        remarks: null,
        startDate: { before: '2026-08-01', now: '2026-08-01' },
      })
    ).toEqual({ status: 'Ready for invoicing', remarks: null });
    expect(
      choosePayload({
        choice: 'Ready for invoicing',
        remarks: null,
        startDate: { before: null, now: '2026-08-03' },
      })
    ).toEqual({
      status: 'Ready for invoicing',
      remarks: null,
      extras: { startDate: '2026-08-03' },
    });
  });
});

describe('the invoiced shape', () => {
  it('Save remarks sends the status back unchanged and no invoice fields', () => {
    const p = remarksPayload({
      initialStatus: 'Unpaid',
      remarks: '<p>later</p>',
    });
    expect(p).toEqual({ status: 'Unpaid', remarks: '<p>later</p>' });
    // The route reads an unchanged status as no change, even with a live invoice.
    expect(
      qboLockViolation(
        { status: 'Unpaid', invoice: 'HFSE069012', paymentDate: null },
        p,
        { hasLiveInvoice: true }
      )
    ).toBeNull();
  });

  it('Save remarks adds the Fees start date only when it changed', () => {
    expect(
      remarksPayload({
        initialStatus: 'Paid',
        remarks: null,
        startDate: { before: '2026-08-01T00:00:00', now: '2026-08-01' },
      }).extras
    ).toBeUndefined();
    expect(
      remarksPayload({
        initialStatus: 'Unpaid',
        remarks: null,
        startDate: { before: null, now: '2026-08-04' },
      }).extras
    ).toEqual({ startDate: '2026-08-04' });
  });

  it('Cancel this stage sends Cancelled, which the server takes with a live invoice', () => {
    const p = cancelPayload('<p>withdrew</p>');
    expect(p).toEqual({ status: 'Cancelled', remarks: '<p>withdrew</p>' });
    expect(
      qboLockViolation(
        { status: 'Unpaid', invoice: 'HFSE069012', paymentDate: null },
        p,
        { hasLiveInvoice: true }
      )
    ).toBeNull();
  });

  it('a Cancelled stage offers no Cancel this stage', () => {
    expect(canCancelStage('Cancelled')).toBe(false);
    expect(canCancelStage('Unpaid')).toBe(true);
    expect(canCancelStage('Paid')).toBe(true);
  });

  it('sums up owed, part paid and paid invoices', () => {
    expect(invoicedSummary(billing(), null)).toEqual({
      number: 'HFSE069012',
      money: { label: 'Owed', value: 'S$200.00' },
      due: '20 Nov 2026',
    });
    expect(invoicedSummary(billing({ owed: 50 }), null).money.value).toBe(
      'S$50.00 of S$200.00'
    );
    expect(
      invoicedSummary(
        billing({
          allPaid: true,
          owed: 0,
          dueDate: null,
          paymentDate: '2026-10-12',
          lead: { qboInvoiceId: '9', docNumber: null, state: 'paid' },
        }),
        'HFSE062240'
      )
    ).toEqual({
      number: 'HFSE062240',
      money: { label: 'Paid on', value: '12 Oct 2026' },
      due: null,
    });
  });
});

describe('the dialog, as it ships', () => {
  const root = join(__dirname, '..', '..');
  const dialog = readFileSync(
    join(root, 'components', 'sis', 'edit-stage-dialog.tsx'),
    'utf8'
  );
  const body = readFileSync(
    join(root, 'components', 'sis', 'billing-stage-edit.tsx'),
    'utf8'
  );

  it('Registration / Fees with QuickBooks connected use the billing body', () => {
    expect(dialog).toContain('<BillingStageEdit');
    expect(dialog).not.toContain('Leave as');
    expect(dialog).not.toContain('Set by staff');
  });

  it('the body has no ghost buttons and keeps rich-text remarks', () => {
    expect(body).not.toContain('variant="ghost"');
    expect(body).toContain('<RichTextEditor');
  });
});
