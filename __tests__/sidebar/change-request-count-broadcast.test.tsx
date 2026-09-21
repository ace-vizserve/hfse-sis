import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { channels, handlers, setAuthCalls, removeChannelCalls, count } =
  vi.hoisted(() => ({
    channels: [] as Array<{ topic: string; opts: unknown }>,
    handlers: [] as Array<() => Promise<void>>,
    setAuthCalls: { n: 0 },
    removeChannelCalls: { n: 0 },
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
      // Observable so the refcounting test below can assert it is withheld
      // while a second subscriber is still on the topic, and fired once the
      // last one leaves.
      removeChannel: () => {
        removeChannelCalls.n += 1;
      },
    };
  },
}));

import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';

beforeEach(() => {
  channels.length = 0;
  handlers.length = 0;
  setAuthCalls.n = 0;
  removeChannelCalls.n = 0;
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

  it('keeps the shared channel alive for a surviving subscriber, and tears it down only once the last one leaves', async () => {
    // This is the regression the badge-bus refcounting exists to prevent:
    // realtime-js's removeChannel() is unrefcounted and tears down by topic,
    // and the sidebar badge + header bell share one Realtime client (the
    // browser client is a singleton). Without refcounting, whichever of the
    // two unmounts first (e.g. a module-to-module navigation) would silently
    // kill the other's still-live subscription. The 4th test above cannot see
    // this — it never unmounts anything.
    const sidebarBadge = renderHook(() =>
      useChangeRequestCount('school_admin', 'u-1', 0)
    );
    const headerBell = renderHook(() =>
      useChangeRequestCount('school_admin', 'u-1', 0)
    );
    await waitFor(() => expect(handlers.length).toBe(1));

    sidebarBadge.unmount();
    // A second subscriber (the header bell) is still mounted, so the shared
    // channel must NOT be torn down yet.
    expect(removeChannelCalls.n).toBe(0);

    // The surviving subscriber must still receive pings on the one remaining
    // channel — proof the bus fanned the broadcast out rather than the
    // channel having died along with the first subscriber.
    count.value = 11;
    await act(async () => {
      await handlers[0]();
    });
    await waitFor(() => expect(headerBell.result.current).toBe(11));

    headerBell.unmount();
    await waitFor(() => expect(removeChannelCalls.n).toBe(1));
  });
});
