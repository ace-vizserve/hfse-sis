// The hourly Overdue pass (spec 2026-10-21): an invoice turns overdue by the
// calendar, not by a QuickBooks change, so no webhook or change check sees
// it. This picks the students whose stage must be recomputed. Pure.

import { BILLING_STAGES, type BillingStage } from '@/lib/billing/tie';

export type OverdueCandidate = {
  studentNumber: string;
  ayCode: string | null;
  stageKeys: readonly string[] | null;
  state: 'open' | 'paid' | 'voided';
  dueDate: string | null;
};

/** `${studentNumber}|${ayCode}` → the stage statuses on that AY's row. */
export type StageStatuses = Map<
  string,
  Partial<Record<BillingStage, string | null>>
>;

export const statusKey = (studentNumber: string, ayCode: string) =>
  `${studentNumber}|${ayCode}`;

/**
 * The (student, AY) pairs with a tied, open invoice past its due date whose
 * stage is not Overdue yet (and not Cancelled — staff own that). A pair with
 * no stage row in `statuses` is skipped.
 */
export function overdueSweepTargets(
  invoices: OverdueCandidate[],
  statuses: StageStatuses,
  today: string
): Array<{ studentNumber: string; ayCode: string }> {
  const out = new Map<string, { studentNumber: string; ayCode: string }>();
  for (const inv of invoices) {
    const due = inv.dueDate?.trim().slice(0, 10);
    if (inv.state !== 'open' || !inv.ayCode || !due || due >= today) continue;
    const row = statuses.get(statusKey(inv.studentNumber, inv.ayCode));
    if (!row) continue;
    for (const stage of BILLING_STAGES) {
      if (!(inv.stageKeys ?? []).includes(stage)) continue;
      if (!(stage in row)) continue;
      const now = (row[stage] ?? '').trim();
      if (now === 'Overdue' || now === 'Cancelled') continue;
      out.set(statusKey(inv.studentNumber, inv.ayCode), {
        studentNumber: inv.studentNumber,
        ayCode: inv.ayCode,
      });
    }
  }
  return [...out.values()];
}
