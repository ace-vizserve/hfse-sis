// lib/sis/subjects/weight-defaults.ts
//
// DepEd Order No. 8, s. 2015 WW/PT/QA weight table, keyed by subject CODE
// — verified real HFSE data (see docs/superpowers/specs/2026-07-15-ay-setup-subject-weights-redesign-design.md
// and this session's Filipino/Global Perspectives weight-correction work).
// Weight is a property of the SUBJECT, not the level it's taught at
// (migration 080 collapsed subject_configs off the level dimension — the
// bug this whole model replaces: lib/sis/level-profiles.ts::weightProfileFor
// keyed purely off level TYPE, so Math/English/MAPEH all got the same split
// at a given level type, contradicted by real data).
//
// This is the single production source for BOTH the Subject Setup page's
// create-mode default weights AND the Test seeder's verified seed data —
// one module so the two can never drift.
//
// Three verified buckets:
//   - Math / Science                                    → 40/40/20
//   - MAPEH-family (the consolidated numeric `MAPEH` subject
//     itself + the still-independent letter-graded Christian
//     Living/Contemporary Art/PE+Health/Pastoral — the 4
//     non-examinable codes flipped by migration 049, KD #95,
//     that migration 081 did NOT touch)                  → 20/60/20
//   - everything else (English, Filipino, Mandarin, Social
//     Studies, History, Literature, Humanities,
//     Economics, CCA)                                    → 30/50/20
//
// Pure module, types-only imports — safe from server code, client
// components, and the seeder alike (same guarantee as level-profiles.ts).
import type { WeightFractions } from '@/lib/sis/level-profiles';

const MATH_SCIENCE: WeightFractions = { ww: 0.4, pt: 0.4, qa: 0.2 };
const MAPEH_FAMILY: WeightFractions = { ww: 0.2, pt: 0.6, qa: 0.2 };
const DEFAULT_BUCKET: WeightFractions = { ww: 0.3, pt: 0.5, qa: 0.2 };

const MATH_SCIENCE_CODES = new Set(['MATH', 'SCI']);
const MAPEH_FAMILY_CODES = new Set(['MAPEH', 'CL', 'CA', 'PEH', 'PMPD']);

/** Fractional (0–1) weights — the shape stored in subject_configs and
 * written by the Test seeder. Unrecognised codes fall back to the default
 * bucket; never throws. */
export function weightBucketForSubjectCode(code: string): WeightFractions {
  if (MATH_SCIENCE_CODES.has(code)) return MATH_SCIENCE;
  if (MAPEH_FAMILY_CODES.has(code)) return MAPEH_FAMILY;
  return DEFAULT_BUCKET;
}

/** Integer-percent (0–100) weights for the UI — the Subject Setup page's
 * create-mode pre-fill contract. Every bucket is a multiple of 0.1, so this
 * always converts to clean integers summing to exactly 100 (no rounding
 * drift, no possibility of a mismatched sum). */
export function defaultWeightPercentsForSubjectCode(code: string): {
  ww: number;
  pt: number;
  qa: number;
} {
  const b = weightBucketForSubjectCode(code);
  return {
    ww: Math.round(b.ww * 100),
    pt: Math.round(b.pt * 100),
    qa: Math.round(b.qa * 100),
  };
}
