import { describe, expect, it } from 'vitest';
import { resolveLevelIdFromCatalog, type LevelRow } from '@/lib/sis/levels';

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
