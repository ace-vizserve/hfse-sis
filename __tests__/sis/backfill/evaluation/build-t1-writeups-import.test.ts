import { describe, expect, it } from 'vitest';
import { buildT1WriteupsImport } from '@/lib/sis/backfill/evaluation/build-t1-writeups-import';
import type {
  ParsedT1WriteupRow,
  SheetT1Stats,
} from '@/lib/sis/backfill/evaluation/parse-t1-writeups';
import type { T1RosterCandidate } from '@/lib/sis/backfill/evaluation/build-t1-writeups-import';

const TERM_ID = '11111111-1111-1111-1111-111111111111';
const SUBMITTED_AT = '2026-03-13';

function row(overrides: Partial<ParsedT1WriteupRow> = {}): ParsedT1WriteupRow {
  return {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    sheetIndexNo: '1',
    fullName: 'BANTA, Stephanie Louise S.',
    writeup: 'A real write-up paragraph.',
    ...overrides,
  };
}

function candidate(
  overrides: Partial<T1RosterCandidate> = {}
): T1RosterCandidate {
  return {
    enroleeNumber: '',
    studentNumber: 'H200006',
    lastName: 'Banta',
    firstName: 'Stephanie',
    middleName: 'Louise S.',
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 1,
    studentId: '22222222-2222-2222-2222-222222222222',
    sectionId: '33333333-3333-3333-3333-333333333333',
    ...overrides,
  };
}

const emptyStats: SheetT1Stats[] = [];

describe('buildT1WriteupsImport', () => {
  it('resolves a matching row by name and writes it', () => {
    const result = buildT1WriteupsImport({
      rows: [row()],
      sheetStats: emptyStats,
      rosterCandidates: [candidate()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 1, needsReview: 0 });
    expect(result.apply).toContain(
      'insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)'
    );
    expect(result.apply).toContain('true');
    expect(result.apply).toContain("'2026-03-13'");
    expect(result.apply).toContain(
      'on conflict (term_id, student_id) do nothing'
    );
  });

  it('writes the section_id from the roster match, not the sheet, when they disagree', () => {
    // The sheet says Integrity 2; the student's real current section
    // (per the roster candidate) is Discipline 1 — a withdrawn-then-
    // returned or transferred student. section_id must follow the roster.
    const result = buildT1WriteupsImport({
      rows: [row({ levelCode: 'S2', sectionName: 'Integrity 2' })],
      sheetStats: emptyStats,
      rosterCandidates: [
        candidate({
          levelCode: 'S1',
          sectionName: 'Discipline 1',
          sectionId: '44444444-4444-4444-4444-444444444444',
        }),
      ],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats.writeupsWritten).toBe(1);
    expect(result.apply).toContain('44444444-4444-4444-4444-444444444444');
  });

  it('flags a row with no name match as needs-review instead of writing it', () => {
    const result = buildT1WriteupsImport({
      rows: [row({ fullName: 'NOBODY, Real Person' })],
      sheetStats: emptyStats,
      rosterCandidates: [candidate()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 0, needsReview: 1 });
    expect(result.preview).toContain('NOBODY, Real Person');
    expect(result.preview).toContain(
      'no name match against the active AY2026 roster'
    );
  });

  it('never emits created_by — the column is always left NULL by omission', () => {
    const result = buildT1WriteupsImport({
      rows: [row()],
      sheetStats: emptyStats,
      rosterCandidates: [candidate()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.apply).not.toContain('created_by');
  });

  it('escapes a single quote in the write-up text', () => {
    const result = buildT1WriteupsImport({
      rows: [row({ writeup: "Student's progress is strong." })],
      sheetStats: emptyStats,
      rosterCandidates: [candidate()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.apply).toContain("Student''s progress is strong.");
  });

  it('handles an empty rows array without throwing', () => {
    const result = buildT1WriteupsImport({
      rows: [],
      sheetStats: emptyStats,
      rosterCandidates: [candidate()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 0, needsReview: 0 });
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });

  it('includes a per-section resolved/needsReview/namedBlank/unusedTemplate breakdown in the preview', () => {
    const result = buildT1WriteupsImport({
      rows: [row(), row({ fullName: 'NOBODY, Real Person' })],
      sheetStats: [
        {
          levelCode: 'S1',
          sectionName: 'Discipline 1',
          namedBlankCount: 2,
          unusedTemplateCount: 5,
          duplicateIndexNotes: [],
        },
      ],
      rosterCandidates: [candidate()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.preview).toContain(
      'S1 Discipline 1: resolved=1 needsReview=1 namedBlank=2 unusedTemplate=5'
    );
  });

  it('lists every resolved write-up in full, not a sample', () => {
    const manyRows = Array.from({ length: 8 }, (_, i) =>
      row({ sheetIndexNo: String(i + 1), fullName: `PERSON${i}, Test` })
    );
    const manyCandidates = manyRows.map((_, i) =>
      candidate({
        lastName: `PERSON${i}`,
        firstName: 'Test',
        studentId: `student-${i}`,
      })
    );
    const result = buildT1WriteupsImport({
      rows: manyRows,
      sheetStats: emptyStats,
      rosterCandidates: manyCandidates,
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats.writeupsWritten).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(result.preview).toContain(`PERSON${i}, Test`);
    }
  });

  it('resolves rows sharing a duplicate sheet index independently by name — no collision', () => {
    // Two different real students both typed as sheet index "14" — the
    // real T1 data-quality issue found in Sec 2 Integrity 2. Both must
    // resolve to their OWN correct student, or correctly fail alone.
    const result = buildT1WriteupsImport({
      rows: [
        row({
          sheetIndexNo: '14',
          fullName: 'LABANEN, Shannen Marella S.',
          writeup: "Shannen's write-up.",
        }),
        row({
          sheetIndexNo: '14',
          fullName: 'IRAWAN, JOAN JOYLYN',
          writeup: "Joan's write-up.",
        }),
      ],
      sheetStats: emptyStats,
      rosterCandidates: [
        candidate({
          lastName: 'Labanen',
          firstName: 'Shannen',
          middleName: 'Marella S.',
          studentId: 'labanen-id',
        }),
        // Irawan has no roster candidate — she's withdrawn from AY2026,
        // matching the real case this design validated against.
      ],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 1, needsReview: 1 });
    expect(result.apply).toContain("Shannen''s write-up.");
    expect(result.apply).not.toContain('Joan');
    expect(result.preview).toContain('IRAWAN, JOAN JOYLYN');
  });
});
