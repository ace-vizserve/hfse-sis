/**
 * The admission-options matrix (/sis/admin/admission-options): the client-side
 * filters, the "Closed right now" summary, the bulk plan and its toast, the
 * year badge, and the bulk route's payload.
 */
import { describe, expect, it } from 'vitest';

import {
  NO_ADMIN_OPTION_FILTER,
  adminComboKey,
  ayRelation,
  bulkSessionMessage,
  countAdminCombosByTrack,
  filterAdminGroups,
  isAdminOptionFilterActive,
  planBulkSessionChange,
  sessionsAmong,
  summarizeClosedSessions,
  type AdminOptionCombo,
  type AdminOptionGroup,
} from '@/lib/admissions/options';
import { AdmissionOptionBulkToggleSchema } from '@/lib/schemas/admission-options';

function combo(
  levelLabel: string,
  classTypeLabel: string,
  track: 'Global' | 'Standard',
  sessions: Array<[string, 'morning' | 'afternoon' | 'whole_day', boolean]>
): AdminOptionCombo {
  return {
    levelLabel,
    classTypeLabel,
    levelId: levelLabel,
    track,
    sessions: sessions.map(([id, schedule, isOpen]) => ({
      id,
      schedule,
      isOpen,
    })),
  };
}

const P3: AdminOptionGroup = {
  levelId: 'p3',
  levelCode: 'P3',
  levelLabel: 'Primary Three',
  combos: [
    combo('Primary 3', 'Standard Class', 'Standard', [
      ['p3s-m', 'morning', false],
      ['p3s-a', 'afternoon', true],
    ]),
    combo('Primary 3', 'Global Class', 'Global', [
      ['p3g-m', 'morning', true],
      ['p3g-a', 'afternoon', false],
    ]),
  ],
};

const P6: AdminOptionGroup = {
  levelId: 'p6',
  levelCode: 'P6',
  levelLabel: 'Primary Six',
  combos: [
    combo('Primary 6', 'Standard Class', 'Standard', [
      ['p6s-m', 'morning', true],
      ['p6s-a', 'afternoon', true],
    ]),
    combo('Primary 6', 'Global Class', 'Global', [
      ['p6g-w', 'whole_day', true],
    ]),
  ],
};

const groups = [P3, P6];

describe('filterAdminGroups', () => {
  it('shows everything with no filter', () => {
    expect(filterAdminGroups(groups, NO_ADMIN_OPTION_FILTER)).toEqual(groups);
    expect(isAdminOptionFilterActive(NO_ADMIN_OPTION_FILTER)).toBe(false);
  });

  it('filters by track and keeps group order', () => {
    const out = filterAdminGroups(groups, {
      ...NO_ADMIN_OPTION_FILTER,
      track: 'Standard',
    });
    expect(out.map((g) => g.levelCode)).toEqual(['P3', 'P6']);
    expect(out.flatMap((g) => g.combos.map((c) => c.track))).toEqual([
      'Standard',
      'Standard',
    ]);
  });

  it('filters by any of several level codes; none means all', () => {
    const out = filterAdminGroups(groups, {
      ...NO_ADMIN_OPTION_FILTER,
      levelCodes: ['P6'],
    });
    expect(out.map((g) => g.levelCode)).toEqual(['P6']);
  });

  it('closed only keeps combinations with a closed session and drops empty groups', () => {
    const out = filterAdminGroups(groups, {
      ...NO_ADMIN_OPTION_FILTER,
      closedOnly: true,
    });
    expect(out.map((g) => g.levelCode)).toEqual(['P3']);
    expect(out[0].combos).toHaveLength(2);
  });

  it('does not mutate the input', () => {
    filterAdminGroups(groups, { ...NO_ADMIN_OPTION_FILTER, track: 'Global' });
    expect(P3.combos).toHaveLength(2);
  });
});

describe('countAdminCombosByTrack', () => {
  it('counts every tab under the other filters, ignoring the track one', () => {
    expect(
      countAdminCombosByTrack(groups, {
        ...NO_ADMIN_OPTION_FILTER,
        track: 'Global',
      })
    ).toEqual({ all: 4, Global: 2, Standard: 2 });
    expect(
      countAdminCombosByTrack(groups, {
        ...NO_ADMIN_OPTION_FILTER,
        closedOnly: true,
      })
    ).toEqual({ all: 2, Global: 1, Standard: 1 });
  });
});

