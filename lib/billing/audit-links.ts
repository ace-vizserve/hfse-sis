// Where a Billing audit row's "Open" link goes.
//
// The shared resolver (`lib/audit/row-links.ts`) maps every other module's
// rows; QuickBooks rows are mapped here so that file never depends on Billing,
// which production does not have yet. Same rules: built only from what the row
// stores, offered only when the viewer may open the page, and `null` rather
// than a link that dead-ends.
//
// ⚠ The customer page is `/billing/<studentNumber>`, so a row is linkable only
// when it names its student. `qbo.invoice.send` records the invoice and the
// address it went to, not the student — those rows stay unlinked.

import {
  auditRowLink,
  gateAuditLink,
  type AuditLinkRow,
  type AuditLinkTarget,
  type AuditRowLink,
} from '@/lib/audit/row-links';
import type { Role } from '@/lib/auth/roles';

const STUDENT_NUMBER = /^[A-Za-z]{1,3}\d{3,}$/;
/** QuickBooks ids are digit strings. */
const QBO_ID = /^\d+$/;

function studentNumberOf(row: AuditLinkRow): string | null {
  const ctx = row.context ?? {};
  for (const key of ['studentNumber', 'student_number']) {
    const v = ctx[key];
    if (typeof v === 'string' && STUDENT_NUMBER.test(v)) return v;
  }
  // `qbo.customer.link` is logged against the student, not the customer.
  if (
    row.action === 'qbo.customer.link' &&
    row.entity_id &&
    STUDENT_NUMBER.test(row.entity_id)
  ) {
    return row.entity_id;
  }
  return null;
}

function customerPage(sn: string): string {
  return `/billing/${encodeURIComponent(sn)}`;
}

/** The Billing page for a QuickBooks row, before any role check. */
export function billingAuditRowTarget(
  row: AuditLinkRow
): AuditLinkTarget | null {
  switch (row.entity_type) {
    case 'qbo_invoice': {
      const sn = studentNumberOf(row);
      const id = row.entity_id;
      if (!sn || !id || !QBO_ID.test(id)) return null;
      return {
        href: `${customerPage(sn)}/invoices/${id}`,
        label: 'Open invoice',
      };
    }
    case 'qbo_payment':
    case 'qbo_customer': {
      const sn = studentNumberOf(row);
      return sn ? { href: customerPage(sn), label: 'Open customer' } : null;
    }
    case 'qbo_item':
      return { href: '/billing/products', label: 'Open products' };
    case 'qbo_connection':
      return { href: '/billing/settings', label: 'Open QuickBooks' };
    default:
      return null;
  }
}

/** The "Open" link for a Billing audit row — QuickBooks rows here, the rest shared. */
export function billingAuditRowLink(
  row: AuditLinkRow,
  role: Role | null
): AuditRowLink | null {
  const target = billingAuditRowTarget(row);
  return target ? gateAuditLink(target, role) : auditRowLink(row, role);
}
