import { isEmptyRichText } from '@/lib/rich-text';
import type { StageColumns } from '@/lib/schemas/sis';

/**
 * What a stage row will HOLD once the incoming edit has been saved.
 *
 * The completion gate (`findStageCompletionBlockers`, lib/schemas/sis.ts) asks
 * whether a stage is complete. It deliberately asks that of the record as it
 * will BE, not of the edit that was sent — so the caller has to merge the
 * payload over the stored row first. That merge is what this function is.
 *
 * WHY THE MERGE IS THE POINT, AND NOT AN IMPLEMENTATION DETAIL. Many records
 * already sit at a finished status with the fields behind them blank. Checking
 * the merged row means someone editing only the Remarks on a record whose
 * invoice was never filled in is refused — the record is incomplete, and the
 * refusal describes the record rather than the keystroke. That is the intent
 * (Mr Ace, explicit: the school asked for the enforcement), not a side effect,
 * and it is how the existing backlog gets cleared: each record is completed
 * the next time anyone touches it.
 *
 * Blank handling matches how the route WRITES, so the gate can never disagree
 * with what lands in the table:
 *   - a key the payload never mentions keeps its stored value (the route only
 *     sets `update[columnName]` when the value is not `undefined`);
 *   - an empty string in the payload is a CLEAR — the route writes `null` for
 *     it, so the gate must treat it as blank and refuse, rather than quietly
 *     letting a required field be emptied;
 *   - an explicit `null` is the same clear, spelled differently.
 *
 * Pure: no I/O, no dates, no randomness. Shared by the stage PATCH route and
 * its test so the two cannot drift.
 */
export function resolveEffectiveStageValues(
  /** The stage's column mapping — STAGE_COLUMN_MAP[stageKey]. */
  cols: StageColumns,
  /** The pre-image of the row, keyed by DATABASE COLUMN NAME. */
  storedRow: Record<string, unknown>,
  /** The status from the payload. `undefined` means the key was not supplied. */
  payloadStatus: string | null | undefined,
  /** The extras from the payload, keyed by fieldKey. */
  payloadExtras: Record<string, string | null> | undefined
): { status: string | null; extras: Record<string, string | null> } {
  const status =
    payloadStatus !== undefined
      ? normaliseBlank(payloadStatus)
      : normaliseBlank(storedRow[cols.statusCol]);

  const extras: Record<string, string | null> = {};
  for (const e of cols.extras) {
    const supplied = payloadExtras?.[e.fieldKey];
    extras[e.fieldKey] =
      supplied !== undefined
        ? normaliseBlank(supplied)
        : normaliseBlank(storedRow[e.columnName]);
  }

  return { status, extras };
}

/** Empty (or whitespace-only) reads as "not filled in", the same way the route
 *  writes `''` as `null`. Non-strings are coerced rather than thrown over — a
 *  save is not the place to blow up on a surprising column type.
 *
 *  ⚠ "Empty" is measured on the words, because some stage extras are prose
 *  typed in a formatting editor and a stored `<p></p>` is not something a
 *  person filled in. This merge feeds `findStageCompletionBlockers`, so the two
 *  have to agree about what blank means — if this said "filled" and the gate
 *  said "blank", a record could never be saved. */
function normaliseBlank(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  return isEmptyRichText(text) ? null : text;
}
