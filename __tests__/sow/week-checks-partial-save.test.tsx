import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Save Week N" posts one check per class. When one class saves and the next
 * is refused, the screen must not drop the saved class's choice while still
 * showing the old server value (final fix wave, carried from Task 13).
 * Pinned: drafts are cleared only once every class saved, and a refusal
 * refreshes the page so what was saved shows as saved.
 */

const { refreshMock, apiFetchMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  apiFetchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock, replace: vi.fn() }),
  usePathname: () => '/classroom/sow',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/query/fetcher', () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  jsonInit: (method: string, body: unknown) => ({
    method,
    body: JSON.stringify(body),
  }),
}));
// The real hook toasts and waits on a refresh transition; here it just runs
// the work and swallows the refusal, as the real one does after its toast.
vi.mock('@/lib/hooks/use-write-action', () => ({
  useWriteAction:
    () =>
    async <T,>(work: () => Promise<T>) => {
      try {
        return await work();
      } catch {
        return undefined;
      }
    },
}));

import { WeekChecks } from '@/components/sow/week-checks';
import type { SowCheckClass, SowChecking } from '@/lib/sow/checks';

const cls = (sectionId: string, name: string): SowCheckClass => ({
  sectionId,
  name,
  mark: 'todo',
  signed: false,
  notes: [],
  canCheck: true,
  mine: null,
  reliefNotes: [],
  asked: null,
});

const checking: SowChecking = {
  thisWeekNumber: 1,
  canCheck: true,
  summary: '',
  weeks: [
    {
      weekNumber: 1,
      startsOn: '2026-10-05',
      endsOn: '2026-10-09',
      topic: 'Counting',
      learningOutcomes: null,
      activities: null,
      assessment: null,
      events: [],
      started: true,
      ended: false,
      classes: [cls('sec-a', 'P1 Joy'), cls('sec-b', 'P1 Hope')],
    },
  ],
};

beforeEach(() => {
  refreshMock.mockReset();
  apiFetchMock.mockReset();
});

const asPlanned = (name: string) =>
  within(
    screen.getByRole('radiogroup', { name: `${name} this week` })
  ).getByRole('radio', { name: 'As planned' });

describe('WeekChecks — one class saves, the next is refused', () => {
  it('keeps the saved class showing its choice and refreshes', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('This week is signed.'));
    render(<WeekChecks sowId="sow-1" checking={checking} />);

    fireEvent.click(asPlanned('P1 Joy'));
    fireEvent.click(asPlanned('P1 Hope'));
    fireEvent.click(screen.getByRole('button', { name: /Save Week 1/ }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // Without the fix the saved class's draft was dropped, and with no
    // refresh it read as "nothing chosen" though the server had it.
    expect(asPlanned('P1 Joy').getAttribute('aria-checked')).toBe('true');
    expect(asPlanned('P1 Hope').getAttribute('aria-checked')).toBe('true');
  });
});
