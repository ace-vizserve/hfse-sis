import { describe, it, expect } from 'vitest';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';

describe('pickExtreme', () => {
  const rows = [
    { k: 'a', v: 3 },
    { k: 'b', v: 9 },
    { k: 'c', v: 1 },
  ];
  it('finds the max', () => {
    const r = pickExtreme(rows, (x) => x.v, 'max');
    expect(r.item?.k).toBe('b');
    expect(r.value).toBe(9);
    expect(r.isEmpty).toBe(false);
    expect(r.isTie).toBe(false);
  });
  it('finds the min', () => {
    expect(pickExtreme(rows, (x) => x.v, 'min').item?.k).toBe('c');
  });
  it('flags empty when no finite values', () => {
    const r = pickExtreme(
      [{ k: 'a', v: null }],
      (x) => x.v as number | null,
      'max'
    );
    expect(r.isEmpty).toBe(true);
    expect(r.item).toBeNull();
  });
  it('flags a tie at the extreme', () => {
    const r = pickExtreme(
      [
        { k: 'a', v: 5 },
        { k: 'b', v: 5 },
      ],
      (x) => x.v,
      'max'
    );
    expect(r.isTie).toBe(true);
  });
  it('skips null/NaN values', () => {
    const r = pickExtreme(
      [
        { k: 'a', v: null },
        { k: 'b', v: 4 },
      ],
      (x) => x.v as number | null,
      'max'
    );
    expect(r.item?.k).toBe('b');
  });
});

describe('meetsThreshold', () => {
  it('is false for null / below', () => {
    expect(meetsThreshold(null, 5)).toBe(false);
    expect(meetsThreshold(4, 5)).toBe(false);
  });
  it('is true at/above', () => {
    expect(meetsThreshold(5, 5)).toBe(true);
    expect(meetsThreshold(6, 5)).toBe(true);
  });
});
