import { describe, expect, it } from 'vitest';

import { auditContextSummary } from '@/lib/audit/humanize';

// house_points.entry.update — the context PATCH /api/house-points/entries/
// [entryId] stamps. Awards are always picked by hand (KD #228), so the line
// names the award, never a score.
describe('house_points.entry.update audit line', () => {
  it('names the award picked', () => {
    expect(
      auditContextSummary('house_points.entry.update', {
        eventName: 'Spelling Bee',
        studentName: 'TAN, Wei Ming',
        studentNumber: 'H250012',
        before: { placeId: null, placeLabel: null },
        after: { placeId: 'p1', placeLabel: 'Gold' },
        placeLabel: 'Gold',
      })
    ).toContain('Award: Gold');
  });

  it('says when the award was cleared', () => {
    const line = auditContextSummary('house_points.entry.update', {
      teamName: 'Rockets',
      before: { placeId: 'p1', placeLabel: 'Gold' },
      after: { placeId: null, placeLabel: null },
      placeLabel: null,
    });
    expect(line).toContain('Rockets');
    expect(line).toContain('Award cleared');
    expect(line).not.toMatch(/score/i);
  });
});
