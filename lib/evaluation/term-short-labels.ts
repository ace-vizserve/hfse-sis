// Pure helper for the per-term write-up progress columns on
// /evaluation/sections (Phase 10, KD #49/#120/#126 — see
// lib/evaluation/queries.ts::getWriteupProgressByTerm for the counting
// rules these columns display).
//
// The columns sit beside Section/Level/Adviser, so the header needs to stay
// compact — "T{n}" rather than the full term label ("Term 1"). This is
// deliberately local and simple, not a general term-abbreviation utility:
// it falls back to the full label only if two terms in the same set would
// otherwise render an identical short label (defensive — term_number is
// unique per AY today, so the fallback branch is a safety net, not the
// normal path).

export type TermLite = {
  id: string;
  label: string;
  term_number: number;
};

export function deriveTermShortLabels(
  terms: readonly TermLite[]
): Record<string, string> {
  const short: Record<string, string> = {};
  for (const t of terms) short[t.id] = `T${t.term_number}`;

  const counts = new Map<string, number>();
  for (const label of Object.values(short)) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  for (const t of terms) {
    if ((counts.get(short[t.id]) ?? 0) > 1) short[t.id] = t.label;
  }

  return short;
}
