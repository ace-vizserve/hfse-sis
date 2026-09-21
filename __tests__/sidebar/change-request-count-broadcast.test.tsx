import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  channels,
  handlers,
  setAuthCalls,
  removeChannelCalls,
  count,
  authControl,
  subscribeStatus,
  subscribeThrows,
} = vi.hoisted(() => ({
  channels: [] as Array<{ topic: string; opts: unknown }>,
  handlers: [] as Array<() => Promise<void>>,
  setAuthCalls: { n: 0 },
  removeChannelCalls: { n: 0 },
  count: { value: 7 },
  // Lets individual tests control setAuth's timing/outcome (resolve late,
  // or reject) without touching the shape of the mock client itself.
  authControl: {
    impl: async () => {
      setAuthCalls.n += 1;
    },
  } as { impl: () => Promise<void> },
  // Lets a test drive the status .subscribe()'s callback fires with —
  // real-world values include SUBSCRIBED, CLOSED, CHANNEL_ERROR, TIMED_OUT.
  subscribeStatus: { value: 'SUBSCRIBED' as string },
  // Lets a test force .subscribe() itself to throw synchronously, once, to
  // prove the open() try/catch covers channel construction and not just
  // setAuth().
  subscribeThrows: { once: false },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel: Record<string, unknown> = {};
    channel.on = (_e: string, _cfg: unknown, cb: () => Promise<void>) => {
      handlers.push(cb);
      return channel;
    };
    channel.subscribe = (cb?: (status: string) => void) => {
      if (subscribeThrows.once) {
        subscribeThrows.once = false;
        throw new Error('boom-subscribe');
      }
      cb?.(subscribeStatus.value);
      return channel;
    };

    // The real client splits table access across TWO builder classes:
    // PostgrestQueryBuilder (all `.from()` returns — only `.select()` lives
    // here) and PostgrestFilterBuilder (`.eq()`/`.or()`/`.is()`/
    // `.maybeSingle()`, returned BY `.select()`). Collapsing both into one
    // object hid a real production bug: a role guard that called `.eq()`
    // straight off `.from()` without `.select()` first threw
    // `TypeError: qb.eq is not a function` inside a useEffect (uncaught by
    // React, unmounting the tree) while this suite stayed green. Keep the
    // split faithful so that regression cannot hide again.
    const filterBuilder: Record<string, unknown> = {};
    for (const m of ['eq', 'or', 'is', 'maybeSingle']) {
      filterBuilder[m] = (..._a: unknown[]) => filterBuilder;
    }
    // academic_years lookup resolves first, then the count query — both
    // chains bottom out on the same filter builder shape in this mock.
    filterBuilder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: { id: 'ay-1' },
        count: count.value,
        error: null,
      }).then(resolve);

    return {
      realtime: {
        setAuth: async () => authControl.impl(),
      },
      channel: (topic: string, opts: unknown) => {
        channels.push({ topic, opts });
        return channel;
      },
      from: () => ({
        select: (..._a: unknown[]) => filterBuilder,
      }),
      // Observable so the refcounting test below can assert it is withheld
      // while a second subscriber is still on the topic, and fired once the
      // last one leaves.
      removeChannel: () => {
        removeChannelCalls.n += 1;
      },
    };
  },
}));

import {
  __resetBadgeBus,
  subscribeToBadgeTopic,
} from '@/lib/sidebar/badge-bus';
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';

