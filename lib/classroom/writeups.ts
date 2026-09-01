// Write-up completion rule shared by the classroom Write-ups tab.
//
// KD #120/#126: a write-up counts as done only when `submitted === true` AND
// its content is non-empty — an emptied-but-still-submitted row must not be
// counted as done. Mirrors the exact predicate used by
// lib/evaluation/queries.ts::getWriteupProgressByTerm and the publish-
// readiness comment gate (lib/markbook/comment-completeness.ts) so this
// module's "N of M submitted" figure can never disagree with those.
//
// ⚠ THAT MIRRORING CLAIM WAS FALSE FOR A WHILE, AND THE COMMENT DID NOT NOTICE.
// The write-up column holds formatted text now, so a blank write-up is stored
// as `<p></p>` — seven characters. The gate moved to prose-based emptiness;
// this file kept `writeup.trim().length > 0`, so the two disagreed in exactly
// the case that matters: an adviser who opened the box, typed nothing and
// submitted was "done" here and "missing" at the publish gate. Emptiness is now
// decided by `hasWriteupContent`, the shared KD #120 helper the evaluation
// dashboard and drill also use — one predicate, so the claim above is true by
// construction rather than by inspection.

import { hasWriteupContent } from '@/lib/evaluation/roster-rules';

export type WriteupCompletionInput = {
  submitted: boolean;
  writeup: string | null;
};

export function isWriteupComplete(row: WriteupCompletionInput): boolean {
  return row.submitted && hasWriteupContent(row.writeup);
}
