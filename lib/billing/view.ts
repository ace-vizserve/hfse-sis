// What the Billing screens show, worked out from the stored QuickBooks copy.
// Pure and client-safe: the pages compute on the server, the sheets reuse the
// same rules in the browser.

import type { BillingStage, StageTarget } from '@/lib/billing/tie';

export type InvoiceStatus = 'open' | 'part' | 'overdue' | 'paid' | 'voided';

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Open',
  part: 'Part paid',
  overdue: 'Overdue',
  paid: 'Paid',
  voided: 'Voided',
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceStatus(
  r: {
    state: 'open' | 'paid' | 'voided';
    total: number;
    balance: number;
    dueDate: string | null;
  },
  today: string
): InvoiceStatus {
  if (r.state === 'voided') return 'voided';
  if (r.state === 'paid' || r.balance <= 0) return 'paid';
  if (r.dueDate && r.dueDate.slice(0, 10) < today) return 'overdue';
  if (r.balance < r.total) return 'part';
  return 'open';
}

/** Today's date in Singapore, YYYY-MM-DD. */
export function todaySg(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-09-01` → `1 Sep 2026`; blank → `—`. Fixed month names: the locale
 *  formatter writes "Sept" on some runtimes' ICU data. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '—';
  const month = MONTH_SHORT[Number(m[2]) - 1];
  if (!month) return '—';
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** `2026-10-12` → `12 Oct` (no year); blank → null. Same fixed month names. */
export function formatShortDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = MONTH_SHORT[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month}`;
}

/** "AY2025 Books,AY2025 Materials Fee, … +4" — each item once. */
export function itemsSummary(
  lines: Array<{ itemName: string | null }>,
  max = 3
): string {
  const names = [
    ...new Set(
      lines.map((l) => l.itemName?.trim()).filter((n): n is string => !!n)
    ),
  ];
  if (names.length === 0) return 'No items';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** Who made the invoice, in words staff use. */
export function createdByLabel(r: {
  source: string | null;
  createdByEmail: string | null;
  memo: string | null;
  /** The Memo on statement — n8n's note may be in either field. */
  privateNote?: string | null;
}): string {
  if (r.source === 'created' && r.createdByEmail) return r.createdByEmail;
  // Invoices the SIS made before the memo stopped carrying the creator.
  const old = r.privateNote?.match(/(?:^|\n)Created from SIS by (.+)$/)?.[1];
  if (old) return old;
  if (
    [r.memo, r.privateNote].some((m) =>
      (m ?? '').startsWith('Auto-generated via n8n')
    )
  )
    return 'n8n';
  return 'QuickBooks';
}

const STAGE_LABEL: Record<BillingStage, string> = {
  registration: 'Registration',
  fees: 'Fees',
};

/** "Fees · AY2027", or null when the invoice fills no tile. */
export function tileTag(
  stageKeys: string[],
  ayCode: string | null
): string | null {
  const stages = stageKeys.filter(
    (s): s is BillingStage => s === 'registration' || s === 'fees'
  );
  if (!ayCode || stages.length === 0) return null;
  return `${stages.map((s) => STAGE_LABEL[s]).join(' + ')} · ${ayCode}`;
}

/** "Reyes, Marco Andres L." — the QuickBooks naming, in title case. */
export function studentDisplayName(a: {
  lastName: string | null;
  firstName: string | null;
  middleName?: string | null;
  enroleeFullName?: string | null;
}): string {
  const last = a.lastName?.trim();
  const first = a.firstName?.trim();
  if (last && first) {
    const mi = a.middleName?.trim()
      ? ` ${a.middleName.trim()[0].toUpperCase()}.`
      : '';
    return `${last}, ${first}${mi}`;
  }
  return a.enroleeFullName?.trim() || 'Unnamed student';
}

/**
 * The amber note on Create invoice from a stage: that stage already has a
 * live invoice tied to it — "Fees for AY2027 already has HFSE069021 open."
 * A warning, never a block. No stage (Create invoice on the customer page)
 * → no note: that invoice is tied to nothing.
 */
export function duplicateTileWarning(args: {
  target: StageTarget | null;
  existing: Array<{
    docNumber: string | null;
    ayCode: string | null;
    stageKeys: string[];
    state: 'open' | 'paid' | 'voided';
  }>;
}): string | null {
  const t = args.target;
  if (!t) return null;
  const live = args.existing.filter(
    (e) =>
      e.state !== 'voided' &&
      e.ayCode === t.ayCode &&
      e.stageKeys.includes(t.stage)
  );
  if (live.length === 0) return null;
  const same = live.find((e) => e.state === 'open') ?? live[0];
  const doc = same.docNumber ?? 'an invoice';
  return `${STAGE_LABEL[t.stage]} for ${t.ayCode} already has ${doc} ${same.state === 'open' ? 'open' : 'paid'}.`;
}
