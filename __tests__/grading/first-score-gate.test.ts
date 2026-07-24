import { describe, it, expect } from 'vitest';
import {
  slotMetaSatisfied,
  slotRosterScored,
} from '@/lib/grading/first-score-gate';

describe('slotMetaSatisfied', () => {
  it('WW/PT: requires both label and date', () => {
    expect(
      slotMetaSatisfied('ww', {
        label: 'Worksheet 2',
        date: '2026-07-01',
        page: null,
      })
    ).toBe(true);
    expect(
      slotMetaSatisfied('ww', { label: 'Worksheet 2', date: null, page: null })
    ).toBe(false);
    expect(
      slotMetaSatisfied('ww', { label: null, date: '2026-07-01', page: null })
    ).toBe(false);
    expect(slotMetaSatisfied('pt', null)).toBe(false);
    expect(slotMetaSatisfied('pt', undefined)).toBe(false);
  });

  it('WW/PT: page is irrelevant to satisfaction', () => {
    expect(
      slotMetaSatisfied('ww', { label: 'Quiz', date: '2026-07-01', page: null })
    ).toBe(true);
  });

  it('WW/PT: "Ongoing" counts as a satisfied date', () => {
    expect(
      slotMetaSatisfied('pt', { label: 'Project', date: 'Ongoing', page: null })
    ).toBe(true);
  });

  it('WW/PT: whitespace-only label or date is not satisfied', () => {
    expect(
      slotMetaSatisfied('ww', { label: '   ', date: '2026-07-01', page: null })
    ).toBe(false);
    expect(
      slotMetaSatisfied('ww', { label: 'Quiz', date: '  ', page: null })
    ).toBe(false);
  });

  it('QA: requires only a label (string form)', () => {
    expect(slotMetaSatisfied('qa', 'Quarterly Exam')).toBe(true);
    expect(slotMetaSatisfied('qa', '')).toBe(false);
    expect(slotMetaSatisfied('qa', null)).toBe(false);
    expect(slotMetaSatisfied('qa', undefined)).toBe(false);
  });

  it('QA: also accepts the { label } object shape', () => {
    expect(slotMetaSatisfied('qa', { label: 'Quarterly Exam' })).toBe(true);
  });
});

describe('slotRosterScored', () => {
  const roster = [
    { ww_scores: [10, null], pt_scores: [null, null], qa_score: null },
    { ww_scores: [null, null], pt_scores: [8, null], qa_score: 90 },
  ];

  it('WW: true if ANY roster row has a non-null score at that index', () => {
    expect(slotRosterScored('ww', 0, roster)).toBe(true);
    expect(slotRosterScored('ww', 1, roster)).toBe(false);
  });

  it('PT: true if ANY roster row has a non-null score at that index', () => {
    expect(slotRosterScored('pt', 0, roster)).toBe(true);
    expect(slotRosterScored('pt', 1, roster)).toBe(false);
  });

  it('QA: true if ANY roster row has a non-null qa_score', () => {
    expect(slotRosterScored('qa', null, roster)).toBe(true);
    expect(
      slotRosterScored('qa', null, [
        { ww_scores: [], pt_scores: [], qa_score: null },
      ])
    ).toBe(false);
  });

  it('empty roster is never scored', () => {
    expect(slotRosterScored('ww', 0, [])).toBe(false);
  });
});