beforeEach(() => {
  channels.length = 0;
  handlers.length = 0;
  setAuthCalls.n = 0;
  removeChannelCalls.n = 0;
  count.value = 7;
  authControl.impl = async () => {
    setAuthCalls.n += 1;
  };
  subscribeStatus.value = 'SUBSCRIBED';
  subscribeThrows.once = false;
  // The bus is a module-global singleton (by design — see its header
  // comment). Tasks 5 and 6 add more hooks against this same module, so
  // resetting between tests is a correctness guard for tests not yet
  // written, not just hygiene: a leftover 'pending'/channel entry from one
  // test would silently make the next test's first subscriber a no-op.
  __resetBadgeBus();
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
    // `channels` records one push per `supabase.channel()` call (see the
    // mock above), so this is a count of channels actually opened — not just
    // of distinct topic strings, which would stay 1 even if the bus opened a
    // channel per hook instance (both hooks pass the same fixed topic).
    expect(channels.length).toBe(1);
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

  it('does not open a channel if the only subscriber leaves before setAuth resolves', async () => {
    // Guards the fix for a real leak: if setAuth() were still awaited after
    // the last listener left, the bus would open a channel nobody wants and
    // nothing could ever close it (the refcount never returns to 1). Also
    // what keeps React StrictMode's dev-mode mount->cleanup->remount (which
    // happens synchronously, well inside setAuth's async gap) from accruing
    // two live bindings for one logical subscriber.
    let releaseAuth: () => void = () => {};
    authControl.impl = () =>
      new Promise<void>((resolve) => {
        releaseAuth = () => {
          setAuthCalls.n += 1;
          resolve();
        };
      });

    const unsubscribe = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      () => {}
    );
    unsubscribe(); // leaves before setAuth ever resolves

    releaseAuth();
    await waitFor(() => expect(setAuthCalls.n).toBe(1));
    // Give the microtask/macrotask queue a turn so open() resumes past the
    // now-resolved setAuth() and reaches its post-auth guard.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(channels.length).toBe(0);
  });

  it('clears the pending entry when setAuth rejects, so a later subscriber can retry', async () => {
    authControl.impl = async () => {
      throw new Error('boom');
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const firstUnsubscribe = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      () => {}
    );
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(channels.length).toBe(0);
    firstUnsubscribe();

    // A fresh subscriber, after the failure, must not inherit a wedged
    // 'pending' entry — the topic has to be genuinely retryable.
    authControl.impl = async () => {
      setAuthCalls.n += 1;
    };
    const secondUnsubscribe = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      () => {}
    );
    await waitFor(() => expect(channels.length).toBe(1));
    secondUnsubscribe();

    errorSpy.mockRestore();
  });

  it('logs CHANNEL_ERROR but not CLOSED from the subscribe status callback', async () => {
    // CLOSED fires on every ORDINARY teardown (including the bus's own
    // last-unsubscribe path) — logging it as an error would bury the two
    // statuses that mean the join genuinely failed: CHANNEL_ERROR (e.g. an
    // RLS refusal on realtime.messages) and TIMED_OUT.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    subscribeStatus.value = 'CLOSED';
    const unsubscribeClosed = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      () => {}
    );
    await waitFor(() => expect(channels.length).toBe(1));
    expect(errorSpy).not.toHaveBeenCalled();
    unsubscribeClosed();
    await waitFor(() => expect(removeChannelCalls.n).toBe(1));

    errorSpy.mockClear();
    subscribeStatus.value = 'CHANNEL_ERROR';
    const unsubscribeError = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      () => {}
    );
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy).toHaveBeenCalledWith(
      '[badge-bus] topic "sis:grade-change-requests" subscribe status:',
      'CHANNEL_ERROR'
    );
    unsubscribeError();

    errorSpy.mockRestore();
  });

  it('clears the pending entry when .subscribe() throws synchronously (not just when setAuth rejects)', async () => {
    // Item 2 of fix round 2: the try/catch used to cover setAuth() only. A
    // throw from .channel()/.on()/.subscribe() would reject the un-awaited
    // open() call just as surely as a rejected setAuth() does, and would
    // otherwise leave `channels` wedged at 'pending' for the rest of the
    // session — every later subscriber silently doing nothing.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    subscribeThrows.once = true;

    const firstUnsubscribe = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      () => {}
    );
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy).toHaveBeenCalledWith(
      '[badge-bus] failed to open topic "sis:grade-change-requests"; badge will not update until a new subscriber retries:',
      expect.any(Error)
    );
    firstUnsubscribe();

    // A fresh subscriber must not inherit a wedged 'pending' entry — retry
    // has to actually reach a live, broadcast-receiving channel.
    const secondListener = vi.fn();
    const secondUnsubscribe = subscribeToBadgeTopic(
      'sis:grade-change-requests',
      secondListener
    );
    await waitFor(() => expect(channels.length).toBe(2));
    await act(async () => {
      await handlers[handlers.length - 1]();
    });
    expect(secondListener).toHaveBeenCalled();
    secondUnsubscribe();

    errorSpy.mockRestore();
  });
});
