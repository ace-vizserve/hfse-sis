// lib/sis/year-setup.ts
export type AyStatusTone = 'active' | 'early-bird' | 'inactive';

export const AY_STATUS_LABEL: Record<AyStatusTone, string> = {
  active: 'Active year',
  'early-bird': 'Early-bird open',
  inactive: 'Inactive',
};

/**
 * Resolves which AY the control center should show:
 * the requested ?ay= (if it is a real AY) → the active AY → the first AY → null.
 */
export function resolveSelectedAyCode(
  ays: ReadonlyArray<{ ay_code: string; is_current: boolean }>,
  requested: string | undefined
): string | null {
  if (ays.length === 0) return null;
  if (requested && ays.some((a) => a.ay_code === requested)) return requested;
  const active = ays.find((a) => a.is_current);
  return active ? active.ay_code : ays[0].ay_code;
}

export function ayStatusTone(ay: {
  is_current: boolean;
  accepting_applications: boolean;
}): AyStatusTone {
  if (ay.is_current) return 'active';
  if (ay.accepting_applications) return 'early-bird';
  return 'inactive';
}
