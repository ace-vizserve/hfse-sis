import { describe, expect, it } from 'vitest';

import { formatSgd, formatSyncedAt } from '@/lib/qbo/format';

describe('QuickBooks formatting', () => {
  it('money as S$ with two decimals', () => {
    expect(formatSgd(3200)).toBe('S$3,200.00');
    expect(formatSgd(0)).toBe('S$0.00');
  });
  it('synced time: clock today, date otherwise', () => {
    const now = new Date('2026-10-14T12:00:00+08:00');
    expect(formatSyncedAt('2026-10-14T10:42:00+08:00', now)).toBe(
      'Synced 10:42'
    );
    expect(formatSyncedAt('2026-10-12T10:42:00+08:00', now)).toBe(
      'Synced 12 Oct'
    );
  });
});
