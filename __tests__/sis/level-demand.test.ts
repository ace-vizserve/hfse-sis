import { describe, expect, it } from 'vitest';
import { computeLevelDemand } from '@/lib/sis/level-demand';
import type { LevelRow } from '@/lib/sis/levels';

// Local factory mirroring the LevelRow shape — only the fields the demand
// helper actually reads are populated meaningfully; the rest are filler.
function lvl(
  code: string,
  label: string,
  isCore: boolean,
  overrides: Partial<LevelRow> = {}
): LevelRow {
  return {
    id: `id-${code}`,
    code,
    label,
    levelType: isCore ? 'primary' : 'secondary',
    sortOrder: 0,
    nextLevelId: null,
    isCore,
    ...overrides,
  };
}

describe('computeLevelDemand', () => {
  it('counts applicants per canonical label and flags un-offered levels', () => {
    const levels = [
      lvl('P3', 'Primary Three', true),
      lvl('CS1', 'Cambridge Stage 1', false),
    ];
    const offered = new Set([levels[0].id]); // CS1 not offered

    const rows = computeLevelDemand(
      [
        { levelApplied: 'Primary 3' },
        { levelApplied: 'Cambridge Stage 1' },
        { levelApplied: 'Cambridge Stage 1' },
        { levelApplied: null },
      ],
      levels,
      offered
    );

    expect(rows).toContainEqual({
      label: 'Primary Three',
      levelId: levels[0].id,
      count: 1,
      offered: true,
    });
    expect(rows).toContainEqual({
      label: 'Cambridge Stage 1',
      levelId: levels[1].id,
      count: 2,
      offered: false,
    });
  });

  it('unknown labels surface with levelId null and offered false', () => {
    const levels = [lvl('P3', 'Primary Three', true)];
    const offered = new Set([levels[0].id]);

    const rows = computeLevelDemand(
      [{ levelApplied: 'Grade 99' }],
      levels,
      offered
    );

    expect(rows).toContainEqual({
      label: 'Grade 99',
      levelId: null,
      count: 1,
      offered: false,
    });
  });

  it('empty input returns an empty array', () => {
    const levels = [lvl('P3', 'Primary Three', true)];
    const offered = new Set([levels[0].id]);
    expect(computeLevelDemand([], levels, offered)).toEqual([]);
  });

  it('canonicalizes legacy digit labels to the word form before counting', () => {
    const levels = [lvl('P3', 'Primary Three', true)];
    const offered = new Set([levels[0].id]);

    const rows = computeLevelDemand(
      [{ levelApplied: 'Primary 3' }, { levelApplied: 'Primary Three' }],
      levels,
      offered
    );

    expect(rows).toEqual([
      {
        label: 'Primary Three',
        levelId: levels[0].id,
        count: 2,
        offered: true,
      },
    ]);
  });

  it('skips null and empty-string levelApplied values', () => {
    const levels = [lvl('P3', 'Primary Three', true)];
    const offered = new Set([levels[0].id]);

    const rows = computeLevelDemand(
      [{ levelApplied: null }, { levelApplied: '' }, { levelApplied: '   ' }],
      levels,
      offered
    );

    expect(rows).toEqual([]);
  });

  it('a known level whose id is absent from offeredIds is flagged un-offered', () => {
    // computeLevelDemand trusts offeredIds as given — baking in "core levels
    // are always offered" is getOfferedLevelIds's job (it seeds the set with
    // every core id), not this pure function's.
    const levels = [lvl('P3', 'Primary Three', true)];
    const offered = new Set<string>(); // deliberately empty
    const rows = computeLevelDemand(
      [{ levelApplied: 'Primary Three' }],
      levels,
      offered
    );
    expect(rows).toEqual([
      {
        label: 'Primary Three',
        levelId: levels[0].id,
        count: 1,
        offered: false,
      },
    ]);
  });
});
