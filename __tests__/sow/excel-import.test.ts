import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { SOW_MODULE_CAPS, SOW_WEEK_PLAIN_CAPS } from '@/lib/schemas/sow';
import {
  MAX_IMPORT_BYTES,
  parseSowWorkbook,
  plainTextToRichHtml,
} from '@/lib/sow/excel-import';

import { buildTemplate, defaultWeeks } from './fixtures/build-template';

/**
 * The one-time import from the school's Excel template (Task 11).
 *
 * Pinned:
 *   1. Header values are found by their LABEL, not their position.
 *   2. Weeks are read in order from the week table.
 *   3. The tab is the one for the chosen level; none is a plain sentence.
 *   4. The "Monitoring Module Delivery" block is never read.
 *   5. Weeks beyond the term, and weeks the file lacks, come back as warnings.
 *   6. Imported plain text becomes escaped paragraphs in the rich fields.
 */

const ok = (r: ReturnType<typeof parseSowWorkbook>) => {
  if (!r.ok) throw new Error(r.error);
  return r.sow;
};

const tabs = (names: string[], weekCount = 10) =>
  buildTemplate(
    names.map((name) => ({ name, weeks: defaultWeeks(weekCount) }))
  );

describe('parseSowWorkbook', () => {
  it('reads the header fields by label', () => {
    const sow = ok(parseSowWorkbook(tabs(['Secondary 1']), 'Secondary 1'));
    expect(sow.module).toEqual({
      title: 'Science',
      syllabus: 'Invented Science Syllabus',
      hoursPerWeek: '5 hours per week',
      teachingMethods: 'Inquiry; hands-on practicals',
      passRequirement: 'At least 75 out of 100',
      textbook: 'Science textbook 1',
      references: 'Teacher slides',
      remarks: 'Aim: curiosity',
    });
  });

  it('finds the header fields even when extra rows move the week table down', () => {
    const buf = buildTemplate([
      {
        name: 'Secondary 1',
        weeks: defaultWeeks(2),
        extraHeaderRows: [['Prepared by', 'Someone']],
      },
    ]);
    const r = ok(parseSowWorkbook(buf, 'Secondary 1'));
    expect(r.weeks).toHaveLength(2);
    expect(r.module.title).toBe('Science');
    // An unknown label is a warning, never an error.
    expect(r.warnings.join(' ')).toContain('Prepared by');
  });

  it('reads ten week blocks in order', () => {
    const sow = ok(parseSowWorkbook(tabs(['Secondary 1']), 'Secondary 1'));
    expect(sow.weeks.map((w) => w.weekNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(sow.weeks[2]).toMatchObject({
      topic: 'Topic 3',
      textbookPages: 'Pages 30-39',
      remarks: '<p>Remark 3</p>',
    });
    // Learning outcomes keep their line break, as a rich-text paragraph.
    expect(sow.weeks[2].learningOutcomes).toBe(
      '<p>Outcome 3a<br>Outcome 3b</p>'
    );
    expect(sow.weeks[2].activities).toBe('<p>Activity 3</p>');
    // The template has one cell for activities and assessment together.
    expect(sow.weeks[2].assessment).toBe('');
  });

  it('picks the tab for the chosen level', () => {
    const buf = buildTemplate([
      { name: 'Secondary 1', weeks: [{ number: 1, topic: 'One' }] },
      { name: 'Secondary 2', weeks: [{ number: 1, topic: 'Two' }] },
    ]);
    expect(ok(parseSowWorkbook(buf, 'Secondary 2')).weeks[0].topic).toBe('Two');
    expect(ok(parseSowWorkbook(buf, 'Secondary 1')).weeks[0].topic).toBe('One');
  });

  it.each([['Sec 3'], ['S3'], ['secondary 3'], ['Secondary Three']])(
    'matches a tab named %s to Secondary 3',
    (name) => {
      const buf = buildTemplate([
        { name: 'Secondary 1', weeks: [{ number: 1, topic: 'wrong' }] },
        { name, weeks: [{ number: 1, topic: 'right' }] },
      ]);
      expect(ok(parseSowWorkbook(buf, 'Secondary 3')).weeks[0].topic).toBe(
        'right'
      );
    }
  );

  it('a workbook with no matching tab is refused in a plain sentence', () => {
    const r = parseSowWorkbook(tabs(['Secondary 2']), 'Secondary 1');
    expect(r).toEqual({
      ok: false,
      error: 'This file has no tab for Secondary 1.',
    });
  });

  it('a file that is not a workbook is refused in a plain sentence', () => {
    const junk = new TextEncoder().encode('not a spreadsheet at all').buffer;
    const r = parseSowWorkbook(junk as ArrayBuffer, 'Secondary 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Excel/);
  });

  it('a tab with no week table is refused in a plain sentence', () => {
    const buf = buildTemplate([{ name: 'Secondary 1' }]);
    const r = parseSowWorkbook(buf, 'Secondary 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Secondary 1');
  });

  it('ignores the monitoring block', () => {
    const sow = ok(parseSowWorkbook(tabs(['Secondary 1']), 'Secondary 1'));
    const everything = JSON.stringify(sow);
    expect(everything).not.toContain('Followed as planned');
    expect(everything).not.toContain('initials');
    expect(everything).not.toContain('supervisor');
    expect(sow.warnings).toEqual([]);
  });

  it('extra weeks beyond the term come back as warnings', () => {
    const sow = ok(
      parseSowWorkbook(tabs(['Secondary 1'], 11), 'Secondary 1', {
        termWeekCount: 10,
      })
    );
    expect(sow.weeks).toHaveLength(11);
    expect(sow.warnings).toEqual([
      'This term has 10 teaching weeks, but the file has 11. Week 11 is added after the last week, and has to be merged or deleted before you send the SOW for review.',
    ]);
  });

  it('weeks the file does not have come back as a warning', () => {
    const sow = ok(
      parseSowWorkbook(tabs(['Secondary 1'], 8), 'Secondary 1', {
        termWeekCount: 10,
      })
    );
    expect(sow.warnings).toEqual([
      'This term has 10 teaching weeks, but the file only has 8. Weeks 9 and 10 start empty.',
    ]);
  });

  it('assessment weights in the file are ignored', () => {
    const sow = ok(parseSowWorkbook(tabs(['Secondary 1']), 'Secondary 1'));
    expect(JSON.stringify(sow)).not.toContain('WW 40%');
  });

  it('warns when a number appears twice and keeps the first', () => {
    const buf = buildTemplate([
      {
        name: 'Secondary 1',
        weeks: [
          { number: 1, topic: 'First' },
          { number: 1, topic: 'Again' },
        ],
      },
    ]);
    const sow = ok(parseSowWorkbook(buf, 'Secondary 1'));
    expect(sow.weeks).toHaveLength(1);
    expect(sow.weeks[0].topic).toBe('First');
    expect(sow.warnings.join(' ')).toContain('Week 1 appears more than once');
  });

  it('takes hours and textbook pages as long as the real file writes them', () => {
    const buf = buildTemplate([
      {
        name: 'Secondary 1',
        header: {
          'No of teaching hours':
            '5 hours per week × 9 instructional weeks = 45 hours this term; 180 hours for the academic year.',
        },
        weeks: [{ number: 1, topic: 'T', pages: 'p'.repeat(400) }],
      },
    ]);
    const sow = ok(parseSowWorkbook(buf, 'Secondary 1'));
    expect(sow.warnings).toEqual([]);
    expect(sow.weeks[0].textbookPages).toHaveLength(400);
  });

  it('an imported module is never longer than its edit form allows', () => {
    for (const [key, cap] of Object.entries(SOW_MODULE_CAPS)) {
      expect(cap, key).toBeGreaterThan(0);
    }
    // The real sample's hours line (~95 characters) and a long textbook cell.
    expect(SOW_MODULE_CAPS.hoursPerWeek).toBeGreaterThanOrEqual(300);
    expect(SOW_WEEK_PLAIN_CAPS.textbookPages).toBeGreaterThanOrEqual(500);
  });

  it('ignores a week numbered past 60, with a warning', () => {
    const buf = buildTemplate([
      {
        name: 'Secondary 1',
        weeks: [
          { number: 1, topic: 'One' },
          { number: 61, topic: 'Far off' },
        ],
      },
    ]);
    const sow = ok(parseSowWorkbook(buf, 'Secondary 1'));
    expect(sow.weeks.map((w) => w.weekNumber)).toEqual([1]);
    expect(sow.warnings.join(' ')).toContain('Week 61');
  });

  it('refuses a file with more than 60 weeks', () => {
    const buf = buildTemplate([
      { name: 'Secondary 1', weeks: defaultWeeks(61) },
    ]);
    expect(parseSowWorkbook(buf, 'Secondary 1')).toEqual({
      ok: false,
      error:
        "This file has more weeks than a term can hold — check it's the right file.",
    });
    // 60 is still fine.
    const sixty = buildTemplate([
      { name: 'Secondary 1', weeks: defaultWeeks(60) },
    ]);
    expect(parseSowWorkbook(sixty, 'Secondary 1').ok).toBe(true);
  });

  it('reads a very large sheet only within its bounds, and quickly', () => {
    // 5,000 rows by 300 columns. Only the top-left 1,000 x 30 is ever read, so
    // week 2 (row 3,000) and the stray "Week 3" (column 200) do not exist.
    const aoa: (string | null)[][] = Array.from({ length: 5000 }, () =>
      Array.from({ length: 300 }, () => null)
    );
    aoa[4999][299] = 'end'; // stretches the declared range only
    aoa[0][0] = 'Module Title';
    aoa[0][1] = 'Science';
    aoa[2][0] = 'Week';
    aoa[2][1] = 'Topic in syllabus';
    aoa[3][0] = 'Week 1';
    aoa[3][1] = 'One';
    aoa[3][200] = 'Week 3';
    aoa[3000][0] = 'Week 2';
    aoa[3000][1] = 'Too far down';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(aoa),
      'Secondary 1'
    );
    const buf = XLSX.write(wb, {
      type: 'array',
      bookType: 'xlsx',
    }) as ArrayBuffer;
    const started = Date.now();
    const sow = ok(parseSowWorkbook(buf, 'Secondary 1'));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(sow.weeks.map((w) => w.weekNumber)).toEqual([1]);
  });

  it('warns about text longer than its field allows, and keeps it', () => {
    const long = 'x'.repeat(301);
    const buf = buildTemplate([
      { name: 'Secondary 1', weeks: [{ number: 1, topic: long }] },
    ]);
    const sow = ok(parseSowWorkbook(buf, 'Secondary 1'));
    expect(sow.weeks[0].topic).toBe(long);
    expect(sow.warnings.join(' ')).toContain('Week 1');
    expect(sow.warnings.join(' ')).toContain('300 characters');
  });
});

describe('plainTextToRichHtml', () => {
  it('escapes markup and turns lines into paragraphs and line breaks', () => {
    expect(plainTextToRichHtml('<b>a</b> & b\nsecond\n\nthird')).toBe(
      '<p>&lt;b&gt;a&lt;/b&gt; &amp; b<br>second</p><p>third</p>'
    );
  });
  it('is empty for nothing', () => {
    expect(plainTextToRichHtml('')).toBe('');
    expect(plainTextToRichHtml('  \n ')).toBe('');
  });
});

describe('MAX_IMPORT_BYTES', () => {
  // Vercel refuses a request body over 4.5 MB before the route runs, so a
  // bigger limit here would promise a file the server can never receive.
  it('is 4 MB, under the 4.5 MB request body limit', () => {
    expect(MAX_IMPORT_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_IMPORT_BYTES + 64 * 1024).toBeLessThan(4.5 * 1024 * 1024);
  });
});
