import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllPages } from '@/lib/supabase/paginate';

// Can this grading sheet be removed? (KD #131 update, 2026-09-29.)
//
// Mr Ace, 2026-09-29: "theres no way to un-attach a grading sheet to a
// section". The rule he approved: a sheet may be removed ONLY when nothing has
// ever been entered on it. Anything entered is a grade entry, and Hard Rule #6
// says grade entries are never deleted — so a sheet with even one mark stays.
//
// "Nothing entered" is judged on EVERYTHING a row can carry, not just the
// scores a teacher types:
//   - a WW / PT slot with a value — 0 included (Hard Rule #3: blank ≠ zero;
//     a zero is a mark the child got)
//   - an exam score, any derived figure (PS, initial, quarterly), a letter
//   - an excused slot (migration 179) — never set automatically: the column
//     defaults to '{}' and only the audited registrar route writes it
// and on the sheet's HISTORY: a mark typed then cleared leaves a row blank but
// its audit trail behind, and removing the sheet would orphan that trail. So
// any `grade_audit_log` row, any `audit_log` row against one of its entries,
// or any change request refuses it too. A locked sheet is refused outright.
//
// ⚠ `is_na` ALONE IS NOT "ENTERED" (fix, 2026-09-29). Creating a sheet with
// rows seeds `is_na = true` for every late enrollee (POST /api/grading-sheets),
// so counting it made such a sheet unremovable forever. A person setting N/A
// is a write that leaves history — `grade_audit_log` after lock, an
// `audit_log` `entry.update` row before it (migration 152/165 trigger) — and
// the history check above refuses that sheet. The flag itself is ignored here.

export type GradeEntryValues = {
  ww_scores?: (number | string | null)[] | null;
  pt_scores?: (number | string | null)[] | null;
  qa_score?: number | string | null;
  ww_ps?: number | string | null;
  pt_ps?: number | string | null;
  qa_ps?: number | string | null;
  initial_grade?: number | string | null;
  quarterly_grade?: number | string | null;
  letter_grade?: string | null;
  is_na?: boolean | null;
  ww_excused?: number[] | null;
  pt_excused?: number[] | null;
};

/** The columns `entryHasEnteredData` reads — select exactly these. */
export const ENTRY_VALUE_COLUMNS =
  'ww_scores, pt_scores, qa_score, ww_ps, pt_ps, qa_ps, initial_grade, quarterly_grade, letter_grade, ww_excused, pt_excused';

const present = (v: unknown) => v !== null && v !== undefined;

/** True when this one row holds anything at all. A 0 counts. */
export function entryHasEnteredData(e: GradeEntryValues): boolean {
  if ((e.ww_scores ?? []).some(present)) return true;
  if ((e.pt_scores ?? []).some(present)) return true;
  if (
    present(e.qa_score) ||
    present(e.ww_ps) ||
    present(e.pt_ps) ||
    present(e.qa_ps) ||
    present(e.initial_grade) ||
    present(e.quarterly_grade)
  )
    return true;
  if (typeof e.letter_grade === 'string' && e.letter_grade.trim() !== '')
    return true;
  // `is_na` deliberately not read — see the header.
  if ((e.ww_excused ?? []).length > 0) return true;
  if ((e.pt_excused ?? []).length > 0) return true;
  return false;
}

/** True when any row on the sheet holds anything. No rows = nothing entered. */
export function sheetHasEnteredData(entries: GradeEntryValues[]): boolean {
  return entries.some(entryHasEnteredData);
}

export type SheetRemovalBlock = 'locked' | 'entered' | 'history';

export type SheetRemovability =
  | { removable: true; reason: null }
  | { removable: false; block: SheetRemovalBlock; reason: string };

export const SHEET_REMOVAL_REASONS: Record<SheetRemovalBlock, string> = {
  locked: 'This sheet is locked, so it can’t be removed.',
  entered: 'This sheet has scores entered, so it can’t be removed.',
  history: 'Scores were entered on this sheet before, so it can’t be removed.',
};

