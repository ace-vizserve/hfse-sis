// Pure, client-safe parser for the entrance-assessment grade columns
// (`ay{yyyy}_enrolment_status.assessmentGradeMath` / `assessmentGradeEnglish`).
//
// Those columns are free text. Most values were typed into Directus's WYSIWYG
// editor, so they arrive wrapped in HTML and in several hand-written shapes:
//
//   '<p>93.55% (29/31)</p>'   percent + score over max
//   '<p>23/31 - 74.19%</p>'   score over max + percent
//   '<p>90.32% 28/31</p>'     percent + score over max, no brackets
//   '<p>6.98%</p>'            percent only
//   '90'                      bare number (read as a percent)
//   '<p>29/31</p>'            score over max only (percent is computed)
//
// Staff record BOTH the percentage and the score over the max score, so the
// parser keeps both halves rather than collapsing to a single number.
//
// Rules, in order:
//   1. Strip HTML tags, decode entities, collapse whitespace.
//   2. Blank after cleaning → all null.
//   3. More than one DIFFERENT percent, or more than one DIFFERENT fraction,
//      in the same value → ambiguous → all null.
//   4. An explicit `NN.NN%` is the percent. Outside 0–100 → all null.
//   5. A fraction `a/b` is kept as score/max when b > 0 and 0 ≤ a ≤ b;
//      otherwise it is dropped (and if there is no explicit percent, the whole
//      value is unparseable → all null).
//   6. No explicit percent but a valid fraction → percent = a / b × 100.
//   7. Neither → the whole cleaned value must be a bare number in 0–100,
//      read as a percent. Anything else (letters, prose, "B+") → all null.
//
// Percents are rounded to 2 decimals. The parser does NOT cross-check an
// explicit percent against its fraction — the typed percent wins, as written.

export type AssessmentGrade = {
  /** Percentage 0–100, rounded to 2 decimals. */
  percent: number | null;
  /** Score obtained, when a `score/max` fraction was written. */
  score: number | null;
  /** Maximum score, when a `score/max` fraction was written. */
  max: number | null;
};

const EMPTY: AssessmentGrade = { percent: null, score: null, max: null };

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  percnt: '%',
  sol: '/',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ' ';
      // Non-breaking space and friends → plain space.
      if (code === 0xa0) return ' ';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? ' ';
  });
}

/** Strip HTML tags + entities and collapse whitespace. Exported for tests. */
export function cleanAssessmentText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ' '))
    .replace(/[\s ]+/g, ' ')
    .trim();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const NUM = String.raw`\d+(?:\.\d+)?`;
// A percent: optional minus directly attached, not preceded by a digit or dot
// (so "31-74.19%" reads 74.19, while "-5%" reads -5 and is rejected).
const PERCENT_RE = new RegExp(String.raw`(?<![\d.])(-?)(${NUM})\s*%`, 'g');
const FRACTION_RE = new RegExp(
  String.raw`(?<![\d.])(-?)(${NUM})\s*/\s*(-?)(${NUM})(?![\d.])`,
  'g'
);
const BARE_RE = new RegExp(String.raw`^${NUM}$`);

function uniqueValues<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const it of items) if (!seen.has(key(it))) seen.set(key(it), it);
  return [...seen.values()];
}

/**
 * Parse a stored assessment grade into `{ percent, score, max }`.
 * Returns all-null for blank or unparseable input — never throws.
 */
export function parseAssessmentGrade(raw: unknown): AssessmentGrade {
  if (raw === null || raw === undefined) return EMPTY;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) return EMPTY;
    return { percent: round2(raw), score: null, max: null };
  }

  if (typeof raw !== 'string') return EMPTY;

  const text = cleanAssessmentText(raw);
  if (!text) return EMPTY;

  // ── Explicit percent(s) ────────────────────────────────────────────────
  const percents = uniqueValues(
    [...text.matchAll(PERCENT_RE)].map((m) => ({
      negative: m[1] === '-',
      value: Number(m[2]),
    })),
    (p) => `${p.negative ? '-' : ''}${p.value}`
  );
  if (percents.length > 1) return EMPTY;

  let percent: number | null = null;
  if (percents.length === 1) {
    const p = percents[0];
    if (p.negative || !Number.isFinite(p.value) || p.value > 100) return EMPTY;
    percent = round2(p.value);
  }

  // ── score/max fraction(s) ──────────────────────────────────────────────
  const fractions = uniqueValues(
    [...text.matchAll(FRACTION_RE)].map((m) => ({
      negative: m[1] === '-' || m[3] === '-',
      score: Number(m[2]),
      max: Number(m[4]),
    })),
    (f) => `${f.negative ? '-' : ''}${f.score}/${f.max}`
  );
  if (fractions.length > 1) return EMPTY;

  let score: number | null = null;
  let max: number | null = null;
  if (fractions.length === 1) {
    const f = fractions[0];
    const valid =
      !f.negative &&
      Number.isFinite(f.score) &&
      Number.isFinite(f.max) &&
      f.max > 0 &&
      f.score >= 0 &&
      f.score <= f.max;
    if (valid) {
      score = f.score;
      max = f.max;
    } else if (percent === null) {
      return EMPTY;
    }
  }

  if (percent !== null) return { percent, score, max };
  if (score !== null && max !== null) {
    return { percent: round2((score / max) * 100), score, max };
  }

  // ── Bare number, read as a percent ─────────────────────────────────────
  if (BARE_RE.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      return { percent: round2(n), score: null, max: null };
    }
  }
  return EMPTY;
}

