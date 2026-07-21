'use client';

import { weightBucketForSubjectCode } from '@/lib/sis/subjects/weight-defaults';
import { cn } from '@/lib/utils';

// Shared weight-profile classification + chip styling for the
// /sis/admin/subjects catalog table — change the recipe here and it
// updates everywhere it's used.
//
// Why light tints over saturated gradients: the cells sit dense on the
// page (a full subject × level matrix), and dense small numerics on
// saturated backgrounds become hard to read. Light bg + dark text +
// colored 2px left bar carries the profile identity without sacrificing
// legibility.

export type WeightProfile = 'correct' | 'custom' | 'invalid';

// Classifies a subject's (ww, pt, qa) integer percentages (0-100) against
// the verified per-subject-code default bucket (lib/sis/subjects/weight-defaults.ts
// — weight is a property of the SUBJECT, not the level it's taught at; see
// that file's header for the three verified buckets). Sum must be exactly
// 100 — `'invalid'` covers any drift, including the rare case where a
// partial DB write left an unbalanced row behind.
export function classifyProfile(
  subjectCode: string,
  ww: number,
  pt: number,
  qa: number
): WeightProfile {
  if (ww + pt + qa !== 100) return 'invalid';
  const expected = weightBucketForSubjectCode(subjectCode);
  const expectedPct = {
    ww: Math.round(expected.ww * 100),
    pt: Math.round(expected.pt * 100),
    qa: Math.round(expected.qa * 100),
  };
  if (ww === expectedPct.ww && pt === expectedPct.pt && qa === expectedPct.qa)
    return 'correct';
  return 'custom';
}

export const PROFILE_LABEL: Record<WeightProfile, string> = {
  correct: 'Correct',
  custom: 'Custom',
  invalid: 'Invalid',
};

const CHIP_BASE = 'border-l-2 shadow-xs';
export const PROFILE_CLASS: Record<WeightProfile, string> = {
  // Healthy state — matches the verified default for this subject.
  // §9.3/§9.1 mint recipe (brand-mint), not one of the two old arbitrary
  // colors: "correct" is now a genuinely positive state, not one of two
  // equally-arbitrary level buckets.
  correct: cn(
    CHIP_BASE,
    'bg-brand-mint/20 border-l-brand-mint hover:bg-brand-mint/30'
  ),
  custom: cn(
    CHIP_BASE,
    'bg-brand-amber/15 border-l-brand-amber hover:bg-brand-amber/25'
  ),
  invalid: cn(
    CHIP_BASE,
    'bg-destructive/10 border-l-destructive hover:bg-destructive/20'
  ),
};

// Inner text colours. Correct/Custom use foreground + muted-foreground.
// Invalid uses destructive ink so the broken state reads as more than
// just "another color tint".
export const PROFILE_TEXT: Record<
  WeightProfile,
  { code: string; ratio: string }
> = {
  correct: { code: 'text-foreground', ratio: 'text-muted-foreground' },
  custom: { code: 'text-foreground', ratio: 'text-muted-foreground' },
  invalid: { code: 'text-destructive', ratio: 'text-destructive/80' },
};

// Legend pill mirroring the cell style — same light tint + colored left
// bar + dark text. Use this instead of `<ChartLegendChip>` when labelling
// these specific cells, so legend ↔ cell visual mapping is 1:1.
export function ProfileLegendChip({
  profile,
  label,
}: {
  profile: WeightProfile;
  label: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em]',
        PROFILE_CLASS[profile],
        PROFILE_TEXT[profile].code
      )}
    >
      {label}
    </span>
  );
}
