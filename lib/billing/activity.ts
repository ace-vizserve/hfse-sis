// The invoice page's "Invoice activity", like QuickBooks' own: Opened, Sent,
// Viewed, each payment, Paid. QuickBooks does not give apps the Viewed event
// (checked in the sandbox, 2026-10-16), so Viewed is always shown greyed.
// Pure.

import { formatSgd } from '@/lib/qbo/format';

export type ActivityEvent = {
  key: string;
  label: string;
  /** ISO date or date-time; null when not happened yet. */
  when: string | null;
  detail: string | null;
  tone: 'done' | 'paid' | 'off' | 'void';
  paymentId?: string;
};

/** `1/9/2026, 9:14:02 am`, as QuickBooks writes it. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (iso.length <= 10)
    return d.toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore' });
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    hour12: true,
  });
}

export function buildInvoiceActivity(args: {
  createdAt: string | null;
  createdBy: string | null;
  sends: Array<{ at: string; to: string | null; by: string | null }>;
  qbDelivery: { at: string | null; to: string | null } | null;
  payments: Array<{
    id: string;
    txnDate: string | null;
    account: string | null;
    reference: string | null;
    amount: number;
  }>;
  state: 'open' | 'paid' | 'voided';
  balance: number;
  voidedAt: string | null;
}): ActivityEvent[] {
  const out: ActivityEvent[] = [
    {
      key: 'opened',
      label: 'Opened',
      when: args.createdAt,
      detail: args.createdBy ? `by ${args.createdBy}` : null,
      tone: 'done',
    },
  ];
  if (args.sends.length > 0) {
    for (const [i, s] of args.sends.entries())
      out.push({
        key: `sent-${i}`,
        label: 'Sent',
        when: s.at,
        detail:
          [s.to, s.by ? `by ${s.by}` : null].filter(Boolean).join(' · ') ||
          null,
        tone: 'done',
      });
  } else if (args.qbDelivery?.at) {
    out.push({
      key: 'sent-qb',
      label: 'Sent',
      when: args.qbDelivery.at,
      detail: args.qbDelivery.to,
      tone: 'done',
    });
  }
  out.push({
    key: 'viewed',
    label: 'Viewed',
    when: null,
    detail: 'Shown in QuickBooks only',
    tone: 'off',
  });
  const pays = [...args.payments].sort((a, b) =>
    (a.txnDate ?? '').localeCompare(b.txnDate ?? '')
  );
  const describe = (p: (typeof pays)[number]) =>
    [p.account, formatSgd(p.amount), p.reference ? `ref ${p.reference}` : null]
      .filter(Boolean)
      .join(' · ');
  const last =
    args.state === 'paid' && args.balance <= 0 ? pays.at(-1) : undefined;
  for (const p of pays) {
    if (p === last) continue;
    out.push({
      key: `pay-${p.id}`,
      label: 'Partly paid',
      when: p.txnDate,
      detail: describe(p),
      tone: 'paid',
      paymentId: p.id,
    });
  }
  if (args.state === 'voided') {
    out.push({
      key: 'voided',
      label: 'Voided',
      when: args.voidedAt,
      detail: null,
      tone: 'void',
    });
    return out;
  }
  if (last)
    out.push({
      key: 'paid',
      label: 'Paid',
      when: last.txnDate,
      detail: describe(last),
      tone: 'paid',
      paymentId: last.id,
    });
  else
    out.push({
      key: 'paid',
      label: 'Paid',
      when: null,
      detail: `${formatSgd(args.balance)} still due`,
      tone: 'off',
    });
  return out;
}
