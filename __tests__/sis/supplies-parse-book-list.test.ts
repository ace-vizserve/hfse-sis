import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  BOOKS_SHEET,
  SUPPLIES_SHEET,
  cleanIsbn,
  mapCourse,
  parseBookListWorkbook,
} from '@/lib/sis/supplies/parse-book-list';

// A books row laid out like the real sheet: B Course, C Module, D Title,
// E Publisher, F ISBN, R the AY status.
function bookRow(
  course: string,
  module: string,
  title: string,
  status: string,
  publisher = 'Marshall Cavendish',
  isbn = '9789814433785'
): (string | null)[] {
  const r: (string | null)[] = Array(21).fill(null);
  r[1] = course;
  r[2] = module;
  r[3] = title;
  r[4] = publisher;
  r[5] = isbn;
  r[17] = status;
  return r;
}

function header(ay = 'AY2027'): (string | null)[] {
  const r: (string | null)[] = Array(21).fill(null);
  r[1] = 'Course';
  r[2] = 'Module';
  r[3] = 'Book Title';
  r[4] = 'Publisher';
  r[5] = 'ISBN';
  r[17] = ay;
  return r;
}

function workbook(
  books: (string | null)[][],
  supplies: string[],
  ay = 'AY2027'
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['HFSE International School'],
      ['AY2027 Book List'],
      [],
      header(ay),
      ...books,
    ]),
    BOOKS_SHEET
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Item', 'OH Qty'],
      ...supplies.map((s) => [s, '0']),
    ]),
    SUPPLIES_SHEET
  );
  return wb;
}

describe('mapCourse', () => {
  it('reads level and track from a Primary course', () => {
    expect(mapCourse('Primary Three - Global')).toEqual({
      levelCode: 'P3',
      classType: 'Global',
    });
    expect(mapCourse('Primary Three - Standard')).toEqual({
      levelCode: 'P3',
      classType: 'Standard',
    });
  });

  it('gives a Secondary course both tracks', () => {
    expect(mapCourse('Secondary One')).toEqual({
      levelCode: 'S1',
      classType: null,
    });
  });

  it('does not map the IEP years or unknown names', () => {
    expect(
      mapCourse('HFSE International Education Programme - Year 1')
    ).toBeNull();
    expect(mapCourse('Kindergarten')).toBeNull();
  });
});

describe('cleanIsbn', () => {
  it('drops the sheet placeholders', () => {
    expect(cleanIsbn('Not Applicable')).toBeNull();
    expect(cleanIsbn('0')).toBeNull();
    expect(cleanIsbn('')).toBeNull();
    expect(cleanIsbn(' 9781909608405\n')).toBe('9781909608405');
  });
});

describe('parseBookListWorkbook', () => {
  const wb = workbook(
    [
      bookRow(
        'Primary Three - Standard',
        'English',
        'MPAH! Grammar Workbook P3',
        'Retain for AY2027'
      ),
      bookRow(
        'Primary Three - Global',
        'English',
        'MPAH! Grammar Workbook P3',
        'Retain for AY2027'
      ),
      bookRow(
        'Primary Three - Global',
        'English',
        'Targeting Composition Writing',
        'End of life / Cancel'
      ),
      bookRow('Secondary One', 'Literature', 'Animal Farm', 'New'),
      bookRow(
        'HFSE International Education Programme - Year 1',
        'Mathematics',
        'Cambridge Primary Mathematics 1',
        'New'
      ),
      bookRow(
        'Primary Three - Standard',
        'Mathematics',
        'Print + Digital\nTextbook 3A',
        'For revision'
      ),
    ],
    ['WelcomeKit Bag', 'YS Kit', 'YS brown Booklet A4', 'Exam Pad']
  );
  const parsed = parseBookListWorkbook(wb, 'AY2027');
  const books = parsed.items.filter((i) => i.kind === 'book');
  const supplies = parsed.items.filter((i) => i.kind === 'supply');

  it('maps each course to a level and track', () => {
    expect(
      books.map((b) => [b.levelCode, b.classType, b.subject, b.title])
    ).toEqual([
      ['P3', 'Standard', 'English', 'MPAH! Grammar Workbook P3'],
      ['P3', 'Global', 'English', 'MPAH! Grammar Workbook P3'],
      ['S1', null, 'Literature', 'Animal Farm'],
      ['P3', 'Standard', 'Mathematics', 'Print + Digital Textbook 3A'],
    ]);
  });

  it('skips End of life / Cancel rows', () => {
    expect(books.some((b) => b.title === 'Targeting Composition Writing')).toBe(
      false
    );
    expect(parsed.skipped).toContainEqual(
      expect.objectContaining({ reason: 'end_of_life', row: 7 })
    );
  });

  it('skips the IEP courses', () => {
    expect(books.some((b) => b.title.startsWith('Cambridge'))).toBe(false);
    expect(parsed.skipped).toContainEqual(
      expect.objectContaining({ reason: 'iep_course' })
    );
  });

  it('keeps the sheet row as the order', () => {
    expect(books.map((b) => b.sortOrder)).toEqual([5, 6, 8, 10]);
  });

  it('makes YS supplies Youngstarters-only and the rest every level', () => {
    expect(supplies.map((s) => [s.title, s.levelCode])).toEqual([
      ['WelcomeKit Bag', null],
      ['YS Kit', 'YS'],
      ['YS brown Booklet A4', 'YS'],
      ['Exam Pad', null],
    ]);
  });

  it('refuses a workbook whose status column is not the asked-for year', () => {
    expect(() =>
      parseBookListWorkbook(workbook([], [], 'AY2026'), 'AY2027')
    ).toThrow(/expected "AY2027"/);
  });

  it('drops a repeated item within the same level, track and subject', () => {
    const dup = parseBookListWorkbook(
      workbook(
        [
          bookRow('Secondary One', 'English', 'Situational Writing', 'New'),
          bookRow('Secondary One', 'English', 'Situational Writing', 'New'),
        ],
        []
      ),
      'AY2027'
    );
    expect(dup.items).toHaveLength(1);
    expect(dup.skipped).toEqual([
      expect.objectContaining({ reason: 'duplicate', row: 6 }),
    ]);
  });
});
