import type { SupabaseClient } from '@supabase/supabase-js';

import { computeQuarterly } from '@/lib/compute/quarterly';

// Recomputing a sheet's derived grades after its TOTALS change.
//
// Two call sites need this and only one of them had it. The per-sheet totals
// route (app/api/grading-sheets/[id]/totals/route.ts) has always recomputed
// correctly; the config-level fan-out (`sync_grading_sheets_from_config`,
// migration 052) resizes score arrays in SQL and cannot recompute, because a
// SQL function cannot call lib/compute/quarterly.ts — the single source of
// truth per Hard Rule #2. This module is the shared implementation so the
// correct precedent stops being something to imitate.
//
// Only DERIVED columns are written. `letter_grade` and `is_na` are operator
// overrides, not formula outputs, and must never appear in a patch from here.

export type SheetTotals = {
  ww_totals: number[];
  pt_totals: number[];
  qa_total: number | null;
};

export type SheetWeights = {
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
};

/** The raw columns a recompute reads. */
export type RecomputableEntry = {
  id: string;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
  // Stored derived values, used only to decide whether a write is needed.
  // Absent on callers that always write (the totals route pre-extraction).
  ww_ps?: number | null;
  pt_ps?: number | null;
  qa_ps?: number | null;
  initial_grade?: number | null;
  quarterly_grade?: number | null;
};

export type EntryPatch = {
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  updated_at: string;
};

// ww_ps / pt_ps / qa_ps / initial_grade are numeric(7,4) — stored already
// rounded, so an exact comparison would report every row as changed.
const PS_EPSILON = 1e-4;

/**
 * Resize a score array to match its totals array.
 *
 * Pads with `null`, NEVER `0` — Hard Rule #3. A null slot is excluded from
 * both the numerator and the denominator, so adding one leaves every grade
 * untouched; a zero would silently tank the class.
 */
export function padScores(
  arr: (number | null)[] | null,
  length: number
): (number | null)[] {
  const out: (number | null)[] = new Array(length).fill(null);
  const src = arr ?? [];
  for (let i = 0; i < Math.min(src.length, length); i++)
    out[i] = src[i] ?? null;
  return out;
}

function numDiffers(
  stored: number | null | undefined,
  computed: number | null
): boolean {
  if (stored === undefined) return true; // caller didn't load it — assume dirty
  if (stored == null && computed == null) return false;
  if (stored == null || computed == null) return true;
  return Math.abs(Number(stored) - computed) > PS_EPSILON;
}

/**
 * Recompute one entry against a sheet's totals.
 *
 * `changed` is false when every value the patch would write already matches
 * what is stored. That is what makes the common case free: extending
 * `ww_max_slots` by one pads each entry with a null slot, which moves no
 * grade, so a pure slot-count increase writes nothing at all beyond the rows
 * whose arrays actually resize.
 *
 * An array-length difference always counts as changed even when no grade
 * moves — the stored array shape has to match the totals, or the sheet renders
 * with the wrong number of columns.
 */
export function recomputeEntryRow(
  entry: RecomputableEntry,
  totals: SheetTotals,
  weights: SheetWeights
): { patch: EntryPatch; changed: boolean } {
  const ww = padScores(entry.ww_scores, totals.ww_totals.length);
  const pt = padScores(entry.pt_scores, totals.pt_totals.length);

  const computed = computeQuarterly({
    ww_scores: ww,
    ww_totals: totals.ww_totals,
    pt_scores: pt,
    pt_totals: totals.pt_totals,
    qa_score: entry.qa_score,
    qa_total: totals.qa_total,
    ww_weight: Number(weights.ww_weight),
    pt_weight: Number(weights.pt_weight),
    qa_weight: Number(weights.qa_weight),
  });

  const shapeChanged =
    ww.length !== (entry.ww_scores ?? []).length ||
    pt.length !== (entry.pt_scores ?? []).length;

  const changed =
    shapeChanged ||
    numDiffers(entry.ww_ps, computed.ww_ps) ||
    numDiffers(entry.pt_ps, computed.pt_ps) ||
    numDiffers(entry.qa_ps, computed.qa_ps) ||
    numDiffers(entry.initial_grade, computed.initial_grade) ||
    // quarterly_grade is a smallint — compare it exactly.
    (entry.quarterly_grade === undefined
      ? true
      : (entry.quarterly_grade ?? null) !== computed.quarterly_grade);

  return {
    patch: {
      ww_scores: ww,
      pt_scores: pt,
      ww_ps: computed.ww_ps,
      pt_ps: computed.pt_ps,
      qa_ps: computed.qa_ps,
      initial_grade: computed.initial_grade,
      quarterly_grade: computed.quarterly_grade,
      updated_at: new Date().toISOString(),
    },
    changed,
  };
}

export type RecomputeResult = {
  entriesScanned: number;
  entriesWritten: number;
  /**
   * First entry id on the sheet. `grade_audit_log.grade_entry_id` is NOT NULL,
   * so a sheet-level totals change is anchored to it (see
   * lib/audit/log-grade-change.ts::buildTotalsAuditRows). Null when the sheet
   * has no entries.
   */
  anchorEntryId: string | null;
};

/**
 * Recompute every entry on one sheet. I/O shell around the pure functions
 * above; throws on a database error so the caller decides the response.
 *
 * A roster tops out at 50 students (Hard Rule #5), so one sheet's entries
 * always fit in a single page — no pagination needed here. Callers fanning
 * out across many sheets should still bound their own concurrency.
 */
export async function recomputeSheetEntries(
  service: SupabaseClient,
  sheetId: string,
  totals: SheetTotals,
  weights: SheetWeights
): Promise<RecomputeResult> {
  const { data, error } = await service
    .from('grade_entries')
    .select(
      'id, ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade'
    )
    .eq('grading_sheet_id', sheetId)
    .order('id');
  if (error)
    throw new Error(`recompute: reading entries failed: ${error.message}`);

  const entries = (data ?? []) as RecomputableEntry[];
  let entriesWritten = 0;

  for (const entry of entries) {
    const { patch, changed } = recomputeEntryRow(entry, totals, weights);
    if (!changed) continue;
    const { error: upErr } = await service
      .from('grade_entries')
      .update(patch)
      .eq('id', entry.id);
    if (upErr)
      throw new Error(
        `recompute: writing entry ${entry.id} failed: ${upErr.message}`
      );
    entriesWritten += 1;
  }

  return {
    entriesScanned: entries.length,
    entriesWritten,
    anchorEntryId: entries[0]?.id ?? null,
  };
}
