import { describe, expect, it } from 'vitest';
import {
  compareLevelLabels,
  levelTypeForAudienceLookup,
  resolveLevelIdFromCatalog,
  type LevelRow,
} from '@/lib/sis/levels';

const LEVELS: LevelRow[] = [
  {
    id: 'p1',
    code: 'P1',
    label: 'Primary One',
    levelType: 'primary',
    sortOrder: 1,
    nextLevelId: null,
    isCore: true,
  },
  {
    id: 's2',
    code: 'S2',
    label: 'Secondary Two',
    levelType: 'secondary',
    sortOrder: 8,
    nextLevelId: null,
    isCore: true,
  },
];
const ALIASES = [
  { raw_label: 'HFSE Global Education Programme – Year 9', level_id: 's2' },
];

describe('resolveLevelIdFromCatalog', () => {
  it('resolves an exact canonical label match', () => {
    expect(resolveLevelIdFromCatalog('Primary One', LEVELS, ALIASES)).toBe(
      'p1'
    );
  });

  it('resolves via the legacy digit-form fallback', () => {
    expect(resolveLevelIdFromCatalog('Primary 1', LEVELS, ALIASES)).toBe('p1');
  });

  it('resolves via an alias when no direct/legacy match exists', () => {
    expect(
      resolveLevelIdFromCatalog(
        'HFSE Global Education Programme – Year 9',
        LEVELS,
        ALIASES
      )
    ).toBe('s2');
  });

  it('returns null when nothing matches', () => {
    expect(
      resolveLevelIdFromCatalog('Youngstarters', LEVELS, ALIASES)
    ).toBeNull();
  });

  it('returns null for null/empty input', () => {
    expect(resolveLevelIdFromCatalog(null, LEVELS, ALIASES)).toBeNull();
    expect(resolveLevelIdFromCatalog('', LEVELS, ALIASES)).toBeNull();
  });

  it('trims whitespace before matching', () => {
    expect(resolveLevelIdFromCatalog('  Primary One  ', LEVELS, ALIASES)).toBe(
      'p1'
    );
  });
});

// `YS` / "Youngstarters" lives in `public.levels` (migration 173) but NOT in
// the ten-entry `LEVEL_CODES` constant, so both helpers below used to answer
// wrong rather than not at all — the failure mode these tests exist to pin.
describe('Youngstarters, a level outside the core catalog', () => {
  it('sorts before Primary One, not after Secondary Four', () => {
    expect(compareLevelLabels('Youngstarters', 'Primary One')).toBeLessThan(0);
    expect(compareLevelLabels('Youngstarters', 'Secondary Four')).toBeLessThan(
      0
    );
    expect(compareLevelLabels('Primary One', 'Youngstarters')).toBeGreaterThan(
      0
    );
  });

  it('orders a mixed list the way a registrar reads it', () => {
    const sorted = [
      'Secondary One',
      'Youngstarters',
      'Primary Two',
      'Primary One',
    ].sort(compareLevelLabels);
    expect(sorted).toEqual([
      'Youngstarters',
      'Primary One',
      'Primary Two',
      'Secondary One',
    ]);
  });

  it('still sorts a genuinely unknown label last', () => {
    const sorted = ['Martian Prep', 'Youngstarters', 'Primary One'].sort(
      compareLevelLabels
    );
    expect(sorted).toEqual(['Youngstarters', 'Primary One', 'Martian Prep']);
  });

  it('resolves an audience level type from its code AND its label', () => {
    // 'primary' matches the live `levels.level_type` — see migration 173 on
    // why production is reproduced rather than the call made in code.
    expect(levelTypeForAudienceLookup('YS')).toBe('primary');
    expect(levelTypeForAudienceLookup('Youngstarters')).toBe('primary');
  });

  it('leaves the core levels and the unknown case exactly as they were', () => {
    expect(levelTypeForAudienceLookup('P1')).toBe('primary');
    expect(levelTypeForAudienceLookup('Secondary Four')).toBe('secondary');
    expect(levelTypeForAudienceLookup('Martian Prep')).toBeNull();
    expect(levelTypeForAudienceLookup(null)).toBeNull();
  });
});
