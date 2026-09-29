// A subject's CODE is a stable ID, like a student number (Mr Ace, 2026-09-29:
// "subject name as main and the code is like a student number"). Nobody types
// or edits it: the server derives it from the name when the subject is created
// and it never changes after. People read the NAME; the code is shown small
// and muted beside it.
//
// The rule:
//   - one word  → its first 4 letters, uppercased (Economics → ECON)
//   - several   → the initials of the significant words, ignoring "and",
//                 "&", "of", "the" (Global Perspectives → GP)
//   - letters only (accents folded: Économie → ECON), uppercase
//   - taken     → append 2, 3, … until unique (compared case-insensitively)
//
// The 22 codes that existed before this rule are NOT regenerated — imports,
// the report-card map and several code-keyed rules match on them as written.

const STOP_WORDS = new Set(['and', 'of', 'the']);

/** Fallback when a name has no letters at all (e.g. "123"). */
const FALLBACK_CODE = 'SUBJ';

/** The code a name produces before any collision suffix. */
export function baseSubjectCode(name: string): string {
  const words = name
    .normalize('NFD')
    // Drop the accent marks NFD split off the letters (É becomes E).
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z]+/)
    .filter((w) => w.length > 0);
  const significant = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  // A name made only of stop words ("The And") still gets a code from them.
  const use = significant.length > 0 ? significant : words;
  if (use.length === 0) return FALLBACK_CODE;
  if (use.length === 1) return use[0].slice(0, 4).toUpperCase();
  return use
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** A code for `name` that no code in `existingCodes` already uses. */
export function generateSubjectCode(
  name: string,
  existingCodes: Iterable<string>
): string {
  const taken = new Set<string>();
  for (const c of existingCodes) taken.add(c.trim().toUpperCase());
  const base = baseSubjectCode(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
