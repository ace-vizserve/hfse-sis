// What the Registration and Fees stage cards say (spec 2026-10-21 "Stage
// card"): the status chip's tone, the one line under it, and whether the card
// offers Create invoice in Billing. Worked out from the stage's own status and
// the invoices TIED to it. Pure and client-safe.

import {
  latestFirst,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import { formatDay, formatShortDay } from '@/lib/billing/view';
import { sgDate } from '@/lib/dates';
import { formatSgd } from '@/lib/qbo/format';

// The chip tone lives in the one tone table, lib/sis/stage-tone.ts.
export { billingStageTone, type BillingStageTone } from '@/lib/sis/stage-tone';

/** A UTC timestamp as its Singapore day, "20 Oct 2026"; null when unreadable. */
function sgDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDay(sgDate(iso));
}

/** The tied invoices of one stage, summed up for its card. */
export type StageBilling = {
  /** The invoice the card opens: the newest live one, else the newest. */
  lead: {
    qboInvoiceId: string;
    docNumber: string | null;
    state: 'open' | 'paid' | 'voided';
  } | null;
  /** A live (not voided) invoice is tied to the stage. */
  hasLive: boolean;
  /** Every live tied invoice is paid. */
  allPaid: boolean;
  /** Balance and total of the live tied invoices. */
  owed: number;
  total: number;
  /** The earliest due date of the open ones. */
  dueDate: string | null;
  /** The latest payment date of the paid ones. */
  paymentDate: string | null;
};

