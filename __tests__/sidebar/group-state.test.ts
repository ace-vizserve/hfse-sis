import { describe, expect, it } from 'vitest';

import type { NavSection } from '@/lib/auth/roles';
import {
  decodeGroupCookie,
  encodeGroupCookie,
  expandedGroupsFor,
  groupKey,
  isCollapsibleGroup,
  resolveExpandedGroups,
  sumGroupBadges,
} from '@/lib/sidebar/group-state';

const SECTIONS: NavSection[] = [
  // No label — the Dashboard row every module opens with. Never collapsible.
  { items: [{ href: '/records', label: 'Dashboard' }] },
  {
    label: 'Operations',
    items: [
      { href: '/records/students', label: 'Students' },
      {
        href: '/records/unsynced',
        label: 'Unsynced',
        badgeKey: 'unsyncedStudents',
      },
    ],
  },
  // Single item — a toggle here would hide one row.
  { label: 'Cohorts', items: [{ href: '/records/cohorts', label: 'Cohorts' }] },
  {
    label: 'Admin',
    items: [
      { href: '/records/audit-log', label: 'Audit Log' },
      {
        href: '/records/level-mismatches',
        label: 'Levels',
        badgeKey: 'levelMismatches',
      },
    ],
  },
];

describe('groupKey', () => {
  it('slugifies a label', () => {
    expect(groupKey('Quick filters')).toBe('quick-filters');
    expect(groupKey('Year Setup')).toBe('year-setup');
  });

  it('collapses punctuation and trims separators', () => {
    expect(groupKey('  Pre-Course / Counselling  ')).toBe(
      'pre-course-counselling'
    );
  });
});

describe('isCollapsibleGroup', () => {
  it('requires both a label and more than one item', () => {
    expect(isCollapsibleGroup(SECTIONS[0])).toBe(false); // no label
    expect(isCollapsibleGroup(SECTIONS[1])).toBe(true);
    expect(isCollapsibleGroup(SECTIONS[2])).toBe(false); // single item
  });
});

describe('cookie codec', () => {
  it('round-trips multiple modules', () => {
    const state = { records: ['operations', 'admin'], sis: ['year-setup'] };
    expect(decodeGroupCookie(encodeGroupCookie(state))).toEqual(state);
  });

  it('drops modules with nothing open rather than writing empty entries', () => {
    expect(encodeGroupCookie({ records: [], sis: ['system'] })).toBe(
      'sis:system'
    );
  });

  it('reads a percent-encoded value, since the client writes one', () => {
    const raw = encodeURIComponent('records:operations,admin|sis:system');
    expect(decodeGroupCookie(raw)).toEqual({
      records: ['operations', 'admin'],
      sis: ['system'],
    });
  });

  it('survives a malformed value instead of throwing', () => {
    expect(() => decodeGroupCookie('%')).not.toThrow();
    expect(decodeGroupCookie(undefined)).toEqual({});
    expect(decodeGroupCookie('garbage-with-no-colon')).toEqual({});
  });

  it('expandedGroupsFor returns undefined for a module never touched', () => {
    expect(expandedGroupsFor('sis:system', 'records')).toBeUndefined();
    expect(expandedGroupsFor('sis:system', 'sis')).toEqual(['system']);
  });
});

describe('resolveExpandedGroups', () => {
  it('with no saved state opens only the group holding the current page', () => {
    const open = resolveExpandedGroups({
      sections: SECTIONS,
      activeHref: '/records/students',
      saved: undefined,
    });
    expect([...open]).toEqual(['operations']);
  });

  it('opens nothing when no saved state and the active page is outside every collapsible group', () => {
    const open = resolveExpandedGroups({
      sections: SECTIONS,
      activeHref: '/records',
      saved: undefined,
    });
    expect(open.size).toBe(0);
  });

  it('honours saved state', () => {
    const open = resolveExpandedGroups({
      sections: SECTIONS,
      activeHref: '/records',
      saved: ['admin'],
    });
    expect([...open]).toEqual(['admin']);
  });

  it('forces the active group open even when saved state omits it', () => {
    const open = resolveExpandedGroups({
      sections: SECTIONS,
      activeHref: '/records/students',
      saved: ['admin'],
    });
    expect(open.has('operations')).toBe(true);
    expect(open.has('admin')).toBe(true);
  });

  // The reason groups are keyed by slug rather than index: resolveSectionsForRole
  // drops groups a role cannot see, so the same index is a different group for a
  // teacher than for the coordinator.
  it('ignores a saved key whose group is not in this role’s sections', () => {
    const open = resolveExpandedGroups({
      sections: SECTIONS,
      activeHref: '/records',
      saved: ['admin', 'a-group-this-role-cannot-see'],
    });
    expect([...open]).toEqual(['admin']);
  });

  it('never returns a non-collapsible group', () => {
    const open = resolveExpandedGroups({
      sections: SECTIONS,
      activeHref: '/records/cohorts',
      saved: ['cohorts'],
    });
    expect(open.has('cohorts')).toBe(false);
  });
});

describe('sumGroupBadges', () => {
  it('totals the badges a collapsed group would hide', () => {
    expect(sumGroupBadges(SECTIONS[1].items, { unsyncedStudents: 5 })).toBe(5);
  });

  it('is zero when the group carries no badged item', () => {
    expect(sumGroupBadges(SECTIONS[2].items, { unsyncedStudents: 5 })).toBe(0);
  });

  it('is zero when no badge payload was supplied', () => {
    expect(sumGroupBadges(SECTIONS[1].items, undefined)).toBe(0);
  });
});
