import { describe, expect, it } from 'vitest';

import { completionBand } from '@/lib/p-files/completion-band';

describe('completionBand', () => {
  it('calls a file complete only when every applicable document is valid', () => {
    expect(completionBand(10, 10)).toBe('complete');
    expect(completionBand(10, 9)).not.toBe('complete');
  });

  it('puts 80% and above, short of 100%, in nearly complete', () => {
    expect(completionBand(10, 8)).toBe('nearly-complete');
    expect(completionBand(15, 12)).toBe('nearly-complete');
    expect(completionBand(10, 9)).toBe('nearly-complete');
  });

  it('does not round 79.x% up into nearly complete', () => {
    // 11 of 14 is 78.6% — the table's rounded percentage would never show 80,
    // but 31 of 39 is 79.5%, which a rounded figure WOULD show as 80.
    expect(completionBand(14, 11)).toBe('incomplete');
    expect(completionBand(39, 31)).toBe('incomplete');
  });

  it('gives no band to a child with nothing applicable', () => {
    expect(completionBand(0, 0)).toBeNull();
  });
});
