import type { SupabaseClient } from '@supabase/supabase-js';

import {
  recomputeSheetEntries,
  type SheetTotals,
  type SheetWeights,
} from '@/lib/grading/recompute-sheet';

// The half of `sync_grading_sheets_from_config` that SQL cannot do.
//
// The RPC (migration 052, amended by 107) resizes ww_totals / pt_totals /
// qa_total on every unlocked sheet for a config, plus the matching score
// arrays. It stops there: a PL/pgSQL function cannot call
// lib/compute/quarterly.ts, and Hard Rule #2 forbids a second copy of the
// formula living in the database. So the denominators move and the stored
// grades do not — and the stored quarterly_grade is what the report card
// prints, not a cache.
//
// This module runs the recompute afterwards, over exactly the sheets the RPC
// touched.

export type SheetSnapshot = {
  id: string;
  qa_total: number | null;
};

export type TruncationBlocker = {
  sheetId: string;
  component: 'ww' | 'pt';
  /** 1-based, as a teacher would name it: "Written Work 4". */
  slotNumbers: number[];
  studentsAffected: number;
};

/**
 * Sheets that would LOSE entered marks if the slot count dropped to these
 * maxima.
 *
 * HFSE agrees a Scheme of Work before each AY, so the normal case is a save
 * against empty sheets — this returns nothing and the broadcast proceeds
 * untouched. The rule only engages on the rare mid-year change, and only when
 * the alternative is deleting work a teacher has already entered.
 *
 * Refusing beats logging: Hard Rule #6 says a deletion needs an audit row, but
 * a score is not recoverable FROM an audit row. During a parallel run against
 * Excel this is exactly the loss nobody notices for weeks.
 */
export async function findTruncationBlockers(
  service: SupabaseClient,
  configId: string,
  nextWwMaxSlots: number,
  nextPtMaxSlots: number
): Promise<TruncationBlocker[]> {
  const { data: sheetRows, error: sheetErr } = await service
    .from('grading_sheets')
    .select('id')
    .eq('subject_config_id', configId)
    .eq('is_locked', false);
  if (sheetErr) throw new Error(sheetErr.message);

  const sheetIds = ((sheetRows ?? []) as { id: string }[]).map((r) => r.id);
  if (sheetIds.length === 0) return [];

  const { data: entryRows, error: entryErr } = await service
    .from('grade_entries')
    .select('grading_sheet_id, ww_scores, pt_scores')
    .in('grading_sheet_id', sheetIds);
  if (entryErr) throw new Error(entryErr.message);

  type Row = {
    grading_sheet_id: string;
    ww_scores: (number | null)[] | null;
    pt_scores: (number | null)[] | null;
  };

  const acc = new Map<string, TruncationBlocker>();
  const note = (
    sheetId: string,
    component: 'ww' | 'pt',
    slotNumber: number
  ) => {
    const key = `${sheetId}|${component}`;
    const existing = acc.get(key);
    if (existing) {
      if (!existing.slotNumbers.includes(slotNumber))
        existing.slotNumbers.push(slotNumber);
      existing.studentsAffected += 1;
      return;
    }
    acc.set(key, {
      sheetId,
      component,
      slotNumbers: [slotNumber],
      studentsAffected: 1,
    });
  };

  for (const row of (entryRows ?? []) as Row[]) {
    // A null is "not taken" (Hard Rule #3) and losing it costs nothing. Only a
    // real score counts as work that would be destroyed.
    (row.ww_scores ?? []).forEach((v, i) => {
      if (i >= nextWwMaxSlots && v != null)
        note(row.grading_sheet_id, 'ww', i + 1);
    });
    (row.pt_scores ?? []).forEach((v, i) => {
      if (i >= nextPtMaxSlots && v != null)
        note(row.grading_sheet_id, 'pt', i + 1);
    });
  }

  return [...acc.values()].map((b) => ({
    ...b,
    slotNumbers: b.slotNumbers.sort((a, z) => a - z),
  }));
}

