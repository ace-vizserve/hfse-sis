// Link an invoice already in QuickBooks to a Registration / Fees stage
// (Mr Ace 2026-10-21: "add in the invoice number via search and link it —
// like create or link an invoice"). The rules that decide whether a found
// invoice may be tied to the stage, each with the sentence staff read.
// Pure and client-safe: lib/billing/stage-link.server.ts gathers the facts.

import { invoiceNumberKey, type BillingStage } from '@/lib/billing/tie';

export const STAGE_LINK_NAME: Record<BillingStage, string> = {
  registration: 'Registration',
  fees: 'Fees',
};

/** What the SIS knows about the number staff typed and the stage. */
export type StageLinkFacts = {
  /** The number as typed, trimmed. */
  docNumber: string;
  stage: BillingStage;
  ayCode: string;
  studentNumber: string;
  /** The student has an application (status row) in that AY. */
  hasStageRow: boolean;
  /** QuickBooks invoices with that number. */
  found: Array<{
    id: string;
    docNumber: string | null;
    customerId: string;
    customerName: string;
    state: 'open' | 'paid' | 'voided';
  }>;
  /** The student the invoice's customer is linked to, if any. */
  invoiceCustomerHolder: string | null;
  /** The customer this student is linked to, if any. */
  studentCustomer: { id: string; name: string } | null;
  /** The stored tie of the found invoice, when it has one. */
  storedTie: {
    studentNumber: string;
    ayCode: string;
    stageKeys: string[];
  } | null;
  /** The number of another live invoice already tied to this stage. */
  stageLiveDoc: string | null | undefined;
};

export type StageLinkDecision =
  | {
      ok: true;
      /** The student's customer gets linked too (needs a second confirm). */
      linksCustomer: boolean;
      /** Already tied to exactly this stage: nothing to do. */
      alreadyLinked: boolean;
    }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): StageLinkDecision => ({
  ok: false,
  status,
  error,
});

/** Several matches → the ones whose number matches as compared (case-free). */
export function exactMatches<T extends { docNumber: string | null }>(
  found: T[],
  typed: string
): T[] {
  const key = invoiceNumberKey(typed);
  return found.filter((f) => invoiceNumberKey(f.docNumber) === key);
}

export function decideStageLink(f: StageLinkFacts): StageLinkDecision {
  const doc = f.docNumber;
  const stageName = STAGE_LINK_NAME[f.stage];
  const found = exactMatches(f.found, doc);
  if (found.length === 0)
    return refuse(404, `No QuickBooks invoice has the number ${doc}.`);
  if (found.length > 1)
    return refuse(
      409,
      `${found.length} QuickBooks invoices have the number ${doc}, so the SIS can't tell which one. Give one of them a different number in QuickBooks first.`
    );
  const inv = found[0];
  const shown = inv.docNumber ?? doc;
  if (inv.state === 'voided')
    return refuse(
      422,
      `${shown} was voided in QuickBooks, so it can't be linked.`
    );
  if (!f.hasStageRow)
    return refuse(
      422,
      `This student has no ${f.ayCode} application, so there is no ${stageName} stage to link it to.`
    );
  if (f.invoiceCustomerHolder && f.invoiceCustomerHolder !== f.studentNumber)
    return refuse(
      409,
      `${shown} is billed to ${inv.customerName} (${f.invoiceCustomerHolder}).`
    );
  if (f.studentCustomer && f.studentCustomer.id !== inv.customerId)
    return refuse(
      409,
      `This student is linked to ${f.studentCustomer.name} in QuickBooks; ${shown} belongs to ${inv.customerName}.`
    );
  const tie = f.storedTie;
  if (tie && tie.ayCode && tie.stageKeys.length > 0) {
    const here =
      tie.studentNumber === f.studentNumber &&
      tie.ayCode === f.ayCode &&
      tie.stageKeys.includes(f.stage);
    if (here) return { ok: true, linksCustomer: false, alreadyLinked: true };
    const where = tie.stageKeys
      .map((s) => STAGE_LINK_NAME[s as BillingStage] ?? s)
      .join(' and ');
    const whose =
      tie.studentNumber === f.studentNumber
        ? "this student's"
        : `student ${tie.studentNumber}'s`;
    return refuse(
      409,
      `${shown} is already on ${whose} ${where} for ${tie.ayCode}.`
    );
  }
  if (f.stageLiveDoc !== undefined)
    return refuse(
      409,
      `${stageName} for ${f.ayCode} already has invoice ${f.stageLiveDoc ?? 'tied to it'}.`
    );
  return {
    ok: true,
    linksCustomer: !f.studentCustomer,
    alreadyLinked: false,
  };
}

/** The status shown on the confirm card, as the stage would read it. */
export function linkStatusLabel(
  r: {
    state: 'open' | 'paid' | 'voided';
    total: number;
    balance: number;
    dueDate: string | null;
  },
  today: string
): 'Paid' | 'Unpaid' | 'Partially paid' | 'Overdue' | 'Voided' {
  if (r.state === 'voided') return 'Voided';
  if (r.state === 'paid' || r.balance <= 0) return 'Paid';
  if (r.dueDate && r.dueDate.slice(0, 10) < today) return 'Overdue';
  if (r.balance < r.total) return 'Partially paid';
  return 'Unpaid';
}

/** What Find shows before Link. */
export type StageLinkPreview = {
  qboInvoiceId: string;
  docNumber: string;
  customer: string;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  status: ReturnType<typeof linkStatusLabel>;
  products: string[];
  /** Linking also links this customer to the student (confirm it). */
  linksCustomer: boolean;
  alreadyLinked: boolean;
  studentName: string;
};
