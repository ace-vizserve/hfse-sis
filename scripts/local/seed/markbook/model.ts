// The markbook phase's generative model: what a class's grading sheets look
// like (slot counts, maxes, exam totals) and what RAW scores its students
// earn. Pure — no database — so the shape can be read and tuned on its own.
//
// ⚠ RAW SCORES ONLY. Nothing here computes a percentage, an initial grade or
// a quarterly grade from scores: the `grade_entries_derive_trg` trigger does
// that on every write (Hard Rule #2). The one numeric grade generated here is
// `importedQuarterly` — the stand-in for a value the AY2025 masterfile import
// (scripts/backfill/ay2025-grades.ts) stored AS A NUMBER on sheets with no
// score slots, exactly as production holds AY2025 Term 4.
//
// Every draw is keyed on stable strings (student number, subject code, AY,
// term, slot), never on a database uuid, so two rebuilds produce the same
// scores even though the rows' ids differ.

import type { Distribution } from '../lib/distribution';
import { pickFrom } from '../lib/distribution';
import { rng, type Rng } from '../lib/random';

/** Standard normal from a seeded stream (Box–Muller). */
export function normal(r: Rng): number {
  const u = Math.max(r.next(), 1e-12);
  const v = r.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Sheet shapes (prod-profile §3-4) ──────────────────────────────────────

/** WW slot counts. AY2025 (imported workbooks) vs AY2026 (in-app). */
export const WW_SLOTS: Record<'AY2025' | 'AY2026', Distribution<number>> = {
  AY2025: [
    [3, 298],
    [4, 60],
    [5, 30],
  ],
  AY2026: [
    [1, 110],
    [2, 327],
    [3, 11],
    [4, 1],
    [5, 47],
  ],
};

export const PT_SLOTS: Record<'AY2025' | 'AY2026', Distribution<number>> = {
  AY2025: [
    [3, 93],
    [4, 16],
    [5, 279],
  ],
  AY2026: [
    [1, 3],
    [2, 24],
    [3, 398],
    [5, 71],
  ],
};

/** Per-slot maximum scores, production's top values. */
export const WW_MAX: Distribution<number> = [
  [10, 932],
  [15, 715],
  [20, 642],
  [30, 13],
  [40, 12],
  [25, 6],
];
export const PT_MAX: Distribution<number> = [
  [10, 1181],
  [20, 894],
  [15, 594],
  [30, 327],
  [25, 325],
  [50, 3],
  [40, 2],
];

/** Exam totals on sheets that have an exam (production's non-null values). */
export const QA_TOTAL: Distribution<number> = [
  [30, 222],
  [50, 170],
  [60, 139],
  [65, 107],
  [20, 98],
  [40, 56],
  [100, 32],
  [80, 27],
  [120, 14],
  [70, 11],
  [180, 6],
  [170, 6],
];

export type SheetShape = {
  ww_totals: number[];
  pt_totals: number[];
  qa_total: number | null;
};

/**
 * One sheet's slots. Within a sheet the maxes mostly repeat (the imported
 * workbooks read [20,20] / [30,30,25]), so each slot keeps the previous
 * slot's max 60% of the time. Slot counts never exceed the subject config's
 * `*_max_slots` — the totals route refuses more, and the import never had more.
 */
export function sheetShape(
  key: string,
  ay: 'AY2025' | 'AY2026',
  maxSlots: { ww: number; pt: number }
): SheetShape {
  const r = rng(`markbook:shape:${key}`);
  const slots = (
    dist: Distribution<number>,
    cap: number,
    maxes: Distribution<number>
  ) => {
    const n = Math.min(cap, pickFrom(r, dist));
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i > 0 && r.chance(0.6) ? out[i - 1] : pickFrom(r, maxes));
    }
    return out;
  };
  return {
    ww_totals: slots(WW_SLOTS[ay], maxSlots.ww, WW_MAX),
    pt_totals: slots(PT_SLOTS[ay], maxSlots.pt, PT_MAX),
    qa_total: pickFrom(r, QA_TOTAL),
  };
}

// ── The students ──────────────────────────────────────────────────────────

/**
 * A child's standing, stable across subjects, terms and years: a strong
 * student is strong everywhere. Keyed on the student number, the one stable
 * id (Hard Rule #4), so a returning child keeps it into the next year.
 */
