// Audit-log writer for post-lock grade edits.
// Hard rule (CLAUDE.md): every change made after lock must be logged with an
// approval_reference, and the audit log is append-only. This helper diffs old
// vs new values per field and inserts one row per changed field, using the
// spec's bracket notation for array elements (e.g. "ww_scores[1]").

import type { SupabaseClient } from '@supabase/supabase-js';

export type GradeFields = {
  ww_scores?: (number | null)[] | null;
  pt_scores?: (number | null)[] | null;
  qa_score?: number | null;
  letter_grade?: string | null;
  is_na?: boolean | null;
};

export type AuditContext = {
  service: SupabaseClient;
  grading_sheet_id: string;
  grade_entry_id: string;
  changed_by: string; // email, user_id, or username
  approval_reference: string; // required — upstream route enforces presence
};

function formatValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function arraysEqual(
  a: (number | null)[] | undefined,
  b: (number | null)[] | undefined
) {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] ?? null) !== (b[i] ?? null)) return false;
  }
  return true;
}

// Compute the list of audit rows that should be written for a transition
// from `before` to `after`. Does NOT insert — returns the rows so the caller
// can insert them in a single batch after the main update succeeds.
export function buildAuditRows(
  before: GradeFields,
  after: GradeFields,
  ctx: Omit<AuditContext, 'service'>
) {
  const rows: Array<{
    grading_sheet_id: string;
    grade_entry_id: string;
    changed_by: string;
    field_changed: string;
    old_value: string | null;
    new_value: string | null;
    approval_reference: string;
  }> = [];

  const base = {
    grading_sheet_id: ctx.grading_sheet_id,
    grade_entry_id: ctx.grade_entry_id,
    changed_by: ctx.changed_by,
    approval_reference: ctx.approval_reference,
  };

  const diffArray = (name: 'ww_scores' | 'pt_scores') => {
    const a = (before[name] ?? []) as (number | null)[];
    const b = (after[name] ?? []) as (number | null)[];
    if (arraysEqual(a, b)) return;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const oldV = a[i] ?? null;
      const newV = b[i] ?? null;
      if (oldV === newV) continue;
      rows.push({
        ...base,
        field_changed: `${name}[${i}]`,
        old_value: formatValue(oldV),
        new_value: formatValue(newV),
      });
    }
  };

  diffArray('ww_scores');
  diffArray('pt_scores');

  if (
    'qa_score' in after &&
    (before.qa_score ?? null) !== (after.qa_score ?? null)
  ) {
    rows.push({
      ...base,
      field_changed: 'qa_score',
      old_value: formatValue(before.qa_score ?? null),
      new_value: formatValue(after.qa_score ?? null),
    });
  }
  if (
    'letter_grade' in after &&
    (before.letter_grade ?? null) !== (after.letter_grade ?? null)
  ) {
    rows.push({
      ...base,
      field_changed: 'letter_grade',
      old_value: formatValue(before.letter_grade ?? null),
      new_value: formatValue(after.letter_grade ?? null),
    });
  }
  if ('is_na' in after && (before.is_na ?? false) !== (after.is_na ?? false)) {
    rows.push({
      ...base,
      field_changed: 'is_na',
      old_value: String(before.is_na ?? false),
      new_value: String(after.is_na ?? false),
    });
  }

  return rows;
}

// Returns whether the rows landed. NEVER THROWS.
//
// ⚠ IT USED TO THROW, AND EVERY CALLER CALLS IT AFTER THE GRADE IS SAVED. A
// failed insert here therefore aborted the route with a 500 over a change that
// had already happened — skipping the `audit_log` rows that follow it, and on
// an applied change request the email that tells the teacher. So one missing
// record became three, and the person saving was told nothing was saved.
//
// Now the failure is reported loudly and handed back; callers mark their
// `audit_log` rows with `grade_audit_log_failed: true` so the gap can be found
// and closed from the rows that did land.
export async function writeAuditRows(
  service: SupabaseClient,
  rows: ReturnType<typeof buildAuditRows>
): Promise<boolean> {
  if (rows.length === 0) return true;
  try {
    const { error } = await service.from('grade_audit_log').insert(rows);
    if (error) {
      console.error('[grade-audit] grade_audit_log insert failed', {
        rows: rows.length,
        grading_sheet_id: rows[0]?.grading_sheet_id,
        error: error.message,
      });
      return false;
    }
    return true;
  } catch (e) {
    console.error('[grade-audit] grade_audit_log insert threw', {
      rows: rows.length,
      grading_sheet_id: rows[0]?.grading_sheet_id,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

// Helper for sheet-totals changes, which don't live on a grade_entry.
// We log these against a sentinel entry_id = null if the schema allows,
// otherwise against the sheet itself. Our schema requires grade_entry_id NOT
// NULL, so totals edits reuse the first entry's id as a placeholder — the
// field_changed string makes the scope clear ("ww_totals[0]" etc.).
export function buildTotalsAuditRows(
  before: { ww_totals: number[]; pt_totals: number[]; qa_total: number | null },
  after: { ww_totals: number[]; pt_totals: number[]; qa_total: number | null },
  ctx: Omit<AuditContext, 'service'>
) {
  const rows: ReturnType<typeof buildAuditRows> = [];
  const base = {
    grading_sheet_id: ctx.grading_sheet_id,
    grade_entry_id: ctx.grade_entry_id,
    changed_by: ctx.changed_by,
    approval_reference: ctx.approval_reference,
  };

  const diffNumArray = (name: 'ww_totals' | 'pt_totals') => {
    const a = before[name] ?? [];
    const b = after[name] ?? [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const oldV = a[i] ?? null;
      const newV = b[i] ?? null;
      if (oldV === newV) continue;
      rows.push({
        ...base,
        field_changed: `${name}[${i}]`,
        old_value: oldV == null ? null : String(oldV),
        new_value: newV == null ? null : String(newV),
      });
    }
  };
  diffNumArray('ww_totals');
  diffNumArray('pt_totals');
  if ((before.qa_total ?? null) !== (after.qa_total ?? null)) {
    rows.push({
      ...base,
      field_changed: 'qa_total',
      old_value: before.qa_total == null ? null : String(before.qa_total),
      new_value: after.qa_total == null ? null : String(after.qa_total),
    });
  }
  return rows;
}
