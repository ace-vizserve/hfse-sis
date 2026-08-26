import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  adviserFromCell,
  classTokensIn,
  deriveClassIdentity,
  normaliseNickname,
  parseClassMajorSheet,
  splitSubjectTeacher,
} from '@/lib/sis/backfill/deployment/workbook';

// Regression tests for the teacher-deployment workbook parser.
//
// Every case below is a REAL cell from
// "Teachers Deployment_Updated 29 Jun 26_Teacherscopy (1).xlsx", and the three
// `describe` blocks each pin a bug that actually shipped a wrong reading of
// that file. They are not hypotheticals — see the comments.

describe('splitSubjectTeacher', () => {
  it('splits the newline form, which is the common one', () => {
    expect(splitSubjectTeacher('Science\r\nMs Tina')).toEqual({
      kind: 'ok',
      subject: 'Science',
      teacher: 'Ms Tina',
    });
  });

  it('splits a one-line cell at the title', () => {
    expect(splitSubjectTeacher('Humanities Ms.Elaine')).toEqual({
      kind: 'ok',
      subject: 'Humanities',
      teacher: 'Ms.Elaine',
    });
  });

  it('keeps a multi-word subject intact before the title', () => {
    expect(
      splitSubjectTeacher('Physical Education and Health Mr Hanafi')
    ).toEqual({
      kind: 'ok',
      subject: 'Physical Education and Health',
      teacher: 'Mr Hanafi',
    });
  });

  it('treats "Relief Teacher" as the staffing of the slot, not a person name', () => {
    // Final Update_New gives Relief Teacher its own column (C27), covering
    // Sec 3 English and Sec 1D2 English.
    expect(splitSubjectTeacher('English Relief Teacher')).toEqual({
      kind: 'ok',
      subject: 'English',
      teacher: 'Relief Teacher',
    });
  });

  // ⚠ THE REGRESSION THAT MATTERS MOST.
  //
  // A general dash split reads "Science - Chemistry" as a teacher named
  // "Chemistry", and "Humanities - *SS and Literarure (...)" as a teacher
  // named "*SS and Literarure". Both appeared in a real run as teachers.
  // A wrong name on a grading sheet is invisible once written.
  describe('does NOT invent a teacher from a dash inside a subject name', () => {
    for (const cell of [
      'Science - Chemistry',
      'Science - Biology',
      'Humanities - *Literature and History',
      'Humanities - *SS and Literarure (Secondary 3, AY2024 Elaine)',
      '*SS and Geography (Secondary 4, AY2025)',
    ]) {
      it(cell, () => {
        const out = splitSubjectTeacher(cell);
        expect(out.kind).toBe('no-teacher');
      });
    }
  });

  it('uses the dash form only for a declared bare name', () => {
    const bare = new Set(['jasmine']);
    expect(
      splitSubjectTeacher('Mother Tongue (Mandarin) - Jasmine', bare)
    ).toEqual({
      kind: 'ok',
      subject: 'Mother Tongue (Mandarin)',
      teacher: 'Jasmine',
    });
    // Same shape, undeclared name → refuses rather than guessing.
    expect(splitSubjectTeacher('Mother Tongue (Mandarin) - Jasmine').kind).toBe(
      'no-teacher'
    );
  });

  it('reports a subject with no teacher rather than failing', () => {
    // Sec 1D2 (Cambridge) names a teacher for English and Mathematics only.
    expect(splitSubjectTeacher('Personal Development')).toEqual({
      kind: 'no-teacher',
      subject: 'Personal Development',
    });
  });
});

describe('adviserFromCell', () => {
  it('reads the adviser out of an Assembly cell', () => {
    expect(adviserFromCell('Assembly - Ms Koh')).toBe('Ms Koh');
  });

  // ⚠ The connector is "&" as often as "and". Matching only "and" left
  // "& Values Education Mr Joseph" standing as a name, which made ONE adviser
  // look like TWO on four separate primary classes.
  it('handles both "and" and "&" in Homeroom and Values Education', () => {
    expect(adviserFromCell('Homeroom and Values Education Ms Kristel')).toBe(
      'Ms Kristel'
    );
    expect(adviserFromCell('Homeroom & Values Education Mr Joseph')).toBe(
      'Mr Joseph'
    );
  });

  it('returns null when the cell names a class rather than a person', () => {
    // Final Update_New writes "Assembly Sec 2I2" — the class it covers.
    expect(adviserFromCell('Assembly Sec 2I2')).toBeNull();
    expect(adviserFromCell('Assembly - P1 Patience')).toBeNull();
  });

  it('keeps a two-person adviser verbatim so the caller can refuse it', () => {
    // Sec 4 Excellence. One form_adviser per section is DB-enforced, so this
    // must survive parsing intact to be reported, not silently halved.
    expect(adviserFromCell('Assembly - Ms Med & Ms Elaine')).toBe(
      'Ms Med & Ms Elaine'
    );
  });
});