export function ability(studentNumber: string): number {
  return normal(rng(`markbook:ability:${studentNumber}`));
}

/** How much better or worse than their usual a child does in one subject. */
export function affinity(studentNumber: string, subject: string): number {
  return 0.55 * normal(rng(`markbook:affinity:${studentNumber}:${subject}`));
}

/**
 * Term-to-term movement, per child per term (all subjects together): a
 * gentle swing for everyone, and for about one child-term in 30 a steep fall
 * — the content the at-risk and "dropped since last term" lookups exist for.
 */
export function termSwing(
  studentNumber: string,
  ay: string,
  term: number
): number {
  const r = rng(`markbook:swing:${ay}:${term}:${studentNumber}`);
  const swing = 0.35 * normal(r);
  return r.chance(1 / 30) ? swing - 1.5 : swing;
}

/** The child's level for one subject in one term, roughly standard normal. */
export function latent(
  studentNumber: string,
  subject: string,
  ay: string,
  term: number
): number {
  return (
    0.62 * ability(studentNumber) +
    0.5 * affinity(studentNumber, subject) +
    0.85 * termSwing(studentNumber, ay, term)
  );
}

type Component = 'ww' | 'pt' | 'qa';

/**
 * Fraction of the max a child scores on one assessment: the component's
 * typical mark, moved by the child's level and by the assessment itself (a
 * hard quiz, a bad day), capped at 0..1. The left tail is heavier than the
 * right, as production's is: a task now and then goes badly wrong.
 */
const COMPONENT: Record<
  Component,
  { mid: number; spread: number; slot: number }
> = {
  ww: { mid: 0.885, spread: 0.13, slot: 0.13 },
  pt: { mid: 0.88, spread: 0.105, slot: 0.1 },
  qa: { mid: 0.78, spread: 0.13, slot: 0.07 },
};

export function scoreFraction(c: Component, level: number, r: Rng): number {
  const p = COMPONENT[c];
  let f = p.mid + p.spread * level + p.slot * normal(r);
  if (r.chance(0.06)) f -= 0.3 + 0.35 * r.next(); // a task that went badly
  return Math.min(1, Math.max(0, f));
}

/** Blank (not entered) and zero (took it, scored nothing) rates per slot. */
/**
 * Sporadic blanks per slot, on top of the structural ones (late enrollees,
 * withdrawals): AY2025's imported workbooks ~7% blank all told, AY2026's
 * sheets 2–6%.
 */
export const BLANK_RATE: Record<'AY2025' | 'AY2026', number> = {
  AY2025: 0.03,
  AY2026: 0.017,
};
export const ZERO_RATE = 0.004;
export const QA_BLANK_RATE = 0.02;

/**
 * A raw score out of `max`: null (blank), 0, or a whole number. Whole
 * numbers, as the sheets hold them.
 */
export function rawScore(
  c: Component,
  level: number,
  max: number,
  r: Rng,
  blankRate: number = BLANK_RATE.AY2025
): number | null {
  if (r.chance(c === 'qa' ? QA_BLANK_RATE : blankRate)) return null;
  if (r.chance(ZERO_RATE)) return 0;
  return Math.round(scoreFraction(c, level, r) * max);
}

/**
 * The quarterly grade the AY2025 masterfile import stored as a number on a
 * sheet with no score slots (examinable Term 4). Generated, not computed:
 * there are no scores to compute from — the workbook's own grade was copied.
 * Same child-level model as the scores, on production's AY2025 T4 shape
 * (p05 76 / p50 91 / p95 97, ~3% under 75) — a long tail below, a cap above.
 */
export function importedQuarterly(level: number, r: Rng): number {
  const lift = level < 0 ? 12 * level : 5 * level;
  const q = Math.round(91 + lift + 1.2 * normal(r));
  return Math.min(100, Math.max(60, q));
}

/**
 * A non-examinable subject's term mark, as the AY2025 import stored it: the
 * masterfile letter turned into its band's representative number
 * (lib/sis/backfill/grades/representative-numeric.ts). The letter comes from
 * the child's level.
 */
export function nonExamLetter(level: number): 'A' | 'B' | 'C' | 'IP' {
  if (level > -0.1) return 'A';
  if (level > -0.9) return 'B';
  if (level > -1.5) return 'C';
  return 'IP';
}
