import { describe, expect, it } from 'vitest';

import {
  gatherTimelineEntityIds,
  TIMELINE_ROW_LIMIT,
} from '@/lib/classroom/timeline';

describe('TIMELINE_ROW_LIMIT', () => {
  it('is 50', () => {
    expect(TIMELINE_ROW_LIMIT).toBe(50);
  });
});

describe('gatherTimelineEntityIds', () => {
  it('always includes the section id, even with no other sources', () => {
    const ids = gatherTimelineEntityIds({
      sectionId: 'sec-1',
      sheetIds: [],
      sectionStudentIds: [],
      writeupIds: [],
    });
    expect(ids).toEqual(['sec-1']);
  });

  it('unions all four sources', () => {
    const ids = gatherTimelineEntityIds({
      sectionId: 'sec-1',
      sheetIds: ['sheet-1', 'sheet-2'],
      sectionStudentIds: ['ss-1', 'ss-2'],
      writeupIds: ['wu-1'],
    });
    expect(new Set(ids)).toEqual(
      new Set(['sec-1', 'sheet-1', 'sheet-2', 'ss-1', 'ss-2', 'wu-1'])
    );
    expect(ids).toHaveLength(6);
  });

  it('de-duplicates ids that appear in more than one source', () => {
    // Pathological but cheap to guard: if the same uuid ever showed up in
    // two categories, the query should still only ask for it once.
    const ids = gatherTimelineEntityIds({
      sectionId: 'shared-id',
      sheetIds: ['shared-id', 'sheet-2'],
      sectionStudentIds: [],
      writeupIds: [],
    });
    expect(ids).toEqual(['shared-id', 'sheet-2']);
  });

  it('drops nothing silently — every input id appears in the output', () => {
    const sources = {
      sectionId: 'sec-1',
      sheetIds: ['sheet-1'],
      sectionStudentIds: ['ss-1'],
      writeupIds: ['wu-1'],
    };
    const ids = new Set(gatherTimelineEntityIds(sources));
    expect(ids.has(sources.sectionId)).toBe(true);
    for (const id of [
      ...sources.sheetIds,
      ...sources.sectionStudentIds,
      ...sources.writeupIds,
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
