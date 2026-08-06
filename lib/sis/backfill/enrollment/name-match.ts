// lib/sis/backfill/enrollment/name-match.ts
// Pure name-matching logic for the AY2026 T1 enrollment import — and its
// planned T2/T3 reruns (per the design doc, this matcher gets reused when
// later terms are diffed against the roster this establishes). No I/O.

export type MatchTier = 'exact' | 'strong' | 'fuzzy' | 'none';

export interface SheetName {
  lastName: string;
  firstMiddle: string;
}

export interface CandidateName {
  enroleeNumber: string;
  studentNumber: string | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
}

export interface MatchResult {
  tier: MatchTier;
  candidate: CandidateName | null;
  score: number;
}

// Accents are stripped before comparison: HFSE's rosters and the workbooks
// teachers keep disagree about them freely, and the same child is written
// "Iñigo" in one place and "Inigo" in the other, "TRAQUEÑA" and "Traquena".
// Both were real misses on the house import. Decomposing to NFD and dropping
// the combining marks turns Ñ into N, é into e, and so on.
//
// This only ever WIDENS matching, and it cannot silently pick a wrong record:
// matchName still refuses when more than one candidate looks equally right.
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

// Parses a workbook "Full Name" cell of the form "LASTNAME, First Middle."
// into { lastName, firstMiddle }. Cells without a comma fall back to
// treating the whole string as the last name.
export function parseSheetFullName(fullName: string): SheetName {
  const idx = fullName.indexOf(',');
  if (idx === -1) {
    return { lastName: fullName.trim(), firstMiddle: '' };
  }
  return {
    lastName: fullName.slice(0, idx).trim(),
    firstMiddle: fullName.slice(idx + 1).trim(),
  };
}

// True if `short` is a single-letter initial of `long` (e.g. "C" of "CABRERA").
function isInitialOf(short: string, long: string): boolean {
  return short.length === 1 && long.length > 0 && long[0] === short;
}

// Compares two token lists position-by-position. 'exact' if every token
// matches verbatim and the lists are the same length. 'strong' if the
// primary first-name token (position 0) matches EXACTLY — an initial-only
// match there is too weak a signal to auto-accept on its own — every other
// aligned position matches verbatim or by initial, and any leftover
// trailing tokens on either side are simply unexplained (typically a
// middle name present on one side and omitted on the other). Otherwise
// null.
//
// The "any leftover trailing tokens" tolerance is deliberately NOT capped
// at a fixed count: capping it (e.g. "at most 1 extra token") would let a
// 1-word-middle-name candidate auto-resolve while an otherwise-identical
// 2-word-middle-name candidate for the same first name got rejected purely
// by coincidence of word count, silently breaking a real ambiguous case
// (see the "equally ambiguous" test below) instead of flagging it. Callers
// (matchName) still catch true ambiguity by requiring exactly one 'strong'
// candidate among same-surname matches.
function compareTokens(a: string[], b: string[]): 'exact' | 'strong' | null {
  if (a.length === 0 && b.length === 0) return 'exact';
  if (a.length === 0 || b.length === 0) return null;
  if (a[0] !== b[0]) return null;
  const minLen = Math.min(a.length, b.length);
  for (let i = 1; i < minLen; i++) {
    if (a[i] !== b[i] && !isInitialOf(a[i], b[i]) && !isInitialOf(b[i], a[i])) {
      return null;
    }
  }
  if (a.length === b.length && a.join(' ') === b.join(' ')) return 'exact';
  return 'strong';
}

// Levenshtein-based similarity ratio in [0, 1]; 1 = identical (after
// normalization). Deliberately dependency-free — good enough for the
// narrow "is this a typo of the same name" fuzzy tier.
export function similarityRatio(a: string, b: string): number {
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (s1 === s2) return 1;
  const m = s1.length;
  const n = s2.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] =
        s1[i - 1] === s2[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  const distance = dp[n];
  return 1 - distance / Math.max(m, n);
}

const FUZZY_THRESHOLD = 0.9;

// Matches one workbook roster name against a pool of admissions candidates.
// Callers are responsible for pre-filtering the pool (e.g. excluding
// Cancelled/Withdrawn applications) before calling this.
export function matchName(
  sheetName: SheetName,
  candidates: CandidateName[]
): MatchResult {
  const sheetLastNorm = normalize(sheetName.lastName);
  const sheetTokens = tokenize(sheetName.firstMiddle);

  const sameLast = candidates.filter(
    (c) => normalize(c.lastName) === sheetLastNorm
  );

  const structured: { candidate: CandidateName; tier: 'exact' | 'strong' }[] =
    [];
  for (const c of sameLast) {
    const candTokens = tokenize(`${c.firstName} ${c.middleName ?? ''}`.trim());
    const cmp = compareTokens(sheetTokens, candTokens);
    if (cmp) structured.push({ candidate: c, tier: cmp });
  }
  const exact = structured.filter((s) => s.tier === 'exact');
  if (exact.length === 1) {
    return { tier: 'exact', candidate: exact[0].candidate, score: 1 };
  }
  if (exact.length > 1) {
    // Ambiguous — more than one same-surname candidate is a byte-identical
    // exact match (e.g. duplicate/legacy admissions records for a common
    // name). Same guard as the 'strong' tier below, one tier up.
    return { tier: 'none', candidate: null, score: 0 };
  }

  const strong = structured.filter((s) => s.tier === 'strong');
  if (strong.length === 1) {
    return { tier: 'strong', candidate: strong[0].candidate, score: 1 };
  }
  if (strong.length > 1) {
    // Ambiguous — more than one same-surname candidate looks equally right.
    return { tier: 'none', candidate: null, score: 0 };
  }

  // Fuzzy pass — across the whole pool, in case of a last-name typo too.
  const sheetFull = `${sheetName.lastName} ${sheetName.firstMiddle}`;
  let best: { candidate: CandidateName; score: number } | null = null;
  let secondBestScore = 0;
  for (const c of candidates) {
    const candFull = `${c.lastName} ${c.firstName} ${c.middleName ?? ''}`;
    const score = similarityRatio(sheetFull, candFull);
    if (!best || score > best.score) {
      secondBestScore = best?.score ?? 0;
      best = { candidate: c, score };
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }
  if (
    best &&
    best.score >= FUZZY_THRESHOLD &&
    secondBestScore < FUZZY_THRESHOLD
  ) {
    return { tier: 'fuzzy', candidate: best.candidate, score: best.score };
  }
  return { tier: 'none', candidate: null, score: best?.score ?? 0 };
}
