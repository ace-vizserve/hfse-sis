import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { loadOneSheetAuditLabels } from '@/lib/grading/sheet-audit-labels';
import { isPastGradingLock } from '@/lib/grading/lock-time';

// Server-side catch-up for the grading deadline (migration 186).
//
// The daily cron (06:00 SGT) is what sets `grading_sheets.is_locked` for a
// past-deadline sheet, so between the deadline minute and the next morning the
// stored flag still says unlocked. Every server route that WRITES to a sheet
// passes the sheet it already loaded (with `unlocked_at` and
// `term:terms(grading_lock_at)` in its select) through here: if the term's lock
// time has passed and no coordinator unlocked it since, the sheet is locked
// right here — exactly what the cron would do — and the route carries on down
// its locked path, so a past-deadline write needs a change request or a
// correction like any other post-lock edit (Hard Rule #5). Locking for real,
// rather than only pretending, keeps the change-request apply RPC
// (`apply_change_request_atomic`, which re-checks the stored flag) and the
// change-request filing route consistent with what the page shows.
//
// Costs nothing on a sheet before its deadline: the check is on data the route
// already read, and only a past-deadline sheet makes a database call.

type TermLock = { grading_lock_at?: string | null } | null | undefined;

export type DeadlineSheet = {
  id: string;
  is_locked: boolean;
  unlocked_at?: string | null;
  term?: TermLock | TermLock[];
};

/** Is this loaded sheet past its term's lock time (and not unlocked since)? */
export function sheetPastDeadline(sheet: DeadlineSheet): boolean {
  const term = Array.isArray(sheet.term) ? sheet.term[0] : sheet.term;
  return isPastGradingLock(term?.grading_lock_at ?? null, sheet.unlocked_at);
}

/**
 * Returns true when the sheet is locked — already, or now because its
 * deadline has passed (in which case the stored flag is set and audit-logged).
 */
export async function enforceGradingDeadline(
  service: SupabaseClient,
  sheet: DeadlineSheet
): Promise<boolean> {
  if (sheet.is_locked) return true;
  if (!sheetPastDeadline(sheet)) return false;

  const term = Array.isArray(sheet.term) ? sheet.term[0] : sheet.term;
  const now = new Date().toISOString();
  const { data: locked, error } = await service
    .from('grading_sheets')
    .update({
      is_locked: true,
      locked_at: now,
      locked_by: 'system:grading-deadline',
      updated_at: now,
    })
    .eq('id', sheet.id)
    .eq('is_locked', false)
    .select('id');
  if (error) {
    // Still past the deadline — refuse the write as locked; the cron sets the
    // flag next morning.
    console.error('[grading-deadline] catch-up lock failed:', error.message);
    return true;
  }
  if (locked && locked.length > 0) {
    const labels = await loadOneSheetAuditLabels(service, sheet.id);
    await logAction({
      service,
      actor: { id: null, email: 'system:grading-deadline', role: null },
      action: 'sheet.lock_overdue_batch',
      entityType: 'grading_sheet',
      entityId: sheet.id,
      context: {
        locked_count: 1,
        locked_at: now,
        trigger: 'first_write_after_deadline',
        sheet_ids: [sheet.id],
        sheets: [
          {
            grading_sheet_id: sheet.id,
            ...labels,
            grading_lock_at: term?.grading_lock_at ?? null,
          },
        ],
      },
    });
  }
  return true;
}