// ── Display ─────────────────────────────────────────────────────────────────

/**
 * The one way a stored grade is shown on screen and in CSV exports:
 *   score and max known → "93.55% (29/31)"
 *   percent only        → "77%"
 *   unparseable         → the words, HTML stripped ("did not complete")
 *   blank               → null
 * Never returns HTML.
 */
export function formatAssessmentGrade(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const g = parseAssessmentGrade(raw);
  if (g.percent !== null && g.score !== null && g.max !== null) {
    return `${g.percent}% (${g.score}/${g.max})`;
  }
  if (g.percent !== null) return `${g.percent}%`;
  const text =
    typeof raw === 'string' ? cleanAssessmentText(raw) : String(raw).trim();
  return text || null;
}

// ── Pass / fail ─────────────────────────────────────────────────────────────

/** HFSE's entrance-assessment pass mark, in percent (Joann, AY2026 onboarding). */
export const ASSESSMENT_PASS_MARK = 60;

// A bare letter grade, optionally with + or − ("B", "C+", "d-").
const LETTER_RE = /^([ABCDF])[+-]?$/i;

/**
 * Pass / fail / unknown for one stored grade. The percent comes from
 * `parseAssessmentGrade`, so an HTML-wrapped Directus value classifies the
 * same as a plain one. A value that is only a letter grade keeps the old
 * rule: A/B/C pass, D/F fail. Anything else ("na", prose) is unknown.
 */
export function classifyAssessmentGrade(
  raw: unknown
): 'pass' | 'fail' | 'unknown' {
  const { percent } = parseAssessmentGrade(raw);
  if (percent !== null) {
    return percent >= ASSESSMENT_PASS_MARK ? 'pass' : 'fail';
  }
  if (typeof raw !== 'string') return 'unknown';
  const letter = LETTER_RE.exec(cleanAssessmentText(raw))?.[1]?.toUpperCase();
  if (!letter) return 'unknown';
  return letter === 'D' || letter === 'F' ? 'fail' : 'pass';
}

// ── Input: "score out of max" ───────────────────────────────────────────────
//
// The SIS form records a grade as two numbers, Score and Out of, and stores
// exactly `score/max` ("29/31"). The same rules run in the edit dialog and in
// the stage PATCH route, so the two cannot disagree.

export type AssessmentScoreCheck =
  | { ok: true; value: string | null }
  | { ok: false; field: 'score' | 'max'; error: string };

const INPUT_NUM_RE = /^-?\d+(?:\.\d+)?$|^-?\.\d+$/;

function toNumber(text: string): number | null {
  const t = text.trim();
  if (!INPUT_NUM_RE.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Percent for a valid score/max pair, rounded to 2 decimals. */
export function assessmentPercent(score: number, max: number): number {
  return round2((score / max) * 100);
}

/**
 * Validate the two typed boxes. Both blank → a clear (`value: null`).
 * Otherwise both must be numbers, Out of > 0 and 0 ≤ Score ≤ Out of; the
 * stored value is `score/max` with no trailing zeros ("29.50" → "29.5").
 */
export function checkAssessmentScoreInput(
  scoreText: string,
  maxText: string
): AssessmentScoreCheck {
  const scoreBlank = scoreText.trim() === '';
  const maxBlank = maxText.trim() === '';
  if (scoreBlank && maxBlank) return { ok: true, value: null };

  const score = toNumber(scoreText);
  if (score === null) {
    return { ok: false, field: 'score', error: 'Enter the score as a number.' };
  }
  const max = toNumber(maxText);
  if (max === null) {
    return {
      ok: false,
      field: 'max',
      error: 'Enter what the score is out of, as a number.',
    };
  }
  if (max <= 0) {
    return { ok: false, field: 'max', error: 'Out of must be more than 0.' };
  }
  if (score < 0) {
    return { ok: false, field: 'score', error: "The score can't be below 0." };
  }
  if (score > max) {
    return {
      ok: false,
      field: 'score',
      error: "The score can't be higher than the total.",
    };
  }
  return { ok: true, value: `${score}/${max}` };
}

/**
 * Judge one submitted `score/max` value (what the form sends) against what
 * the row already holds.
 *
 * ⚠ ONLY A CHANGE IS JUDGED. A value identical to the stored one is an
 * untouched legacy grade ("<p>93.55% (29/31)</p>", "77%", "na") and passes
 * as-is, so an old Directus value never blocks saving the other assessment
 * fields. `undefined` (not sent) and blank (a clear) pass too.
 */
export function checkAssessmentScoreSubmission(
  submitted: string | null | undefined,
  stored: unknown
): AssessmentScoreCheck {
  if (submitted === undefined) return { ok: true, value: null };
  if (submitted === null || submitted.trim() === '') {
    return { ok: true, value: null };
  }
  if (stored !== null && stored !== undefined && submitted === String(stored)) {
    return { ok: true, value: submitted };
  }
  const parts = submitted.split('/');
  if (parts.length !== 2) {
    return { ok: false, field: 'score', error: 'Enter the score as a number.' };
  }
  return checkAssessmentScoreInput(parts[0], parts[1]);
}
