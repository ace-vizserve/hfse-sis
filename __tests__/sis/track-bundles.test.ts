import { describe, expect, it } from 'vitest';

import {
  resolveTrackBundle,
  subjectCodesForTrack,
  TRACK_BUNDLES,
} from '@/lib/sis/track-bundles';

// Codes minted by migration 082 (subject registry hardening) — verified
// directly against the migration file, not assumed.
const NEW_MIGRATION_082_CODES = ['GP', 'COMP', 'ARTD', 'PESTD'];

// Mother Tongue's real gradable subjects (migration 081) — deliberately
// never bundled, per lib/sis/track-bundles.ts's own header note.
const MOTHER_TONGUE_CODES = ['FIL', 'MANDARIN', 'MT'];

describe('TRACK_BUNDLES / subjectCodesForTrack', () => {
  it('Global bundle matches the plan exactly (8 subjects)', () => {
    expect(subjectCodesForTrack('Global')).toEqual([
      'ENG',
      'MATH',
      'SCI',
      'HUM',
      'GP',
      'COMP',
      'ARTD',
      'PEH',
    ]);
  });

  it('Standard bundle matches the plan exactly (7 subjects, no Mother Tongue)', () => {
    expect(subjectCodesForTrack('Standard')).toEqual([
      'ENG',
      'MATH',
      'SCI',
      'HIST',
      'LIT',
      'CA',
      'PESTD',
    ]);
  });

  it('never includes a Mother Tongue code in either bundle', () => {
    for (const track of ['Global', 'Standard'] as const) {
      for (const mtCode of MOTHER_TONGUE_CODES) {
        expect(subjectCodesForTrack(track)).not.toContain(mtCode);
      }
    }
  });

  it('includes the exact 4 codes migration 082 minted, split correctly by track', () => {
    // Global gets GP/COMP/ARTD/PEH (PEH pre-existing); Standard gets
    // PESTD (the new standalone Secondary PE) and none of the other 3.
    expect(subjectCodesForTrack('Global')).toEqual(
      expect.arrayContaining(['GP', 'COMP', 'ARTD'])
    );
    expect(subjectCodesForTrack('Standard')).not.toEqual(
      expect.arrayContaining(['GP', 'COMP', 'ARTD'])
    );
    expect(subjectCodesForTrack('Standard')).toContain('PESTD');
    expect(subjectCodesForTrack('Global')).not.toContain('PESTD');
  });

  it('every migration-082 code appears in exactly one bundle', () => {
    for (const code of NEW_MIGRATION_082_CODES) {
      const inGlobal = subjectCodesForTrack('Global').includes(code);
      const inStandard = subjectCodesForTrack('Standard').includes(code);
      expect(inGlobal !== inStandard).toBe(true);
    }
  });

  it('neither bundle has duplicate codes', () => {
    for (const track of ['Global', 'Standard'] as const) {
      const codes = subjectCodesForTrack(track);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('TRACK_BUNDLES is keyed by the existing SectionClassType vocabulary (Global/Standard), not a separate track type', () => {
    expect(Object.keys(TRACK_BUNDLES).sort()).toEqual(['Global', 'Standard']);
  });
});

// resolveTrackBundle — Task 3 of the "Unified Subject Setup page" plan:
// the level-aware Standard-bundle fix (HIST at S1/S2, HUM at S3/S4).
describe('resolveTrackBundle', () => {
  it('Standard @ S1 includes HIST, not HUM', () => {
    const bundle = resolveTrackBundle('Standard', 'S1');
    expect(bundle).toContain('HIST');
    expect(bundle).not.toContain('HUM');
  });

  it('Standard @ S2 includes HIST, not HUM', () => {
    const bundle = resolveTrackBundle('Standard', 'S2');
    expect(bundle).toContain('HIST');
    expect(bundle).not.toContain('HUM');
  });

  it('Standard @ S3 includes HUM, not HIST', () => {
    const bundle = resolveTrackBundle('Standard', 'S3');
    expect(bundle).toContain('HUM');
    expect(bundle).not.toContain('HIST');
  });

  it('Standard @ S4 includes HUM, not HIST', () => {
    const bundle = resolveTrackBundle('Standard', 'S4');
    expect(bundle).toContain('HUM');
    expect(bundle).not.toContain('HIST');
  });

  it('Standard @ S3/S4 is otherwise identical to the flat bundle (only the humanities slot swaps)', () => {
    const flat = subjectCodesForTrack('Standard');
    const s3 = resolveTrackBundle('Standard', 'S3');
    expect(s3).toHaveLength(flat.length);
    expect(new Set(s3)).toEqual(
      new Set(flat.map((c) => (c === 'HIST' ? 'HUM' : c)))
    );
  });

  it('Global @ any level is unaffected — same bundle regardless of level code', () => {
    const flat = subjectCodesForTrack('Global');
    for (const levelCode of ['S1', 'S2', 'S3', 'S4', 'P1', '']) {
      expect(resolveTrackBundle('Global', levelCode)).toEqual(flat);
    }
  });

  it('Standard at a non-S3/S4 level (e.g. S1/S2 or an unrecognized code) falls back to the flat HIST bundle', () => {
    expect(resolveTrackBundle('Standard', 'S1')).toEqual(
      subjectCodesForTrack('Standard')
    );
    // Defensive: an unrecognized/empty level code must not silently swap
    // to HUM — only the two verified S3/S4 codes trigger the swap.
    expect(resolveTrackBundle('Standard', '')).toEqual(
      subjectCodesForTrack('Standard')
    );
  });

  it('never includes a Mother Tongue code at any level', () => {
    const MOTHER_TONGUE_CODES = ['FIL', 'MANDARIN', 'MT'];
    for (const track of ['Global', 'Standard'] as const) {
      for (const levelCode of ['S1', 'S2', 'S3', 'S4']) {
        for (const mtCode of MOTHER_TONGUE_CODES) {
          expect(resolveTrackBundle(track, levelCode)).not.toContain(mtCode);
        }
      }
    }
  });
});
