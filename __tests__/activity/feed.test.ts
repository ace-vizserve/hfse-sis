import { describe, it, expect } from 'vitest';

import { pageEvents, SOURCE_CAP } from '@/lib/activity/feed';
import type { ActivityEvent } from '@/lib/activity/events';

function ev(id: string, at: string): ActivityEvent {
  return {
    id,
    flow: 'grade_change',
    requestId: id,
    at,
    tone: 'started',
    actorLabel: 'Someone',
    actorInitials: 'S',
    predicate: 'did a thing.',
    details: null,
    href: '#',
  };
}

describe('pageEvents', () => {
  const all = [
    ev('a', '2026-08-28T05:00:00.000Z'),
    ev('b', '2026-08-28T04:00:00.000Z'),
    ev('c', '2026-08-28T03:00:00.000Z'),
    ev('d', '2026-08-28T02:00:00.000Z'),
    ev('e', '2026-08-28T01:00:00.000Z'),
  ];

  it('returns the newest page first and a cursor for the next', () => {
    const page = pageEvents(all, null, 2);

    expect(page.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({
      at: '2026-08-28T04:00:00.000Z',
      id: 'b',
    });
  });

  it('continues from the cursor without repeating or skipping', () => {
    const first = pageEvents(all, null, 2);
    const second = pageEvents(all, first.nextCursor, 2);
    const third = pageEvents(all, second.nextCursor, 2);

    expect(second.events.map((e) => e.id)).toEqual(['c', 'd']);
    expect(third.events.map((e) => e.id)).toEqual(['e']);
    expect(third.nextCursor).toBeNull();
  });

  // The bug this guards: two sources that both emitted at the same instant.
  it('does not lose an event that shares a timestamp with the cursor', () => {
    const tied = [
      ev('a', '2026-08-28T05:00:00.000Z'),
      ev('b', '2026-08-28T04:00:00.000Z'),
      ev('c', '2026-08-28T04:00:00.000Z'),
      ev('d', '2026-08-28T03:00:00.000Z'),
    ];

    const first = pageEvents(tied, null, 2);
    const second = pageEvents(tied, first.nextCursor, 2);

    expect(first.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(second.events.map((e) => e.id)).toEqual(['c', 'd']);
  });

  it('reports no next cursor when the last page exactly fills', () => {
    expect(pageEvents(all.slice(0, 2), null, 2).nextCursor).toBeNull();
  });

  it('caps each source well above anything this school produces', () => {
    expect(SOURCE_CAP).toBeGreaterThanOrEqual(400);
  });
});
