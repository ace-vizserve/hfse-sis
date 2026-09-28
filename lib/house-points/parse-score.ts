// The score sheet's one text → number rule (components/house-points/
// score-sheet.tsx). Pure, so it is tested without React.
//
// Blank is not zero: an empty box is "no score yet" — no placement, no points —
// while "0" is a real score, ranked like any other. The server holds the same
// line (EntryPatchSchema: `score: null` clears, it never means zero) and has
// the final say on the ceiling; this only lets the sheet say so before a
// request is ever sent.

export type ParsedScore = { value: number | null; error: string | null };

/** Plain decimal only — "1e2" and "0x10" are numbers to JS but not to a teacher. */
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;

export function parseScore(raw: string, max: number): ParsedScore {
  const text = raw.trim();
  if (text === '') return { value: null, error: null };
  if (!DECIMAL.test(text)) {
    return { value: null, error: 'Enter a number, or leave it blank.' };
  }
  const value = Number(text);
  if (value < 0) return { value: null, error: "Score can't be negative." };
  if (value > max) {
    return {
      value: null,
      error: `Score can't be more than ${formatMax(max)}.`,
    };
  }
  return { value, error: null };
}

function formatMax(max: number): string {
  return max.toLocaleString('en-SG', { maximumFractionDigits: 2 });
}