describe('normaliseNickname', () => {
  // ⚠ The workbook writes the same person both ways inside one class, which
  // made P5 Perseverance look like it had two advisers.
  it('collapses punctuation and title spacing', () => {
    expect(normaliseNickname('Ms.Melissa')).toBe(
      normaliseNickname('Ms Melissa')
    );
    expect(normaliseNickname('Ms J')).toBe(normaliseNickname('Ms.J'));
    expect(normaliseNickname('Ms. Tina')).toBe(normaliseNickname('Ms.Tina'));
  });

  it('does not collapse two different people', () => {
    expect(normaliseNickname('Ms Med')).not.toBe(normaliseNickname('Ms Mae'));
  });
});

describe('classTokensIn', () => {
  it('finds secondary and primary class references in free text', () => {
    expect(
      classTokensIn('Sec 3 Humanities Tue Literature Wed Sec 4 Humanities Thu')
    ).toEqual(expect.arrayContaining(['S3', 'S4']));
    expect(classTokensIn('Sec 1D2 English Monday')).toContain('S1D2');
    expect(classTokensIn('P5 Tenacity Science')).toContain('P5 Tenacity');
  });
});

describe('deriveClassIdentity', () => {
  const cases: [string, string, string][] = [
    ['PRIMARY ONE PATIENCE - MORNING (GLOBAL CLASS)', 'P1', 'Patience'],
    ['P2 GENTLENESS - AFTERNOON (STANDARD)', 'P2', 'Gentleness'],
    ['PRIMARY FOUR TRUST- AM', 'P4', 'Trust'],
    ['PRIMARY SIX GRIT- MORNING', 'P6', 'Grit'],
    ['SECONDARY THREE CONSISTENCY', 'S3', 'Consistency'],
    ['SECONDARY ONE DISCIPLINE 2 STANDARD', 'S1', 'Discipline 2'],
    ['SECONDARY TWO INTEGRITY 1 GLOBAL', 'S2', 'Integrity 1'],
    ['SECONDARY 1D2 (Cambridge)', 'S1', 'Discipline 2'],
  ];
  for (const [raw, level, name] of cases) {
    it(raw, () => {
      const id = deriveClassIdentity(raw);
      expect(id?.levelCode).toBe(level);
      expect(id?.sectionName.toLowerCase()).toBe(name.toLowerCase());
    });
  }

  // ⚠ The roster typo writes the level TWICE — "P3RIMARY" and "THREE".
  // Consuming only the digit left "THREE COURTESY" as the section name, which
  // matched nothing and silently dropped P3 Courtesy from the import.
  it('handles the P3RIMARY typo without doubling the level', () => {
    const id = deriveClassIdentity(
      'P3RIMARY THREE COURTESY - MORNING (GLOBAL)'
    );
    expect(id?.levelCode).toBe('P3');
    expect(id?.sectionName.toLowerCase()).toBe('courtesy');
  });

  it('keeps stream words as annotations, out of the section name', () => {
    const id = deriveClassIdentity('SECONDARY 1D2 (Cambridge)');
    expect(id?.annotations.join(' ').toLowerCase()).toContain('cambridge');
    expect(id?.sectionName.toLowerCase()).not.toContain('cambridge');
  });
});

