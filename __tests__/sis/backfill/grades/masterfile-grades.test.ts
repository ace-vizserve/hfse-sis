import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { parseMasterfileGrades } from '@/lib/sis/backfill/grades/masterfile-grades';

const PRIMARY = 'AY2025 Final Report Book_Primary.xlsx';
const d = existsSync(PRIMARY) ? describe : describe.skip; // fixture is local/gitignored

d('parseMasterfileGrades (primary)', () => {
  const cells = parseMasterfileGrades(PRIMARY);
  it('emits examinable + non-exam cells with the right kinds', () => {
    const david = cells.filter((c) => c.name.startsWith('ASPIRAS, David'));
    const engT1 = david.find((c) => c.subjectCode === 'ENG' && c.term === 1);
    expect(engT1).toMatchObject({
      examinable: true,
      kind: 'numeric',
      numeric: 93,
    });
    expect(engT1!.overall).toBe(93.8);
    const musicT1 = david.find(
      (c) => c.subjectCode === 'MUSIC' && c.term === 1
    );
    expect(musicT1).toMatchObject({
      examinable: false,
      kind: 'letter',
      letter: 'A',
    });
  });
  it('covers all four terms and never emits a blank cell', () => {
    const davidEng = cells.filter(
      (c) => c.name.startsWith('ASPIRAS, David') && c.subjectCode === 'ENG'
    );
    expect(davidEng.map((c) => c.term).sort()).toEqual([1, 2, 3, 4]);
    expect(
      cells.every(
        (c) => c.kind === 'na' || c.numeric !== null || c.letter !== null
      )
    ).toBe(true);
  });
});
