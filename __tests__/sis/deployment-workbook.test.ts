import { describe, expect, it } from 'vitest';

import {
  adviserFromCell,
  classTokensIn,
  deriveClassIdentity,
  normaliseNickname,
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
