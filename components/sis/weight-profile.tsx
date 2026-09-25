'use client';

import { weightBucketForSubjectCode } from '@/lib/sis/subjects/weight-defaults';
import { cn } from '@/lib/utils';

// Shared weight-profile classification + paint for the /sis/admin/subjects
// catalog table. The bar's segments and the colour key both read from
// PROFILE_SEGMENTS below, so the key can never drift from what it explains
// (design system §10.2).
//
// The weights render as a bar split WW / PT / QA in proportion, not as a
// number string: two subjects weighted differently LOOK different, which is
// what someone scanning the table is checking for.

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
  correct: 'Standard weights',
  custom: 'Custom',
  invalid: "Doesn't add to 100",
};

// One hue per profile, three strengths so WW / PT / QA stay distinguishable
// inside a single bar. Written out in full because Tailwind only compiles
// class names it can find literally.
//   correct → mint (§9.1 healthy), custom → amber (look twice),
//   invalid → destructive (broken).
const PROFILE_SEGMENTS: Record<WeightProfile, [string, string, string]> = {
  correct: ['bg-brand-mint', 'bg-brand-mint/60', 'bg-brand-mint/30'],
  custom: ['bg-brand-amber', 'bg-brand-amber/60', 'bg-brand-amber/30'],
  invalid: ['bg-destructive', 'bg-destructive/60', 'bg-destructive/30'],
};

const COMPONENTS = ['WW', 'PT', 'QA'] as const;

export function ProfileWeightBar({
  profile,
  ww,
  pt,
  qa,
}: {
  profile: WeightProfile;
  ww: number;
  pt: number;
  qa: number;
}) {
  const values = [ww, pt, qa];
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex w-52 max-w-full flex-col gap-1"
        aria-label={`Written work ${ww}%, performance tasks ${pt}%, quarterly assessment ${qa}%`}
      >
        <div className="flex h-2.5 gap-0.5" aria-hidden="true">
          {values.map((v, i) =>
            v > 0 ? (
              <span
                key={COMPONENTS[i]}
                className={cn(
                  'h-full rounded-[2px]',
                  PROFILE_SEGMENTS[profile][i]
                )}
                style={{ flexGrow: v, flexBasis: 0 }}
              />
            ) : null
          )}
        </div>
        <div
          className="flex gap-0.5 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground"
          aria-hidden="true"
        >
          {values.map((v, i) =>
            v > 0 ? (
              <span
                key={COMPONENTS[i]}
                className="overflow-hidden whitespace-nowrap"
                style={{ flexGrow: v, flexBasis: 0 }}
              >
                {COMPONENTS[i]} <span className="text-foreground">{v}</span>
              </span>
            ) : null
          )}
        </div>
      </div>
      {profile === 'custom' && (
        <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-amber bg-brand-amber/15">
          Custom
        </span>
      )}
      {profile === 'invalid' && (
        <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-destructive bg-destructive/10">
          ≠ 100
        </span>
      )}
    </div>
  );
}

// The colour key's swatch — the first (strongest) segment of the same map the
// bars use, so the key is pixel-identical to what it documents.
export function ProfileKeySwatch({ profile }: { profile: WeightProfile }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('h-2 w-4 rounded-[2px]', PROFILE_SEGMENTS[profile][0])}
        aria-hidden="true"
      />
      {PROFILE_LABEL[profile]}
    </span>
  );
}
