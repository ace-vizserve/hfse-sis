import { describe, expect, it } from 'vitest';

import { subjectCodesForTrack, TRACK_BUNDLES } from '@/lib/sis/track-bundles';

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
