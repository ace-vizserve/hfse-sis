import { sgDate } from '@/lib/dates';
import { STAGE_COLUMN_MAP } from '@/lib/schemas/sis';

// ──────────────────────────────────────────────────────────────────────────
// Ready for invoicing — the list whoever invoices works down.
//
// Registration and Fees carry a staff-set "Ready for invoicing" status (spec
// docs/superpowers/specs/2026-10-21-registration-fees-from-billing-design.md):
// someone marks that an applicant needs invoicing. This file is the pure
// half — which rows belong and in what order. The read is
// `ready-for-invoicing-loader.ts`.
//
// A row is one (student, stage): a child ready on both stages gives two rows,
// because each is a separate invoice. Any application status counts —
// enrolled children included — since the tick, not the pipeline position,
// is the go signal. The status match is EXACT, to agree with the loader's
// `.or(...eq...)` filter.
// ──────────────────────────────────────────────────────────────────────────

export const READY_FOR_INVOICING = 'Ready for invoicing';

export type InvoiceStage = 'registration' | 'fees';

export const INVOICE_STAGES: readonly InvoiceStage[] = ['registration', 'fees'];

export const INVOICE_STAGE_LABELS: Record<InvoiceStage, string> = {
  registration: 'Registration',
  fees: 'Fees',
};

/** Status-row columns the list reads. A literal (supabase-js types a
 *  non-literal select as an error row); the unit test binds it to
 *  `STAGE_COLUMN_MAP` so the two cannot drift. */
export const READY_FOR_INVOICING_STATUS_SELECT =
  'enroleeNumber, applicationStatus, classLevel, registrationStatus, registrationRemarks, registrationUpdateDate, registrationUpdatedby, feeStatus, feeRemarks, feeUpdatedDate, feeUpdatedby';

export type ReadyForInvoicingRow = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  studentName: string;
  level: string | null;
  applicationStatus: string | null;
  stage: InvoiceStage;
  /** Whoever last saved this stage — the person who ticked it, unless a
   *  later save of the stage (e.g. remarks) replaced them. */
  tickedBy: string | null;
  /** The stage's last update as a Singapore date (`yyyy-MM-dd`), or null. */
  tickedOn: string | null;
  /** The stage's remarks as plain text (rich-text tags stripped), or null. */
  remarks: string | null;
};

export type ReadyForInvoicingIdentity = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  studentName: string;
  level: string | null;
};

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/** Rich-text remarks (KD #205 stores HTML) to one line of plain text. */
export function plainRemarks(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const text = v
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function toSgDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // A bare date is already a calendar date — don't shift it through UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : sgDate(s);
}

/** The list's rows for one status row: zero, one or two. Pure. */
export function buildReadyForInvoicingRows(
  identity: ReadyForInvoicingIdentity,
  statusRow: Record<string, unknown>
): ReadyForInvoicingRow[] {
  const out: ReadyForInvoicingRow[] = [];
  for (const stage of INVOICE_STAGES) {
    const cols = STAGE_COLUMN_MAP[stage];
    if (statusRow[cols.statusCol] !== READY_FOR_INVOICING) continue;
    out.push({
      ...identity,
      applicationStatus: str(statusRow.applicationStatus),
      stage,
      tickedBy: str(statusRow[cols.updatedByCol]),
      tickedOn: toSgDate(statusRow[cols.updatedDateCol]),
      remarks: plainRemarks(statusRow[cols.remarksCol]),
    });
  }
  return out;
}

/** Oldest tick first; unknown dates last; then name, then stage. */
export function compareReadyForInvoicing(
  a: ReadyForInvoicingRow,
  b: ReadyForInvoicingRow
): number {
  if (a.tickedOn !== b.tickedOn) {
    if (!a.tickedOn) return 1;
    if (!b.tickedOn) return -1;
    return a.tickedOn < b.tickedOn ? -1 : 1;
  }
  const byName = a.studentName.localeCompare(b.studentName);
  if (byName !== 0) return byName;
  return INVOICE_STAGES.indexOf(a.stage) - INVOICE_STAGES.indexOf(b.stage);
}

/** Whole days from a `yyyy-MM-dd` date to `today` (also `yyyy-MM-dd`). */
export function daysSince(date: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}
