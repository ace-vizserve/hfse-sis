'use client';

import { LEVEL_WEIGHT_PROFILES } from '@/lib/sis/level-profiles';
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

export type WeightProfile = 'primary' | 'secondary' | 'custom' | 'invalid';

// Classifies (ww, pt, qa) integer percentages (0-100) into a profile.
// Sum must be exactly 100 — `'invalid'` covers any drift, including the
// rare case where a partial DB write left an unbalanced row behind.
// Percentage (0-100) equivalents of `LEVEL_WEIGHT_PROFILES`, derived once
// at module load so the classifier never drifts from the shared source.
const PRIMARY_PCT = {
  ww: LEVEL_WEIGHT_PROFILES.primary.ww * 100,
  pt: LEVEL_WEIGHT_PROFILES.primary.pt * 100,
  qa: LEVEL_WEIGHT_PROFILES.primary.qa * 100,
};
const SECONDARY_PCT = {
  ww: LEVEL_WEIGHT_PROFILES.secondary.ww * 100,
  pt: LEVEL_WEIGHT_PROFILES.secondary.pt * 100,
  qa: LEVEL_WEIGHT_PROFILES.secondary.qa * 100,
};

export function classifyProfile(
  ww: number,
  pt: number,
  qa: number
): WeightProfile {
  if (ww + pt + qa !== 100) return 'invalid';
  if (ww === PRIMARY_PCT.ww && pt === PRIMARY_PCT.pt && qa === PRIMARY_PCT.qa)
    return 'primary';
  if (
    ww === SECONDARY_PCT.ww &&
    pt === SECONDARY_PCT.pt &&
    qa === SECONDARY_PCT.qa
  )
    return 'secondary';
  return 'custom';
}

export const PROFILE_LABEL: Record<WeightProfile, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  custom: 'Custom',
  invalid: 'Invalid',
};

const CHIP_BASE = 'border-l-2 shadow-xs';
export const PROFILE_CLASS: Record<WeightProfile, string> = {
  primary: cn(CHIP_BASE, 'bg-chart-5/15 border-l-chart-5 hover:bg-chart-5/25'),
  secondary: cn(
    CHIP_BASE,
    'bg-brand-indigo/10 border-l-brand-indigo hover:bg-brand-indigo/20'
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

// Inner text colours. For Primary/Secondary/Custom we use foreground +
// muted-foreground. Invalid uses destructive ink so the broken state
// reads as more than just "another color tint".
export const PROFILE_TEXT: Record<
  WeightProfile,
  { code: string; ratio: string }
> = {
  primary: { code: 'text-foreground', ratio: 'text-muted-foreground' },
  secondary: { code: 'text-foreground', ratio: 'text-muted-foreground' },
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