/** The rule, as one decision. Locked first, then entered, then history. */
export function decideSheetRemoval(input: {
  isLocked: boolean;
  hasEnteredData: boolean;
  hasHistory: boolean;
}): SheetRemovability {
  const block: SheetRemovalBlock | null = input.isLocked
    ? 'locked'
    : input.hasEnteredData
      ? 'entered'
      : input.hasHistory
        ? 'history'
        : null;
  return block
    ? { removable: false, block, reason: SHEET_REMOVAL_REASONS[block] }
    : { removable: true, reason: null };
}

const CHUNK = 150;

/**
 * Removability for several sheets in four queries, whatever their number.
 * Throws on a query error — a check that cannot answer must not say "yes".
 */
export async function loadSheetRemovability(
  service: SupabaseClient,
  sheets: Array<{ id: string; is_locked: boolean }>
): Promise<Map<string, SheetRemovability & { entryCount: number }>> {
  const out = new Map<string, SheetRemovability & { entryCount: number }>();
  if (sheets.length === 0) return out;
  const ids = sheets.map((s) => s.id);

  // Paged: many sheets at once (a section-term) can pass the server's
  // 1,000-row cap, and a missing row would make a sheet with marks look
  // empty. fetchAllPages throws on a query error, as this function must.
  type Row = GradeEntryValues & { id: string; grading_sheet_id: string };
  const entries = await fetchAllPages<Row>((from, to) =>
    service
      .from('grade_entries')
      .select(`id, grading_sheet_id, ${ENTRY_VALUE_COLUMNS}`)
      .in('grading_sheet_id', ids)
      .range(from, to)
  );

  const bySheet = new Map<string, Row[]>();
  for (const row of entries) {
    const list = bySheet.get(row.grading_sheet_id) ?? [];
    list.push(row);
    bySheet.set(row.grading_sheet_id, list);
  }

  // History is only worth asking about for a sheet that passed the cheap checks.
  const candidates = sheets.filter(
    (s) => !s.is_locked && !sheetHasEnteredData(bySheet.get(s.id) ?? [])
  );
  const withHistory = new Set<string>();
  if (candidates.length > 0) {
    const candidateIds = candidates.map((s) => s.id);
    const entryToSheet = new Map<string, string>();
    for (const id of candidateIds)
      for (const row of bySheet.get(id) ?? []) entryToSheet.set(row.id, id);

    const [gal, crs] = await Promise.all([
      service
        .from('grade_audit_log')
        .select('grading_sheet_id')
        .in('grading_sheet_id', candidateIds)
        .limit(1000),
      service
        .from('grade_change_requests')
        .select('grading_sheet_id')
        .in('grading_sheet_id', candidateIds)
        .limit(1000),
    ]);
    if (gal.error) throw new Error(gal.error.message);
    if (crs.error) throw new Error(crs.error.message);
    for (const r of (gal.data ?? []) as { grading_sheet_id: string }[])
      withHistory.add(r.grading_sheet_id);
    for (const r of (crs.data ?? []) as { grading_sheet_id: string }[])
      withHistory.add(r.grading_sheet_id);

    // Every score write since migration 152 lands in `audit_log` against the
    // ENTRY (`entity_type = 'grade_entry'`), not the sheet.
    const entryIds = [...entryToSheet.keys()];
    for (let i = 0; i < entryIds.length; i += CHUNK) {
      const { data, error } = await service
        .from('audit_log')
        .select('entity_id')
        .eq('entity_type', 'grade_entry')
        .in('entity_id', entryIds.slice(i, i + CHUNK))
        .limit(1000);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { entity_id: string }[]) {
        const sheetId = entryToSheet.get(r.entity_id);
        if (sheetId) withHistory.add(sheetId);
      }
    }
  }

  for (const s of sheets) {
    const rows = bySheet.get(s.id) ?? [];
    out.set(s.id, {
      ...decideSheetRemoval({
        isLocked: s.is_locked,
        hasEnteredData: sheetHasEnteredData(rows),
        hasHistory: withHistory.has(s.id),
      }),
      entryCount: rows.length,
    });
  }
  return out;
}
