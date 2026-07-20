import { describe, expect, it } from 'vitest';
import { buildWriteupsImport } from '@/lib/sis/backfill/evaluation/build-writeups-import';
import type { ParsedWriteupRow } from '@/lib/sis/backfill/evaluation/parse-consolidated-writeups';
import type { RosterLookupEntry } from '@/lib/sis/backfill/evaluation/build-writeups-import';

const TERM_ID = '11111111-1111-1111-1111-111111111111';
const SUBMITTED_AT = '2026-05-28';

function row(overrides: Partial<ParsedWriteupRow> = {}): ParsedWriteupRow {
  return {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNo: '1',
    fullName: 'BANTA, Stephanie Louise S.',
    writeup: 'A real write-up paragraph.',
    ...overrides,
  };
}

function rosterEntry(
  overrides: Partial<RosterLookupEntry> = {}
): RosterLookupEntry {
  return {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 1,
    studentId: '22222222-2222-2222-2222-222222222222',
    sectionId: '33333333-3333-3333-3333-333333333333',
    ...overrides,
  };
}

describe('buildWriteupsImport', () => {
  it('resolves a matching row and writes it', () => {
    const result = buildWriteupsImport({
      rows: [row()],
      blankCounts: [],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 1, needsReview: 0 });
    expect(result.apply).toContain(
      'insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)'
    );
    expect(result.apply).toContain('true');
    expect(result.apply).toContain("'2026-05-28'");
    expect(result.apply).toContain(
      'on conflict (term_id, student_id) do nothing'
    );
  });

  it('flags an unresolvable row as needs-review instead of writing it', () => {
    const result = buildWriteupsImport({
      rows: [row({ indexNo: '99' })],
      blankCounts: [],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 0, needsReview: 1 });
    expect(result.preview).toContain('index 99');
    expect(result.preview).toContain('no matching active section_students row');
  });

  it('never emits created_by — the column is always left NULL by omission', () => {
    const result = buildWriteupsImport({
      rows: [row()],
      blankCounts: [],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.apply).not.toContain('created_by');
  });

  it('escapes a single quote in the write-up text', () => {
    const result = buildWriteupsImport({
      rows: [row({ writeup: "Student's progress is strong." })],
      blankCounts: [],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.apply).toContain("Student''s progress is strong.");
  });

  it('handles an empty rows array without throwing', () => {
    const result = buildWriteupsImport({
      rows: [],
      blankCounts: [],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.stats).toEqual({ writeupsWritten: 0, needsReview: 0 });
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });

  it('includes a per-section resolved/needs-review/blank breakdown in the preview', () => {
    const result = buildWriteupsImport({
      rows: [row(), row({ indexNo: '99', fullName: 'UNRESOLVED, Student' })],
      blankCounts: [
        { levelCode: 'S1', sectionName: 'Discipline 1', blankCount: 3 },
        { levelCode: 'P1', sectionName: 'Patience', blankCount: 0 },
      ],
      rosterLookup: [rosterEntry()],
      termId: TERM_ID,
      submittedAt: SUBMITTED_AT,
    });
    expect(result.preview).toContain(
      'S1 Discipline 1: resolved=1 needsReview=1 blank=3'
    );
    expect(result.preview).toContain(
      'P1 Patience: resolved=0 needsReview=0 blank=0'
    );
  });
});
