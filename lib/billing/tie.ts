// Which Registration / Fees stage an invoice belongs to — only when it is TIED
// to that stage (spec 2026-10-21 "Registration and Fees filled from Billing").
// A tie is made two ways and nothing else: the invoice was created from the
// stage, or its QuickBooks number is the number staff typed on that stage.
// The income account and the invoice date decide nothing (Mr Ace: "youre
// just assuming"). Pure and client-safe.

export type BillingStage = 'registration' | 'fees';
export const BILLING_STAGES: readonly BillingStage[] = ['registration', 'fees'];

export type InvoiceLine = {
  itemId: string | null;
  itemName: string | null;
  accountId: string | null;
  description: string | null;
  qty: number | null;
  amount: number;
};

/** The stage an invoice is created for: Create invoice from a stage. */
export type StageTarget = { stage: BillingStage; ayCode: string };

/** Where an invoice sits: `ay_code` + `stage_keys` on `qbo_invoices`. */
export type Place = { ayCode: string | null; stageKeys: BillingStage[] };

export const NO_PLACE: Place = { ayCode: null, stageKeys: [] };

/**
 * The invoice numbers typed on the students' stages:
 * studentNumber → number key (`invoiceNumberKey`) → every (AY, stage) it was
 * typed on.
 */
export type BillingMaps = {
  typed: Map<string, Map<string, StageTarget[]>>;
};

export const emptyMaps = (): BillingMaps => ({ typed: new Map() });

/** A number as compared: trimmed, case-insensitive. Blank → null. */
export function invoiceNumberKey(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase();
  return t === '' ? null : t;
}

export function addTypedNumber(
  maps: BillingMaps,
  studentNumber: string,
  number: string | null | undefined,
  target: StageTarget
): void {
  const key = invoiceNumberKey(number);
  if (!key) return;
  const byNumber = maps.typed.get(studentNumber) ?? new Map();
  const list: StageTarget[] = byNumber.get(key) ?? [];
  if (!list.some((t) => t.ayCode === target.ayCode && t.stage === target.stage))
    list.push(target);
  byNumber.set(key, list);
  maps.typed.set(studentNumber, byNumber);
}

export function isTied(p: {
  ayCode: string | null;
  stageKeys: readonly string[] | null;
}): boolean {
  return !!p.ayCode && (p.stageKeys ?? []).length > 0;
}

const stagesOf = (keys: readonly string[]): BillingStage[] =>
  BILLING_STAGES.filter((s) => keys.includes(s));

/**
 * The stage(s) whose typed number is this invoice's number, for this student.
 * Typed on stages of several years → the newest year (a number reused across
 * years is the newer application's). Both stages of one year → both.
 */
export function typedNumberPlace(
  maps: BillingMaps,
  studentNumber: string,
  docNumber: string | null | undefined
): Place | null {
  const key = invoiceNumberKey(docNumber);
  if (!key) return null;
  const hits = maps.typed.get(studentNumber)?.get(key) ?? [];
  if (hits.length === 0) return null;
  const ayCode = hits
    .map((h) => h.ayCode)
    .sort()
    .at(-1)!;
  return {
    ayCode,
    stageKeys: stagesOf(
      hits.filter((h) => h.ayCode === ayCode).map((h) => h.stage)
    ),
  };
}

export type TieReason = 'kept' | 'created' | 'typed' | 'none';

/**
 * The tie an invoice gets on save: the tie it already has (same student);
 * else the stage it was created from; else the stage whose typed number is
 * its number; else none.
 */
export function tieFor(args: {
  existing: {
    ayCode: string | null;
    stageKeys: readonly string[] | null;
    studentNumber: string;
  } | null;
  explicit?: StageTarget | null;
  studentNumber: string;
  docNumber: string | null | undefined;
  maps: BillingMaps;
}): { place: Place; reason: TieReason } {
  const e = args.existing;
  if (e && e.studentNumber === args.studentNumber && isTied(e))
    return {
      place: { ayCode: e.ayCode, stageKeys: stagesOf(e.stageKeys ?? []) },
      reason: 'kept',
    };
  if (args.explicit)
    return {
      place: {
        ayCode: args.explicit.ayCode,
        stageKeys: [args.explicit.stage],
      },
      reason: 'created',
    };
  const typed = typedNumberPlace(args.maps, args.studentNumber, args.docNumber);
  if (typed) return { place: typed, reason: 'typed' };
  return { place: NO_PLACE, reason: 'none' };
}
