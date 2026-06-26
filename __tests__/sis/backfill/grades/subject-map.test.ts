import { describe, it, expect } from 'vitest';
import { mapSubjectColumn } from '@/lib/sis/backfill/grades/subject-map';

describe('mapSubjectColumn', () => {
  it('maps examinable columns to codes', () => {
    expect(mapSubjectColumn('ENGLISH')).toEqual({
      code: 'ENG',
      examinable: true,
    });
    expect(mapSubjectColumn('Social Studies')).toEqual({
      code: 'SS',
      examinable: true,
    });
    expect(mapSubjectColumn('MATHEMATICS')).toEqual({
      code: 'MATH',
      examinable: true,
    });
    expect(mapSubjectColumn('HUMANITIES')).toEqual({
      code: 'HUM',
      examinable: true,
    });
  });
  it('maps non-examinable columns', () => {
    expect(mapSubjectColumn('MUSIC EDUCATION')).toEqual({
      code: 'MUSIC',
      examinable: false,
    });
    expect(mapSubjectColumn('PHYSICAL EDUCATION AND HEALTH')).toEqual({
      code: 'PEH',
      examinable: false,
    });
    expect(mapSubjectColumn('CONTEMPORARY ART')).toEqual({
      code: 'CA',
      examinable: false,
    });
  });
  it('is case/space insensitive and flags unmapped', () => {
    expect(mapSubjectColumn('  english ')).toEqual({
      code: 'ENG',
      examinable: true,
    });
    expect(mapSubjectColumn('OVERALL ACADEMIC AWARD')).toBeNull();
    expect(mapSubjectColumn('ATTENDANCE')).toBeNull();
  });
});
