import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { toPlainText } from '@/lib/rich-text';
import { buildSowWorkbook, type SowForExport } from '@/lib/sow/excel-export';
import { parseSowWorkbook } from '@/lib/sow/excel-import';

/**
 * Download Excel (Task 12): a scheme of work written in the school's Module
 * Syllabus layout. The round trip through the importer is the contract — what
 * goes out is exactly what the importer would read back in.
 */

const sow: SowForExport = {
  module: {
    title: 'Science',
    syllabus: 'Primary Science 2026',
    hoursPerWeek: '5 hours per week',
    teachingMethods: 'Inquiry; practicals',
    passRequirement: 'At least 75 out of 100',
    textbook: 'Science 2',
    references: 'Teacher slides',
    remarks: 'Aim: curiosity',
  },
  levelLabel: 'Primary 2',
  ayCode: 'AY2026',
  termNumber: 4,
  termStart: '2026-10-05',
  termEnd: '2026-12-04',
  weeks: [
    {
      weekNumber: 1,
      startsOn: '2026-10-05',
      endsOn: '2026-10-09',
      events: ['Teachers Day'],
      topic: 'Plants',
      learningOutcomes: '<p>Name the parts</p><p>Say what they do</p>',
      textbookPages: 'pp. 10-19',
      activities: '<p>Draw a plant<br>Label it</p>',
      assessment: null,
      remarks: '<p>Bring a leaf</p>',
    },
    {
      weekNumber: 2,
      startsOn: '2026-10-12',
      endsOn: '2026-10-16',
      events: [],
      topic: null,
      learningOutcomes: null,
      textbookPages: null,
      activities: null,
      assessment: null,
      remarks: null,
    },
  ],
};

describe('buildSowWorkbook', () => {
  it('export then import gives back the same module and weeks', () => {
    const parsed = parseSowWorkbook(buildSowWorkbook(sow), 'Primary 2');
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.sow.warnings).toEqual([]);
    expect(parsed.sow.module).toEqual(sow.module);
    expect(parsed.sow.weeks).toHaveLength(2);
    const [w1, w2] = parsed.sow.weeks;
    expect(w1.weekNumber).toBe(1);
    expect(w1.topic).toBe('Plants');
    expect(w1.textbookPages).toBe('pp. 10-19');
    expect(toPlainText(w1.learningOutcomes)).toBe(
      'Name the parts\nSay what they do'
    );
    expect(toPlainText(w1.activities)).toBe('Draw a plant\nLabel it');
    expect(toPlainText(w1.remarks)).toBe('Bring a leaf');
    expect(w2).toMatchObject({
      weekNumber: 2,
      topic: '',
      learningOutcomes: '',
      activities: '',
    });
  });

  it('puts the assessment under the activities, in the one shared column', () => {
    const withAssessment: SowForExport = {
      ...sow,
      weeks: [{ ...sow.weeks[0], assessment: '<p>Quiz on parts</p>' }],
    };
    const parsed = parseSowWorkbook(
      buildSowWorkbook(withAssessment),
      'Primary 2'
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(toPlainText(parsed.sow.weeks[0].activities)).toBe(
      'Draw a plant\nLabel it\nQuiz on parts'
    );
  });

  it('names the tab after the level and leaves the monitoring block empty', () => {
    const wb = XLSX.read(buildSowWorkbook(sow), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Primary 2']);
    const text = XLSX.utils.sheet_to_csv(wb.Sheets['Primary 2']);
    expect(text).toContain('Monitoring Module Delivery');
    expect(text).toContain("Supervisor's Remarks & Date");
    expect(text).toContain('Week 1');
    expect(text).toContain('Teachers Day');
  });
});