describe('summarizeClosedSessions', () => {
  it('lists closed classes per session, in session order, by SIS level', () => {
    expect(summarizeClosedSessions(groups)).toEqual([
      {
        schedule: 'morning',
        entries: [
          {
            levelLabel: 'Primary Three',
            classTypeLabel: 'Standard Class',
            track: 'Standard',
          },
        ],
        onlyTrack: 'Standard',
      },
      {
        schedule: 'afternoon',
        entries: [
          {
            levelLabel: 'Primary Three',
            classTypeLabel: 'Global Class',
            track: 'Global',
          },
        ],
        onlyTrack: 'Global',
      },
    ]);
  });

  it('is empty when every session is open', () => {
    expect(summarizeClosedSessions([P6])).toEqual([]);
  });

  it('reports no single track when closures span both', () => {
    const mixed: AdminOptionGroup = {
      ...P3,
      combos: P3.combos.map((c) => ({
        ...c,
        sessions: c.sessions.map((s) => ({ ...s, isOpen: false })),
      })),
    };
    expect(summarizeClosedSessions([mixed])[0].onlyTrack).toBeNull();
  });
});

describe('planBulkSessionChange', () => {
  const selected = [...P3.combos, ...P6.combos];

  it('writes only the sessions that exist and differ', () => {
    expect(planBulkSessionChange(selected, 'morning', false)).toEqual({
      optionIds: ['p3g-m', 'p6s-m'],
      alreadyCount: 1,
      missingCount: 1,
    });
  });

  it('reopens only the closed ones', () => {
    expect(planBulkSessionChange(selected, 'afternoon', true)).toEqual({
      optionIds: ['p3g-a'],
      alreadyCount: 2,
      missingCount: 1,
    });
  });

  it('writes nothing when all are already in that state', () => {
    expect(
      planBulkSessionChange(selected, 'whole_day', true).optionIds
    ).toEqual([]);
  });

  it('offers only the sessions the selection has', () => {
    expect(sessionsAmong(P3.combos)).toEqual(['morning', 'afternoon']);
    expect(sessionsAmong(selected)).toEqual([
      'morning',
      'afternoon',
      'whole_day',
    ]);
    expect(sessionsAmong([])).toEqual([]);
  });
});

describe('bulkSessionMessage', () => {
  it('says what changed, in staff words', () => {
    expect(bulkSessionMessage('morning', false, 7)).toBe(
      'Morning closed for 7 classes'
    );
    expect(bulkSessionMessage('whole_day', true, 1)).toBe(
      'Whole day reopened for 1 class'
    );
  });

  it('says there was nothing to change', () => {
    expect(bulkSessionMessage('afternoon', false, 0)).toMatch(
      /^Nothing to change/
    );
  });
});

describe('adminComboKey', () => {
  it('separates name and class type so they cannot run together', () => {
    expect(adminComboKey({ levelLabel: 'A B', classTypeLabel: 'C' })).not.toBe(
      adminComboKey({ levelLabel: 'A', classTypeLabel: 'B C' })
    );
  });
});

describe('ayRelation', () => {
  it('reads a later year as upcoming, an earlier one as past', () => {
    expect(ayRelation('AY2026', 'AY2026')).toBe('current');
    expect(ayRelation('AY2027', 'AY2026')).toBe('upcoming');
    expect(ayRelation('AY2025', 'AY2026')).toBe('past');
    expect(ayRelation('ay2027', 'AY2026')).toBe('upcoming');
  });
});

describe('AdmissionOptionBulkToggleSchema', () => {
  const id = '6f1d6c1e-3b8a-4c2f-9a55-2b6f0d0a9e11';

  it('accepts a year, ids and a state, de-duplicating ids', () => {
    const parsed = AdmissionOptionBulkToggleSchema.parse({
      ayCode: 'ay2027',
      optionIds: [id, id.toUpperCase()],
      isOpen: false,
    });
    expect(parsed).toEqual({
      ayCode: 'AY2027',
      optionIds: [id],
      isOpen: false,
    });
  });

  it('refuses no ids, more than 200, or a non-uuid', () => {
    const base = { ayCode: 'AY2027', isOpen: true };
    expect(
      AdmissionOptionBulkToggleSchema.safeParse({ ...base, optionIds: [] })
        .success
    ).toBe(false);
    expect(
      AdmissionOptionBulkToggleSchema.safeParse({
        ...base,
        optionIds: Array.from({ length: 201 }, () => id),
      }).success
    ).toBe(false);
    expect(
      AdmissionOptionBulkToggleSchema.safeParse({
        ...base,
        optionIds: ['nope'],
      }).success
    ).toBe(false);
  });
});