/**
 * The new qa_total for a sheet, or null to leave it alone.
 *
 * A sheet still sitting at the OLD subject default was never customised, so it
 * adopts the new one — that is the SOW broadcast working as intended. A sheet
 * holding anything else was set deliberately for that section (a Secondary
 * paper out of 140 while the level sits at 100) and an unrelated config save
 * must not silently revert it.
 */
export function resolveQaTotal(
  currentQaTotal: number | null,
  previousQaMax: number | null,
  nextQaMax: number | null
): number | null {
  if (nextQaMax == null) return null;
  if (currentQaTotal == null) return nextQaMax;
  if (previousQaMax != null && Number(currentQaTotal) !== Number(previousQaMax))
    return null; // customised — leave it
  return Number(currentQaTotal) === Number(nextQaMax) ? null : nextQaMax;
}

export type SyncRecomputeResult = {
  sheetsSynced: number;
  sheetsSkippedLocked: number;
  entriesScanned: number;
  entriesRecomputed: number;
  /** Sheets that adopted the new subject default exam total. */
  qaTotalsApplied: number;
  /** Sheets whose deliberately-set exam total was left alone. */
  qaTotalsPreserved: number;
  /** Null on success. A human-readable reason on failure. */
  error: string | null;
};

// Unbounded parallel writes overwhelm the connection pool — same reasoning as
// lib/attendance/mutations.ts. Sheets are independent, so a small pool is
// plenty: a config fans out to 4 terms x N sections.
const CONCURRENCY = 8;

type SheetRow = {
  id: string;
  is_locked: boolean;
  ww_totals: number[] | null;
  pt_totals: number[] | null;
  qa_total: number | null;
};

/**
 * Which sheets the RPC actually touched.
 *
 * Prefers the `sheet_ids` key migration 107 added, and falls back to querying
 * by config id when it is absent — so this code is correct both before and
 * after that migration is applied, in either deploy order.
 *
 * The fallback is strictly worse and not just for tidiness: a sheet locked
 * between the RPC and the follow-up query would be resized and then filtered
 * out of the recompute, leaving a stale LOCKED sheet. Locked sheets are the
 * ones feeding published report cards, so that is the worst outcome available.
 * The returned ids close that window.
 */
