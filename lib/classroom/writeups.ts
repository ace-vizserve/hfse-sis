// Write-up completion rule shared by the classroom Write-ups tab.
//
// KD #120/#126: a write-up counts as done only when `submitted === true` AND
// its content is non-empty — an emptied-but-still-submitted row must not be
// counted as done. Mirrors the exact predicate used by
// lib/evaluation/queries.ts::getWriteupProgressByTerm and the publish-
// readiness comment gate (lib/markbook/comment-completeness.ts) so this
// module's "N of M submitted" figure can never disagree with those.

export type WriteupCompletionInput = {
  submitted: boolean;
  writeup: string | null;
};

export function isWriteupComplete(row: WriteupCompletionInput): boolean {
  return row.submitted && !!row.writeup && row.writeup.trim().length > 0;
}
