import { describe, expect, it } from 'vitest';
import { parseT1Writeups } from '@/lib/sis/backfill/evaluation/parse-t1-writeups';

const REAL_FILE =
  'AY2026/T1/Term 1 Grades/AY2026 T1 Student Evaluation_Subject Checklists.xlsx';

describe('parseT1Writeups (real fixture file)', () => {
  it('parses the full file into exactly 392 real write-up rows across 20 recognized sheets, 7 unrecognized', () => {
    const result = parseT1Writeups(REAL_FILE);
    expect(result.rows.length).toBe(392);
    expect(result.sheetStats.length).toBe(20);
    expect(result.unrecognizedSheets.length).toBe(7);
  });

  it('excludes the hidden PTC sheets, the empty Reserved sheets, and the stray xx sheet as unrecognized', () => {
    const result = parseT1Writeups(REAL_FILE);
    expect(result.unrecognizedSheets).toEqual(
      expect.arrayContaining([
        'PTC Checkkist  S1-S4',
        'PTC Checklist P1-P6',
        'SAMPLE HOW TO DO',
        'Reserved 1',
        'Reserved 2',
        'Reserved',
        'xx',
      ])
    );
  });

  it('reconstructs a write-up fragmented across multiple physical rows, in order, space-joined', () => {
    const result = parseT1Writeups(REAL_FILE);
    const row = result.rows.find(
      (r) =>
        r.levelCode === 'P1' &&
        r.sectionName === 'Obedience' &&
        r.sheetIndexNo === '1'
    );
    expect(row?.fullName).toBe('BONIFACIO, Lance Matthew J.');
    expect(row?.writeup).toBe(
      'Lance shows love and dedication to his studies by putting effort into his work and trying to do his best in class. He shows faith by believing in his abilities and continuing to work harder and stay motivated in achieving his goals. He shows hope by staying positive and determined towards his studies. Keep it up1'
    );
  });

  it('reads a single-cell Secondary write-up verbatim (no fragmentation needed)', () => {
    const result = parseT1Writeups(REAL_FILE);
    const row = result.rows.find(
      (r) =>
        r.levelCode === 'S1' &&
        r.sectionName === 'Discipline 1' &&
        r.sheetIndexNo === '1'
    );
    expect(row?.fullName).toBe('BANTA, Stephanie Louise S.');
    expect(row?.writeup).toBe(
      'Stephanie demonstrates the values of faith, hope, and love through her positive attitude and respectful interactions with others. She shows confidence in herself, remains hopeful when facing challenges, and treats those around her with kindness and consideration.'
    );
  });

  it('does not pollute a write-up with the header-repeat text when the identity row itself holds the header label', () => {
    // Sec 4 idx 4 (BARQUILLA): the identity row's own write-up cell holds
    // the literal header text "Student Evaluation write-up: Faith, Hope,
    // Love" instead of real content; her real text is on the next row.
    const result = parseT1Writeups(REAL_FILE);
    const row = result.rows.find(
      (r) =>
        r.levelCode === 'S4' &&
        r.sectionName === 'Excellence' &&
        r.sheetIndexNo === '4'
    );
    expect(row?.fullName).toBe('BARQUILLA, Ziarrah Megan B.');
    expect(row?.writeup).toBe(
      'Megan is a faithful and supportive friend who respects the decisions and opinions of her classmates. She is hopeful about achieving good marks because she consistently exerts effort in her studies. Her positive attitude reflects her determination to improve and succeed. She is loving, amicable, and brings warmth and harmony to the class.'
    );
    expect(row?.writeup).not.toContain('Student Evaluation write-up');
  });

  it('classifies a named identity row with no write-up text as named-blank, not as a real row', () => {
    const result = parseT1Writeups(REAL_FILE);
    const row = result.rows.find(
      (r) =>
        r.levelCode === 'P1' &&
        r.sectionName === 'Patience' &&
        r.sheetIndexNo === '10'
    );
    expect(row).toBeUndefined();
    const stats = result.sheetStats.find(
      (s) => s.levelCode === 'P1' && s.sectionName === 'Patience'
    );
    expect(stats?.namedBlankCount).toBeGreaterThanOrEqual(1);
  });

  it('silently drops unused template rows (no name, no text) without reporting them', () => {
    const result = parseT1Writeups(REAL_FILE);
    const totalNamedBlank = result.sheetStats.reduce(
      (sum, s) => sum + s.namedBlankCount,
      0
    );
    expect(totalNamedBlank).toBe(2);
  });

  it('detects a duplicate index number within a single sheet', () => {
    const result = parseT1Writeups(REAL_FILE);
    const stats = result.sheetStats.find(
      (s) => s.levelCode === 'S2' && s.sectionName === 'Integrity 2'
    );
    expect(stats?.duplicateIndexNotes).toHaveLength(1);
    expect(stats?.duplicateIndexNotes[0]).toContain('index 14');
    expect(stats?.duplicateIndexNotes[0]).toContain('IRAWAN, JOAN JOYLYN');
    expect(stats?.duplicateIndexNotes[0]).toContain(
      'LABANEN, Shannen Marella S.'
    );
  });
});
