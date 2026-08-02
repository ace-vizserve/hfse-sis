// Rendering a set of level codes as something a person reads at a glance.
//
// A subject taught everywhere produces ten codes (P1–P6, S1–S4). Printing all
// ten in a table cell is noise; "P1–P6, S1–S4" is the same fact in a quarter
// of the space, and the gaps are the interesting part — a subject that skips
// P3 should look different from one that doesn't.
//
// Pure and client-safe on purpose: the catalog table is a client component,
// so this cannot live alongside the `server-only` query that feeds it.

/**
 * Sort key for a level code: letter group first (P before S), then the number
 * NUMERICALLY, so P10 would follow P9 rather than P1.
 */
function parseCode(code: string): { prefix: string; n: number } {
  const m = /^([A-Za-z]+)\s*(\d+)$/.exec(code.trim());
  if (!m) return { prefix: code.trim().toUpperCase(), n: Number.NaN };
  return { prefix: m[1].toUpperCase(), n: Number(m[2]) };
}

const PREFIX_ORDER = ['P', 'S'];

function prefixRank(prefix: string): number {
  const i = PREFIX_ORDER.indexOf(prefix);
  return i === -1 ? PREFIX_ORDER.length : i;
}

/**
 * Orders level codes the way a school lists them: Primary before Secondary,
 * then by year number. Exported because anything grouping BY level (the
 * Subject Setup "Used by" panel, for one) has to agree with the span string
 * rendered above it — "P1–P6, S1–S4" over a list starting at S3 would read as
 * a bug.
 */
export function compareLevelCodes(a: string, b: string): number {
  const pa = parseCode(a);
  const pb = parseCode(b);
  const pr = prefixRank(pa.prefix) - prefixRank(pb.prefix);
  if (pr !== 0) return pr;
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  if (Number.isNaN(pa.n) || Number.isNaN(pb.n)) return a.localeCompare(b);
  return pa.n - pb.n;
}

/**
 * "P1, P2, P3, P4, P5, P6" -> "P1–P6"; "P1, P2, S1, S2, S3, S4" ->
 * "P1, P2, S1–S4". Runs of three or more consecutive levels collapse to a
 * range; shorter runs stay listed, because "P4, P5" is no longer than
 * "P4–P5" and reads more plainly.
 *
 * Codes that don't parse (anything not letters-then-digits) are kept verbatim
 * and sorted to the end rather than dropped — a level naming scheme this
 * doesn't anticipate should degrade to "still visible", never to "missing".
 */
export function formatLevelSpan(codes: readonly string[]): string {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) return '';

  const parsed = unique.map((code) => ({ code, ...parseCode(code) }));
  parsed.sort((a, b) => {
    const pr = prefixRank(a.prefix) - prefixRank(b.prefix);
    if (pr !== 0) return pr;
    if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
    if (Number.isNaN(a.n) || Number.isNaN(b.n))
      return a.code.localeCompare(b.code);
    return a.n - b.n;
  });

  const parts: string[] = [];
  let run: typeof parsed = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= 3) {
      parts.push(`${run[0].code}–${run[run.length - 1].code}`);
    } else {
      for (const r of run) parts.push(r.code);
    }
    run = [];
  };

  for (const entry of parsed) {
    if (run.length === 0) {
      run = [entry];
      continue;
    }
    const prev = run[run.length - 1];
    const consecutive =
      entry.prefix === prev.prefix &&
      !Number.isNaN(entry.n) &&
      !Number.isNaN(prev.n) &&
      entry.n === prev.n + 1;
    if (consecutive) run.push(entry);
    else {
      flush();
      run = [entry];
    }
  }
  flush();

  return parts.join(', ');
}
