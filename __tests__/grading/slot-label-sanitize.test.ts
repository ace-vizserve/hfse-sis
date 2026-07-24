import { describe, it, expect } from 'vitest';
import {
  sanitizeLabel,
  sanitizePage,
  sanitizeDate,
  sanitizeMeta,
  mergeSlotLabel,
} from '@/lib/grading/slot-label-sanitize';

describe('sanitizeLabel', () => {
  it('trims, caps at 120 chars, empty -> null', () => {
    expect(sanitizeLabel('  Worksheet 2  ')).toBe('Worksheet 2');
    expect(sanitizeLabel('')).toBe(null);
    expect(sanitizeLabel('   ')).toBe(null);
    expect(sanitizeLabel(null)).toBe(null);
    expect(sanitizeLabel('a'.repeat(200))!.length).toBe(120);
  });
});

describe('sanitizeDate', () => {
  it('accepts ISO date and the literal "Ongoing"', () => {
    expect(sanitizeDate('2026-07-01')).toBe('2026-07-01');
    expect(sanitizeDate('Ongoing')).toBe('Ongoing');
  });
  it('rejects anything else as null', () => {
    expect(sanitizeDate('not-a-date')).toBe(null);
    expect(sanitizeDate('')).toBe(null);
    expect(sanitizeDate(null)).toBe(null);
  });
});

describe('sanitizeMeta', () => {
  it('sanitizes all three fields independently', () => {
    expect(
      sanitizeMeta({ label: '  Quiz  ', date: 'Ongoing', page: '  p.5  ' })
    ).toEqual({ label: 'Quiz', date: 'Ongoing', page: 'p.5' });
    expect(sanitizeMeta(null)).toBe(null);
  });
});

describe('mergeSlotLabel', () => {
  it('WW/PT: patches only the targeted index, preserving the rest of the array', () => {
    const current = {
      ww: [{ label: 'W1', date: '2026-07-01', page: null }, null],
      pt: [],
      qa: null,
    };
    const merged = mergeSlotLabel(current, {
      kind: 'ww',
      index: 1,
      meta: { label: 'W2', date: '2026-07-02', page: null },
    });
    expect(merged.ww?.[0]).toEqual({
      label: 'W1',
      date: '2026-07-01',
      page: null,
    });
    expect(merged.ww?.[1]).toEqual({
      label: 'W2',
      date: '2026-07-02',
      page: null,
    });
  });

  it('WW/PT: pads with nulls when the index is beyond the current array length', () => {
    const merged = mergeSlotLabel(
      { ww: [], pt: [], qa: null },
      {
        kind: 'pt',
        index: 2,
        meta: { label: 'PT3', date: '2026-07-03', page: null },
      }
    );
    expect(merged.pt).toEqual([
      null,
      null,
      { label: 'PT3', date: '2026-07-03', page: null },
    ]);
  });

  it('QA: replaces the qa string, ignores ww/pt', () => {
    const current = {
      ww: [{ label: 'W1', date: '2026-07-01', page: null }],
      pt: [],
      qa: null,
    };
    const merged = mergeSlotLabel(current, {
      kind: 'qa',
      index: null,
      meta: { label: 'Quarterly Exam' },
    });
    expect(merged.qa).toBe('Quarterly Exam');
    expect(merged.ww).toEqual(current.ww);
  });

  it('handles a null current slot_labels (fresh sheet)', () => {
    const merged = mergeSlotLabel(null, {
      kind: 'ww',
      index: 0,
      meta: { label: 'W1', date: '2026-07-01', page: null },
    });
    expect(merged.ww?.[0]).toEqual({
      label: 'W1',
      date: '2026-07-01',
      page: null,
    });
  });
});
