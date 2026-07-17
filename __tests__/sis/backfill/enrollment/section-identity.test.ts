import { describe, expect, it } from 'vitest';

import { deriveSectionIdentity } from '@/lib/sis/backfill/enrollment/section-identity';

describe('deriveSectionIdentity', () => {
  it('strips a trailing "(G)" annotation with no leading space', () => {
    expect(deriveSectionIdentity('P1 Patience(G)')).toEqual({
      kind: 'core',
      levelCode: 'P1',
      cleanName: 'Patience',
    });
  });

  it('strips a trailing "(AM Global)"-style annotation with a leading space', () => {
    expect(deriveSectionIdentity('P2 Honesty (G)')).toEqual({
      kind: 'core',
      levelCode: 'P2',
      cleanName: 'Honesty',
    });
  });

  it('leaves a plain section name untouched', () => {
    expect(deriveSectionIdentity('P1 Obedience')).toEqual({
      kind: 'core',
      levelCode: 'P1',
      cleanName: 'Obedience',
    });
  });

  it('handles multi-token clean names', () => {
    expect(deriveSectionIdentity('S1 Discipline 1 (G)')).toEqual({
      kind: 'core',
      levelCode: 'S1',
      cleanName: 'Discipline 1',
    });
    expect(deriveSectionIdentity('S1 Discipline 2')).toEqual({
      kind: 'core',
      levelCode: 'S1',
      cleanName: 'Discipline 2',
    });
  });

  it('handles secondary levels S1-S4', () => {
    expect(deriveSectionIdentity('S4 Excellence')).toEqual({
      kind: 'core',
      levelCode: 'S4',
      cleanName: 'Excellence',
    });
  });

  it('flags the YS sheet distinctly', () => {
    expect(deriveSectionIdentity('YS')).toEqual({ kind: 'ys' });
  });

  it('flags an unrecognized sheet name', () => {
    expect(deriveSectionIdentity('Reserved 1')).toEqual({
      kind: 'unrecognized',
      rawSheetName: 'Reserved 1',
    });
  });
});
