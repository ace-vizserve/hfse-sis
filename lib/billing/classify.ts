// Which Registration / Fees tile an invoice belongs to, and for which year.
// Nothing here is set up in the SIS (KD #232 update 2026-10-16): the tile
// follows the QuickBooks income account of each line, and the year follows
// the student's own applications. Pure.

export type BillingStage = 'registration' | 'fees';
export type StageChoice = BillingStage | 'none';
export type InvoiceLine = {
  itemId: string | null;
  itemName: string | null;
  accountId: string | null;
  description: string | null;
  qty: number | null;
  amount: number;
};
/** One application of a student: its AY and the Singapore date it was made. */
export type StudentApplication = { ayCode: string; createdOn: string };
export type BillingMaps = {
  accounts: Map<string, StageChoice>;
  /** studentNumber → every application the student has, any AY. */
  applications: Map<string, StudentApplication[]>;
};

const ORDER: BillingStage[] = ['registration', 'fees'];

/**
 * The tile an income account fills, from its QuickBooks name (fully
 * qualified, e.g. `Service/Fee Revenue:Enrolment Fees:School Uniforms`).
 * Checked against HFSE's Products/Services export: Admissions & Registration
 * is Registration, every Enrolment Fees sub-account is Fees, and everything
 * else (Student Devt Fees and Tuition sit on Advance customers payment) is
 * nothing. `\b` also takes the sandbox's flat `Enrolment Fees - Books …`.
 */
export function stageForAccount(name: string | null): StageChoice {
  if (!name) return 'none';
  if (/(^|:)Admissions & Registration$/.test(name)) return 'registration';
  if (/(^|:)Enrolment Fees\b/.test(name)) return 'fees';
  return 'none';
}

/** Days an application may be made after its invoice and still own it. */
const GRACE_DAYS = 7;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The school year an invoice belongs to: the student's NEWEST application
 * (any AY) made on or before the invoice date + 7 days; with none, the
 * student's EARLIEST application. No applications or no invoice date → null.
 * Date ranges can't do this — AY2026 and AY2027 invoices overlap May–Jul.
 * Verified on all 868 typed Registration / Fees invoices in production.
 */
export function yearForInvoice(
  apps: StudentApplication[],
  txnDate: string | null
): string | null {
  const date = txnDate?.slice(0, 10) ?? null;
  if (!date || apps.length === 0) return null;
  const sorted = [...apps].sort(
    (a, b) =>
      a.createdOn.localeCompare(b.createdOn) || a.ayCode.localeCompare(b.ayCode)
  );
  const limit = addDays(date, GRACE_DAYS);
  const prior = sorted.filter((a) => a.createdOn <= limit);
  return (prior.length ? prior[prior.length - 1] : sorted[0]).ayCode;
}

export function classifyInvoice(
  lines: InvoiceLine[],
  txnDate: string | null,
  maps: BillingMaps,
  studentNumber: string
): { ayCode: string | null; stageKeys: BillingStage[] } {
  const found = new Set<BillingStage>();
  for (const l of lines) {
    const choice = l.accountId ? maps.accounts.get(l.accountId) : undefined;
    if (choice && choice !== 'none') found.add(choice);
  }
  const ayCode = yearForInvoice(
    maps.applications.get(studentNumber) ?? [],
    txnDate
  );
  if (found.size === 0 || !ayCode) return { ayCode: null, stageKeys: [] };
  return { ayCode, stageKeys: ORDER.filter((s) => found.has(s)) };
}