describe('where one band ends and the next begins', () => {
  // ⚠ THIS COST THE ENTIRE SECONDARY ONE TIMETABLE, silently.
  //
  // `Secondary_New` lays the Sec 1 pair side by side with their header on row
  // 3 (Start Time at columns 2 and 11) — and puts a THIRD timetable,
  // "SECONDARY 1D2 (Cambridge)", three rows lower at column 20, so ITS header
  // lands on row 6. The parser used to end every band two rows above the next
  // header row anywhere on the sheet, which left both row-3 bands one row
  // long: the Assembly row, and nothing after it.
  //
  // The tell was that nothing looked wrong. Both classes kept an adviser, the
  // generator reported "11 skipped" without mentioning them, and 18 teaching
  // assignments were simply absent. A band with no rows is not an error.

  // Columns: 0,1 spacer · 2 band A · 11 band B · 20 band C (starts lower).
  function cell(row: unknown[], col: number, value: unknown) {
    row[col] = value;
  }

  function sheetWithAStaggeredThirdBand() {
    const rows: unknown[][] = Array.from({ length: 12 }, () => []);

    // Row 2 — titles for the two side-by-side bands.
    cell(rows[2], 2, 'SECONDARY ONE DISCIPLINE 2 STANDARD');
    cell(rows[2], 11, 'SECONDARY ONE DISCIPLINE 1 GLOBAL');

    // Row 3 — their shared header row.
    for (const sc of [2, 11]) {
      cell(rows[3], sc, 'Start Time');
      cell(rows[3], sc + 1, 'End Time');
      cell(rows[3], sc + 2, 'Duration (mins)');
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d, i) =>
        cell(rows[3], sc + 3 + i, d)
      );
    }

    // Row 4 — assembly, which is where the adviser is read from.
    cell(rows[4], 2, 0.34375);
    cell(rows[4], 5, 'Assembly - Ms J');
    cell(rows[4], 11, 0.34375);
    cell(rows[4], 14, 'Assembly - Ms Sharon');

    // Row 5 — the title of the third band, offset to the right and LOWER.
    cell(rows[5], 20, 'SECONDARY 1D2 (Cambridge)');
    // …and a real lesson row for the first two bands, on the same line.
    cell(rows[5], 2, 0.3541666666666667);
    cell(rows[5], 5, 'Science\r\nMs Tina');
    cell(rows[5], 11, 0.3541666666666667);
    cell(rows[5], 14, 'English\r\nMs Sharon');

    // Row 6 — the third band's header. THIS is the row that used to truncate
    // the two bands above, despite sharing no columns with them.
    cell(rows[6], 20, 'Start Time');
    cell(rows[6], 21, 'End Time');
    cell(rows[6], 22, 'Duration (mins)');
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach((d, i) =>
      cell(rows[6], 23 + i, d)
    );

    // Rows 7-8 — more lessons for the first two bands, past the truncation.
    cell(rows[7], 2, 0.3958333333333333);
    cell(rows[7], 5, 'Mathematics\r\nMs J');
    cell(rows[7], 11, 0.3958333333333333);
    cell(rows[7], 14, 'Humanities\r\nMs Med');

    cell(rows[8], 2, 0.4479166666666667);
    cell(rows[8], 5, 'Mother Tongue\r\nMs Melissa');
    cell(rows[8], 11, 0.4479166666666667);
    cell(rows[8], 14, 'Computing\r\nMs Lhen');

    // And one for the third band, to prove it still reads.
    cell(rows[7], 20, 0.34375);
    cell(rows[7], 23, 'English\r\nMs Carl');

    return XLSX.utils.aoa_to_sheet(rows);
  }

  const parsed = parseClassMajorSheet(
    'Secondary_New',
    sheetWithAStaggeredThirdBand()
  );

  function subjectsFor(classRaw: string) {
    return parsed.lessons
      .filter((l) => l.classRaw === classRaw)
      .map((l) => l.subjectRaw)
      .sort();
  }

  it('reads the lessons of a band a later, offset band used to truncate', () => {
    expect(subjectsFor('SECONDARY ONE DISCIPLINE 2 STANDARD')).toEqual([
      'Mathematics',
      'Mother Tongue',
      'Science',
    ]);
  });

  it('reads them for the band beside it too', () => {
    expect(subjectsFor('SECONDARY ONE DISCIPLINE 1 GLOBAL')).toEqual([
      'Computing',
      'English',
      'Humanities',
    ]);
  });

  it('still reads the offset band itself', () => {
    expect(subjectsFor('SECONDARY 1D2 (Cambridge)')).toEqual(['English']);
  });

  it('still finds the adviser of each side-by-side band', () => {
    expect(
      parsed.advisers.map((a) => `${a.classRaw} :: ${a.teacherRaw}`).sort()
    ).toEqual([
      'SECONDARY ONE DISCIPLINE 1 GLOBAL :: Ms Sharon',
      'SECONDARY ONE DISCIPLINE 2 STANDARD :: Ms J',
    ]);
  });
});
