import { describe, expect, it } from 'vitest';

import { billingAuditRowLink } from '@/lib/billing/audit-links';
import type { AuditLinkRow, AuditRowLink } from '@/lib/audit/row-links';
import type { Role } from '@/lib/auth/roles';

// Context shapes copied from real local audit_log rows (2026-10-20).
function row(
  entity_type: string,
  action: string,
  entity_id: string | null,
  context: Record<string, unknown> = {}
): AuditLinkRow {
  return { entity_type, action, entity_id, context };
}

const cases: Array<[string, AuditLinkRow, AuditRowLink | null]> = [
  [
    'invoice created → the invoice',
    row('qbo_invoice', 'qbo.invoice.create', '416', {
      doc_number: 'HFSE069007',
      studentNumber: 'H260134',
    }),
    { href: '/billing/H260134/invoices/416', label: 'Open invoice' },
  ],
  [
    'invoice voided → the invoice',
    row('qbo_invoice', 'qbo.invoice.void', '406', { studentNumber: 'H210001' }),
    { href: '/billing/H210001/invoices/406', label: 'Open invoice' },
  ],
  [
    'invoice edited → the invoice',
    row('qbo_invoice', 'qbo.invoice.update', '423', {
      studentNumber: 'H260162',
    }),
    { href: '/billing/H260162/invoices/423', label: 'Open invoice' },
  ],
  [
    'payment → the customer',
    row('qbo_payment', 'qbo.payment.create', '414', {
      studentNumber: 'H220003',
    }),
    { href: '/billing/H220003', label: 'Open customer' },
  ],
  [
    'customer created → the customer',
    row('qbo_customer', 'qbo.customer.create', '125', {
      student_number: 'H260134',
    }),
    { href: '/billing/H260134', label: 'Open customer' },
  ],
  [
    'customer linked (logged against the student)',
    row('qbo_customer', 'qbo.customer.link', 'H260134', { customer_id: '125' }),
    { href: '/billing/H260134', label: 'Open customer' },
  ],
  [
    'product',
    row('qbo_item', 'qbo.item.update', '38', { name: 'SIS test service 2' }),
    { href: '/billing/products', label: 'Open products' },
  ],
  [
    'connection',
    row('qbo_connection', 'qbo.connection.connect', '9341458480401908'),
    { href: '/billing/settings', label: 'Open QuickBooks' },
  ],
  // No student on the row → no customer page to open.
  [
    'invoice sent (no student recorded)',
    row('qbo_invoice', 'qbo.invoice.send', '311', { doc_number: 'HFSE062401' }),
    null,
  ],
  [
    'bulk link run',
    row('qbo_customer', 'billing.link.run', 'bulk', { review: 370 }),
    null,
  ],
  [
    'non-QuickBooks row falls through to the shared resolver',
    row('enrolment_status', 'sis.stage.update', 'E260016', {
      ay_code: 'AY2026',
    }),
    {
      href: '/admissions/applications/E260016?ay=AY2026',
      label: 'Open application',
    },
  ],
];

describe('billingAuditRowLink — mappings (superadmin)', () => {
  it.each(cases)('%s', (_name, input, expected) => {
    expect(billingAuditRowLink(input, 'superadmin')).toEqual(expected);
  });
});

describe('billingAuditRowLink — role gate', () => {
  const connection = row('qbo_connection', 'qbo.connection.connect', '1');
  const invoice = row('qbo_invoice', 'qbo.invoice.create', '416', {
    studentNumber: 'H260134',
  });
  const gate: Array<[string, AuditLinkRow, Role | null, boolean]> = [
    ['connection settings: superadmin only', connection, 'school_admin', false],
    ['invoice: admissions', invoice, 'admissions', true],
    ['invoice: teacher has no /billing', invoice, 'teacher', false],
  ];
  it.each(gate)('%s', (_name, input, role, allowed) => {
    expect(billingAuditRowLink(input, role) !== null).toBe(allowed);
  });
});