export function summarizeStageInvoices(
  invoices: Array<TileInvoice & { qboInvoiceId: string }>
): StageBilling {
  const live = invoices.filter((i) => i.state !== 'voided').sort(latestFirst);
  const lead = live[0] ?? [...invoices].sort(latestFirst)[0] ?? null;
  const open = live.filter((i) => i.state === 'open');
  const dues = open
    .map((i) => i.dueDate?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  const paid = live
    .map((i) => i.paymentDate?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    lead: lead
      ? {
          qboInvoiceId: lead.qboInvoiceId,
          docNumber: lead.docNumber,
          state: lead.state,
        }
      : null,
    hasLive: live.length > 0,
    allPaid: live.length > 0 && open.length === 0,
    owed: round(live.reduce((s, i) => s + Math.max(0, i.balance), 0)),
    total: round(live.reduce((s, i) => s + i.total, 0)),
    dueDate: dues[0] ?? null,
    paymentDate: paid.at(-1) ?? null,
  };
}

export type StageCardLine = { text: string; attention: boolean };

/** Owed statuses: a stage holding one with nothing tied was billed before Billing. */
const OWED_BEFORE_BILLING = new Set(['Unpaid', 'Partially paid', 'Overdue']);

/**
 * The one line under the chip:
 *   "HFSE069006 · S$200.00 owed · due 4 Nov" / "HFSE062240 · paid 12 Oct 2026"
 *   / "Ticked by Miss Luz on 20 Oct 2026. No invoice yet." / …
 * Fees paid in QuickBooks with no start date asks for it (unchanged rule).
 */
export function stageCardLine(a: {
  stage: 'registration' | 'fees';
  status: string | null;
  /** The number on the stage itself (written by the sync, or typed long ago). */
  invoice: string | null;
  paymentDate: string | null;
  startDate: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** The tied invoices; null when not linked or QuickBooks isn't connected. */
  billing: StageBilling | null;
  /** QuickBooks is connected, so `billing` is the whole story. */
  connected?: boolean;
}): StageCardLine {
  const status = (a.status ?? '').trim();
  const b = a.billing;
  const line = (text: string): StageCardLine => ({ text, attention: false });
  if (
    a.stage === 'fees' &&
    b?.allPaid &&
    status !== 'Paid' &&
    status !== 'Cancelled' &&
    !a.startDate?.trim()
  )
    return {
      text: 'Paid in QuickBooks — add the start date',
      attention: true,
    };
  const num = b?.lead?.docNumber?.trim() || a.invoice?.trim() || null;
  const owed = b && b.hasLive ? formatSgd(b.owed) : null;
  const due = formatShortDay(b?.dueDate);
  const join = (...parts: Array<string | null | false>) =>
    parts.filter(Boolean).join(' · ');
  // Owed but no QuickBooks invoice tied: billed before Billing. Create invoice
  // stays hidden (it would bill twice), so the card says why and what to do.
  // Paid keeps its own line — nothing is left to bill.
  if (a.connected && OWED_BEFORE_BILLING.has(status) && !b?.hasLive) {
    const typed = a.invoice?.trim();
    return line(
      `Invoiced before Billing${typed ? `: ${typed}` : ''}. Tick Ready for invoicing in Edit to bill here.`
    );
  }
  switch (status) {
    case '':
      return line('Nobody has asked for an invoice yet.');
    case 'Ready for invoicing': {
      const who = a.updatedBy?.trim();
      const when = sgDay(a.updatedAt);
      const ticked =
        who && when
          ? `Ticked by ${who} on ${when}.`
          : who
            ? `Ticked by ${who}.`
            : when
              ? `Ticked on ${when}.`
              : 'Ticked.';
      return line(`${ticked} No invoice yet.`);
    }
    case 'Not required':
      return line('No fee for this student.');
    case 'Cancelled':
      return line('The application stopped here.');
    case 'Voided':
      return line(
        `${num ?? 'The invoice'} was voided. Tick Ready for invoicing to bill again.`
      );
    case 'Paid': {
      const paidOn = b?.paymentDate ?? a.paymentDate;
      return line(
        join(num ?? 'Invoice', paidOn ? `paid ${formatDay(paidOn)}` : 'paid')
      );
    }
    case 'Unpaid':
      return line(
        join(num ?? 'Invoice', owed && `${owed} owed`, due && `due ${due}`)
      );
    case 'Partially paid':
      return line(
        join(
          num ?? 'Invoice',
          owed && b && `${owed} of ${formatSgd(b.total)} owed`
        )
      );
    case 'Overdue':
      return line(
        join(num ?? 'Invoice', owed && `${owed} owed`, due && `was due ${due}`)
      );
    default:
      return line(num ?? status);
  }
}

/** Statuses that say the stage already has an invoice, tied or not. */
const INVOICED = new Set(['Unpaid', 'Partially paid', 'Overdue', 'Paid']);

/**
 * Create invoice in Billing shows while no live invoice is tied to the stage,
 * unless the stage is Cancelled or Not required — or its status already says
 * it was invoiced (a number typed before Billing that no QuickBooks invoice
 * matched): a second invoice there would bill twice.
 */
export function canCreateFromStage(
  status: string | null,
  billing: StageBilling | null
): boolean {
  const s = (status ?? '').trim();
  if (s === 'Cancelled' || s === 'Not required' || INVOICED.has(s))
    return false;
  return !billing?.hasLive;
}

/** Billing's Create invoice for this stage. */
export function createFromStageHref(
  studentNumber: string,
  stage: 'registration' | 'fees',
  ayCode: string
): string {
  return `/billing/${encodeURIComponent(studentNumber)}?new=invoice&stage=${stage}&ay=${encodeURIComponent(ayCode)}`;
}

/** `?stage=&ay=` on the Billing student page, checked; null when not valid. */
export function stageFromParams(
  stage: string | undefined,
  ay: string | undefined
): { stage: 'registration' | 'fees'; ayCode: string } | null {
  if (stage !== 'registration' && stage !== 'fees') return null;
  const ayCode = (ay ?? '').trim().toUpperCase();
  if (!/^AY\d{4}$/.test(ayCode)) return null;
  return { stage, ayCode };
}

/** The stage's tied invoice in Billing. */
export function stageInvoiceHref(
  studentNumber: string,
  qboInvoiceId: string
): string {
  return `/billing/${encodeURIComponent(studentNumber)}/invoices/${encodeURIComponent(qboInvoiceId)}`;
}
