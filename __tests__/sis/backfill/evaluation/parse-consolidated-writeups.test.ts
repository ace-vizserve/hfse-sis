import { describe, expect, it } from 'vitest';
import {
  parseSheetIdentity,
  parseConsolidatedWriteups,
} from '@/lib/sis/backfill/evaluation/parse-consolidated-writeups';

const REAL_FILE = 'AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx';

describe('parseSheetIdentity', () => {
  it('parses a plain Primary sheet name', () => {
    expect(parseSheetIdentity('P1-Patience')).toEqual({
      levelCode: 'P1',
      sectionName: 'Patience',
    });
  });

  it('parses a Primary sheet name with a space separator instead of a hyphen', () => {
    expect(parseSheetIdentity('P6 Grit')).toEqual({
      levelCode: 'P6',
      sectionName: 'Grit',
    });
  });

  it('parses a Secondary Regular-track sheet name', () => {
    expect(parseSheetIdentity('S1-Discipline 2')).toEqual({
      levelCode: 'S1',
      sectionName: 'Discipline 2',
    });
  });

  it('parses a Secondary Global-track sheet name and strips the (G) marker', () => {
    expect(parseSheetIdentity('S1-Discipline 1 (G)')).toEqual({
      levelCode: 'S1',
      sectionName: 'Discipline 1',
    });
  });

  it('parses a hyphen-with-spaces separator', () => {
    expect(parseSheetIdentity('S4 - Excellence')).toEqual({
      levelCode: 'S4',
      sectionName: 'Excellence',
    });
  });

  it('returns null for a name that does not match the pattern', () => {
    expect(parseSheetIdentity('Cover Page')).toBeNull();
  });
});

describe('parseConsolidatedWriteups (real fixture file)', () => {
  it('parses the real consolidated form into exactly 390 non-blank write-up rows across 23 recognized sheets, 0 unrecognized', () => {
    const result = parseConsolidatedWriteups(REAL_FILE);
    expect(result.rows.length).toBe(390);
    expect(result.blankCounts.length).toBe(23);
    expect(result.unrecognizedSheets).toEqual([]);
  });

  it('reports the exact blank-cell count for the three ex-Reserved Primary sections', () => {
    const result = parseConsolidatedWriteups(REAL_FILE);
    const find = (levelCode: string, sectionName: string) =>
      result.blankCounts.find(
        (b) => b.levelCode === levelCode && b.sectionName === sectionName
      );
    expect(find('P1', 'Respect')?.blankCount).toBe(12);
    expect(find('P2', 'Gentleness')?.blankCount).toBe(10);
    expect(find('P4', 'Compassion')?.blankCount).toBe(21);
  });

  it('extracts a real, known write-up verbatim', () => {
    const result = parseConsolidatedWriteups(REAL_FILE);
    const row = result.rows.find(
      (r) =>
        r.levelCode === 'S1' &&
        r.sectionName === 'Discipline 1' &&
        r.indexNo === '1'
    );
    expect(row?.fullName).toBe('BANTA, Stephanie Louise S.');
    expect(row?.writeup).toBe(
      'Stephanie shows consideration for others and is respectful in daily interactions. She approaches learning tasks with commitment and can be trusted to follow instructions carefully.'
    );
  });
});
