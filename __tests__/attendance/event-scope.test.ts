import { describe, expect, it } from 'vitest';

import {
  describeClassScope,
  eventAppliesToSection,
  describeLevelScope,
  isContiguousRun,
  sortLevels,
  spansBothBands,
} from '@/lib/attendance/event-scope';

describe('sortLevels', () => {
  it('returns the canonical P1→S4 order, not click order', () => {
    expect(sortLevels(['S1', 'P6', 'P1'])).toEqual(['P1', 'P6', 'S1']);
  });

  it('drops duplicates', () => {
    expect(sortLevels(['P3', 'P3'])).toEqual(['P3']);
  });
});

describe('isContiguousRun', () => {
  it('treats a run across the primary/secondary boundary as contiguous', () => {
    // P6 → S1 is a real run at HFSE: Leadership Camp is P4 through S4.
    expect(isContiguousRun(['P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4'])).toBe(
      true
    );
  });

  it('rejects a gap', () => {
    expect(isContiguousRun(['P1', 'P3'])).toBe(false);
  });

  it('is true for none or one', () => {
    expect(isContiguousRun([])).toBe(true);
    expect(isContiguousRun(['P2'])).toBe(true);
  });
});

describe('describeLevelScope', () => {
  it('says everyone when nothing is chosen', () => {
    expect(describeLevelScope([])).toBe('Everyone.');
  });

  it('says everyone when all ten are chosen, rather than listing them', () => {
    expect(
      describeLevelScope([
        'P1',
        'P2',
        'P3',
        'P4',
        'P5',
        'P6',
        'S1',
        'S2',
        'S3',
        'S4',
      ])
    ).toBe('Everyone.');
  });

  it('names a single level in the words the school uses', () => {
    // Not "P6" — the picker already shows the code; the sentence confirms it.
    expect(describeLevelScope(['P6'])).toBe('Primary Six only.');
  });

  it('describes a run by its ends', () => {
    expect(describeLevelScope(['P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4'])).toBe(
      'Primary Four to Secondary Four.'
    );
  });

  it('reads two levels as a pair, the way the school writes it', () => {
    // "Primary Two and Three Fieldtrip" is the published calendar's own wording.
    expect(describeLevelScope(['P2', 'P3'])).toBe(
      'Primary Two and Primary Three.'
    );
    // A pair need not be adjacent.
    expect(describeLevelScope(['P1', 'P6'])).toBe(
      'Primary One and Primary Six.'
    );
  });

  it('lists a scattered set, which has no shorthand', () => {
    expect(describeLevelScope(['P1', 'P3', 'P5'])).toBe(
      'Primary One, Primary Three, Primary Five.'
    );
  });

  it('ignores the order they were clicked in', () => {
    expect(describeLevelScope(['S4', 'P4', 'S1', 'P6', 'P5', 'S3', 'S2'])).toBe(
      'Primary Four to Secondary Four.'
    );
  });
});

describe('spansBothBands', () => {
  it('is true only when both halves are represented', () => {
    expect(spansBothBands(['P6', 'S1'])).toBe(true);
    expect(spansBothBands(['P1', 'P6'])).toBe(false);
    expect(spansBothBands(['S1', 'S4'])).toBe(false);
    expect(spansBothBands([])).toBe(false);
  });
});

describe('describeClassScope', () => {
  it('counts classes in plain words', () => {
    expect(describeClassScope(0)).toBe('No classes chosen yet.');
    expect(describeClassScope(1)).toBe('1 class.');
    expect(describeClassScope(2)).toBe('2 classes.');
  });
});

describe('eventAppliesToSection', () => {
  const p1 = { levelCode: 'P1' as const, sectionId: 'sec-p1' };
  const p6 = { levelCode: 'P6' as const, sectionId: 'sec-p6' };
  const s4 = { levelCode: 'S4' as const, sectionId: 'sec-s4' };

  it('keeps a P6 event off a P1 register — the reported bug', () => {
    const fieldtrip = {
      audience: 'primary' as const,
      levels: ['P6' as const],
      sectionIds: null,
    };
    expect(eventAppliesToSection(fieldtrip, p6)).toBe(true);
    expect(eventAppliesToSection(fieldtrip, p1)).toBe(false);
  });

  it('shows a mixed-band event to both its halves and nobody else', () => {
    // Leadership Camp, P4-S4. Its derived audience is 'all', so the old
    // audience-only path would have shown it to P1 as well.
    const camp = {
      audience: 'all' as const,
      levels: ['P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4'] as const,
      sectionIds: null,
    };
    expect(eventAppliesToSection(camp, p6)).toBe(true);
    expect(eventAppliesToSection(camp, s4)).toBe(true);
    expect(eventAppliesToSection(camp, p1)).toBe(false);
  });

  it('lets classes beat levels', () => {
    const party = {
      audience: 'primary' as const,
      levels: null,
      sectionIds: ['sec-p6'],
    };
    expect(eventAppliesToSection(party, p6)).toBe(true);
    expect(
      eventAppliesToSection(party, { levelCode: 'P6', sectionId: 'sec-other' })
    ).toBe(false);
  });

  it('falls back to audience for a pre-158 row', () => {
    const legacyAll = {
      audience: 'all' as const,
      levels: null,
      sectionIds: null,
    };
    const legacySec = {
      audience: 'secondary' as const,
      levels: null,
      sectionIds: null,
    };
    expect(eventAppliesToSection(legacyAll, p1)).toBe(true);
    expect(eventAppliesToSection(legacySec, s4)).toBe(true);
    expect(eventAppliesToSection(legacySec, p1)).toBe(false);
  });

  it('treats an empty array as no scope, not as "nobody"', () => {
    const odd = { audience: 'all' as const, levels: [], sectionIds: [] };
    expect(eventAppliesToSection(odd, p1)).toBe(true);
  });

  it('shows only whole-school events to a section with no known level', () => {
    const unknown = { levelCode: null, sectionId: 'sec-x' };
    expect(
      eventAppliesToSection(
        { audience: 'all', levels: null, sectionIds: null },
        unknown
      )
    ).toBe(true);
    expect(
      eventAppliesToSection(
        { audience: 'primary', levels: null, sectionIds: null },
        unknown
      )
    ).toBe(false);
    expect(
      eventAppliesToSection(
        { audience: 'primary', levels: ['P1'], sectionIds: null },
        unknown
      )
    ).toBe(false);
  });
});
