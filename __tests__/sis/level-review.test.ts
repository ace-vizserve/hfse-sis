import { describe, expect, it } from 'vitest';

import {
  diffUnmatchedLevelLabels,
  type ObservedLevelLabel,
} from '@/lib/sis/level-review';
import { LEVEL_LABELS } from '@/lib/sis/levels';

// The real `public.levels.label` set — reusing the canonical constants
// keeps this test honest to what the DB actually stores (KD #144 / migration
// 029 word-form labels).
const KNOWN_LABELS = Object.values(LEVEL_LABELS);

describe('diffUnmatchedLevelLabels', () => {
  it('flags a GEP-style descriptive label as unmatched', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel:
          'HFSE Global Education Programme – Year 2 (equivalent to Primary One)',
        ayCode: 'AY2027',
        appsCount: 2,
        statusCount: 1,
        sampleEnrolees: ['E-0001', 'E-0002'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rawLabel:
        'HFSE Global Education Programme – Year 2 (equivalent to Primary One)',
      appsCount: 2,
      statusCount: 1,
      ayCodes: ['AY2027'],
    });
  });

  it('flags a Youngstarters spelling variant as unmatched', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'YoungStarter Junior Star',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 1,
        sampleEnrolees: ['E-0003'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(1);
    expect(result[0].rawLabel).toBe('YoungStarter Junior Star');
    // Not a known legacy digit-form, so canonicalizeLevelLabel passes it
    // through unchanged — the canonical label equals the raw label here.
    expect(result[0].canonicalLabel).toBe('YoungStarter Junior Star');
  });

  it('does NOT flag a legacy digit-form label — canonicalizeLevelLabel folds it onto "Primary One"', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'Primary 1',
        ayCode: 'AY2027',
        appsCount: 5,
        statusCount: 5,
        sampleEnrolees: ['E-0004'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(0);
  });

  it('given the brief scenario together, only the GEP + spelling-variant labels surface', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel:
          'HFSE Global Education Programme – Year 2 (equivalent to Primary One)',
        ayCode: 'AY2027',
        appsCount: 2,
        statusCount: 1,
        sampleEnrolees: ['E-0001'],
      },
      {
        rawLabel: 'YoungStarter Junior Star',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 1,
        sampleEnrolees: ['E-0002'],
      },
      {
        rawLabel: 'Primary 1',
        ayCode: 'AY2027',
        appsCount: 5,
        statusCount: 5,
        sampleEnrolees: ['E-0003'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result.map((r) => r.rawLabel).sort()).toEqual(
      [
        'HFSE Global Education Programme – Year 2 (equivalent to Primary One)',
        'YoungStarter Junior Star',
      ].sort()
    );
  });

  it('merges the same raw label observed in multiple AYs — sums counts, unions ayCodes, dedupes sample enrolees', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'YoungStarter Junior Star',
        ayCode: 'AY2026',
        appsCount: 1,
        statusCount: 0,
        sampleEnrolees: ['E-0001'],
      },
      {
        rawLabel: 'YoungStarter Junior Star',
        ayCode: 'AY2027',
        appsCount: 2,
        statusCount: 1,
        sampleEnrolees: ['E-0001', 'E-0002'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(1);
    expect(result[0].ayCodes.slice().sort()).toEqual(['AY2026', 'AY2027']);
    expect(result[0].appsCount).toBe(3);
    expect(result[0].statusCount).toBe(1);
    // E-0001 appears in both observations — must not be duplicated.
    expect(result[0].sampleEnrolees).toEqual(['E-0001', 'E-0002']);
  });

  it('does not duplicate an ayCode when the same raw label + AY pair is observed more than once', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'YoungStarter Junior Star',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 0,
        sampleEnrolees: ['E-0001'],
      },
      {
        rawLabel: 'YoungStarter Junior Star',
        ayCode: 'AY2027',
        appsCount: 3,
        statusCount: 2,
        sampleEnrolees: ['E-0005'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(1);
    expect(result[0].ayCodes).toEqual(['AY2027']);
    expect(result[0].appsCount).toBe(4);
    expect(result[0].statusCount).toBe(2);
    expect(result[0].sampleEnrolees).toEqual(['E-0001', 'E-0005']);
  });

  it('caps sampleEnrolees at 5 when a single observation exceeds the cap', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'Some Unknown Level',
        ayCode: 'AY2027',
        appsCount: 6,
        statusCount: 0,
        sampleEnrolees: ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(1);
    expect(result[0].sampleEnrolees).toEqual([
      'E-1',
      'E-2',
      'E-3',
      'E-4',
      'E-5',
    ]);
  });

  it('stops adding sample enrolees once the cap is already reached while merging a later AY', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'Some Unknown Level',
        ayCode: 'AY2026',
        appsCount: 5,
        statusCount: 0,
        sampleEnrolees: ['E-1', 'E-2', 'E-3', 'E-4', 'E-5'],
      },
      {
        rawLabel: 'Some Unknown Level',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 0,
        sampleEnrolees: ['E-6', 'E-7'],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result).toHaveLength(1);
    // Already at the cap from the first AY — none of E-6/E-7 get appended.
    expect(result[0].sampleEnrolees).toEqual([
      'E-1',
      'E-2',
      'E-3',
      'E-4',
      'E-5',
    ]);
    expect(result[0].appsCount).toBe(6);
  });

  it('ignores a blank/whitespace-only observed label', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: '   ',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 0,
        sampleEnrolees: [],
      },
    ];

    expect(diffUnmatchedLevelLabels(observed, KNOWN_LABELS)).toEqual([]);
  });

  it('returns an empty array when there are no observations', () => {
    expect(diffUnmatchedLevelLabels([], KNOWN_LABELS)).toEqual([]);
  });

  it('sorts results alphabetically by rawLabel', () => {
    const observed: ObservedLevelLabel[] = [
      {
        rawLabel: 'Zeta Unknown Level',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 0,
        sampleEnrolees: [],
      },
      {
        rawLabel: 'Alpha Unknown Level',
        ayCode: 'AY2027',
        appsCount: 1,
        statusCount: 0,
        sampleEnrolees: [],
      },
    ];

    const result = diffUnmatchedLevelLabels(observed, KNOWN_LABELS);

    expect(result.map((r) => r.rawLabel)).toEqual([
      'Alpha Unknown Level',
      'Zeta Unknown Level',
    ]);
  });
});