async function resolveSyncedSheetIds(
  service: SupabaseClient,
  configId: string,
  syncResult: unknown
): Promise<string[]> {
  const fromRpc = (syncResult as { sheet_ids?: unknown } | null)?.sheet_ids;
  if (Array.isArray(fromRpc))
    return fromRpc.filter((v): v is string => typeof v === 'string');

  const { data, error } = await service
    .from('grading_sheets')
    .select('id')
    .eq('subject_config_id', configId)
    .eq('is_locked', false);
  if (error) throw new Error(`could not list synced sheets: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Recompute every sheet the RPC just resized.
 *
 * Never throws — the caller needs the counts even on failure so it can write
 * an honest audit row. `error` carries the reason instead.
 */
export async function recomputeSyncedSheets(
  service: SupabaseClient,
  configId: string,
  syncResult: unknown,
  syncErr: { message: string } | null,
  /**
   * Applies the qa_total customisation rule before recomputing. Omit to leave
   * qa_total exactly as the database holds it.
   *
   * `priorQaBySheet` is read by the caller BEFORE the RPC runs, so this is
   * correct whether or not migration 108 (which stops the RPC writing
   * qa_total) has been applied — the two can deploy in either order.
   */
  qaPolicy?: {
    previousQaMax: number | null;
    nextQaMax: number | null;
    priorQaBySheet: Map<string, number | null>;
  }
): Promise<SyncRecomputeResult> {
  const empty: SyncRecomputeResult = {
    sheetsSynced: 0,
    sheetsSkippedLocked: 0,
    entriesScanned: 0,
    entriesRecomputed: 0,
    qaTotalsApplied: 0,
    qaTotalsPreserved: 0,
    error: null,
  };

  if (syncErr) {
    return { ...empty, error: `sheet sync failed: ${syncErr.message}` };
  }

  try {
    const { data: config, error: cfgErr } = await service
      .from('subject_configs')
      .select('ww_weight, pt_weight, qa_weight')
      .eq('id', configId)
      .maybeSingle();
    if (cfgErr) throw new Error(cfgErr.message);
    if (!config) throw new Error(`subject_config ${configId} not found`);

    const weights: SheetWeights = {
      ww_weight: Number((config as SheetWeights).ww_weight),
      pt_weight: Number((config as SheetWeights).pt_weight),
      qa_weight: Number((config as SheetWeights).qa_weight),
    };

    const sheetIds = await resolveSyncedSheetIds(service, configId, syncResult);
    if (sheetIds.length === 0) return empty;

    // Re-read the sheets rather than trusting the pre-sync snapshot: this is
    // where a sheet locked mid-flight is caught. Hard Rule #5 — a background
    // recompute must never be a post-lock edit.
    const { data: sheetData, error: sheetErr } = await service
      .from('grading_sheets')
      .select('id, is_locked, ww_totals, pt_totals, qa_total')
      .in('id', sheetIds);
    if (sheetErr) throw new Error(sheetErr.message);

    const sheets = (sheetData ?? []) as SheetRow[];
    const open = sheets.filter((s) => !s.is_locked);
    const skippedLocked = sheets.length - open.length;

    let entriesScanned = 0;
    let entriesRecomputed = 0;
    let qaTotalsApplied = 0;
    let qaTotalsPreserved = 0;

    // Settle qa_total FIRST — the recompute reads it as the exam denominator,
    // so writing it afterwards would leave every grade computed against the
    // wrong one.
    const qaBySheet = new Map<string, number | null>();
    for (const sheet of open) {
      const stored = sheet.qa_total == null ? null : Number(sheet.qa_total);
      if (!qaPolicy) {
        qaBySheet.set(sheet.id, stored);
        continue;
      }
      const prior = qaPolicy.priorQaBySheet.has(sheet.id)
        ? qaPolicy.priorQaBySheet.get(sheet.id)!
        : stored;
      const next = resolveQaTotal(
        prior,
        qaPolicy.previousQaMax,
        qaPolicy.nextQaMax
      );
      if (next == null) {
        qaTotalsPreserved += 1;
        qaBySheet.set(sheet.id, prior);
        // The RPC may have clobbered it (pre-migration-108). Put it back.
        if (stored !== prior) {
          const { error: restoreErr } = await service
            .from('grading_sheets')
            .update({ qa_total: prior, updated_at: new Date().toISOString() })
            .eq('id', sheet.id);
          if (restoreErr) throw new Error(restoreErr.message);
        }
        continue;
      }
      qaTotalsApplied += 1;
      qaBySheet.set(sheet.id, next);
      if (stored !== next) {
        const { error: qaErr } = await service
          .from('grading_sheets')
          .update({ qa_total: next, updated_at: new Date().toISOString() })
          .eq('id', sheet.id);
        if (qaErr) throw new Error(qaErr.message);
      }
    }

    for (let i = 0; i < open.length; i += CONCURRENCY) {
      const batch = open.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((sheet) => {
          const totals: SheetTotals = {
            ww_totals: (sheet.ww_totals ?? []).map(Number),
            pt_totals: (sheet.pt_totals ?? []).map(Number),
            qa_total: qaBySheet.get(sheet.id) ?? null,
          };
          return recomputeSheetEntries(service, sheet.id, totals, weights);
        })
      );
      for (const r of results) {
        entriesScanned += r.entriesScanned;
        entriesRecomputed += r.entriesWritten;
      }
    }

    return {
      sheetsSynced: open.length,
      sheetsSkippedLocked: skippedLocked,
      entriesScanned,
      entriesRecomputed,
      qaTotalsApplied,
      qaTotalsPreserved,
      error: null,
    };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : 'recompute failed',
    };
  }
}
