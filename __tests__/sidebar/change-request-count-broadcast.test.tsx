import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { channels, handlers, setAuthCalls, count } = vi.hoisted(() => ({
  channels: [] as Array<{ topic: string; opts: unknown }>,
  handlers: [] as Array<() => Promise<void>>,
  setAuthCalls: { n: 0 },
  count: { value: 7 },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel: Record<string, unknown> = {};
    channel.on = (_e: string, _cfg: unknown, cb: () => Promise<void>) => {
      handlers.push(cb);
      return channel;
    };
    channel.subscribe = () => channel;

    return {
      realtime: {
        setAuth: async () => {
          setAuthCalls.n += 1;
        },
      },
      channel: (topic: string, opts: unknown) => {
        channels.push({ topic, opts });
        return channel;
      },
      from: () => {
        const query: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'or', 'is', 'maybeSingle']) {
          query[m] = (..._a: unknown[]) => query;
        }
        // academic_years lookup resolves first, then the count query.
        query.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: { id: 'ay-1' },
            count: count.value,
            error: null,
          }).then(resolve);
        return query;
      },
      removeChannel: () => {},
    };
  },
}));

import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';

beforeEach(() => {
  channels.length = 0;
  handlers.length = 0;
  setAuthCalls.n = 0;
  count.value = 7;
});

describe('useChangeRequestCount over Broadcast', () => {
  it('joins the fixed topic as a private channel', async () => {
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    await waitFor(() => expect(channels.length).toBe(1));
    expect(channels[0].topic).toBe('sis:grade-change-requests');
    expect(channels[0].opts).toEqual({ config: { private: true } });
  });

  it('authenticates the socket before subscribing', async () => {
    // A private channel is refused without setAuth, and the failure is a
    // silently dead badge rather than an error.
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    await waitFor(() => expect(setAuthCalls.n).toBe(1));
  });

  it('re-counts when a ping arrives', async () => {
    const { result } = renderHook(() =>
      useChangeRequestCount('school_admin', 'u-1', 0)
    );
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    count.value = 9;
    await act(async () => {
      await handlers[0]();
    });
    await waitFor(() => expect(result.current).toBe(9));
  });

  it('opens ONE channel per topic even when two hooks mount', async () => {
    // Both the sidebar badge and the header bell mount this hook. Under
    // Postgres Changes each had a per-instance channel name; a Broadcast topic
    // IS the channel name, so this is the collision risk the plan calls out.
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    await waitFor(() => expect(channels.length).toBeGreaterThan(0));
    const topics = new Set(channels.map((c) => c.topic));
    expect(topics.size).toBe(1);
  });
});
