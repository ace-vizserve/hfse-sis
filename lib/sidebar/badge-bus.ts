'use client';

// One Realtime channel per topic, however many hooks want it.
//
// ⚠ WHY THIS EXISTS — two concrete facts, not a hypothetical.
//
// 1. `@supabase/ssr@0.10.2`'s `createBrowserClient` returns a SINGLETON in
//    the browser (`cachedBrowserClient`,
//    node_modules/@supabase/ssr/dist/main/createBrowserClient.js:8-14), so
//    every `createClient()` call across the app shares ONE
//    `RealtimeClient` and therefore one channel registry.
// 2. `@supabase/realtime-js@2.103.0`'s `RealtimeClient.channel(topic, ...)`
//    dedupes by topic — a second call with the same topic returns the SAME
//    `RealtimeChannel` instance the first call created (the second call's
//    `params` are silently discarded) — and `RealtimeClient.removeChannel()`
//    is UNREFCOUNTED: it unsubscribes and tears the channel down by topic
//    unconditionally (`_remove` filters `this.channels` on
//    `c.topic !== channel.topic`, full stop).
//
// Put together: the sidebar badge and the header bell both mount
// `useChangeRequestCount`, and a module-to-module navigation unmounts one
// layout while mounting another. Under Postgres Changes each hook built a
// per-instance channel name via `useId`, so this was never a problem. A
// Broadcast topic IS the channel name, so both hooks now want the exact
// same channel object — and because teardown is unrefcounted, whichever
// hook's cleanup runs `removeChannel()` first silently kills the OTHER
// hook's still-mounted, still-live subscription. No error, no signal — the
// surviving badge just stops updating.
//
// This module is the fix: it refcounts subscribers per topic itself, so the
// underlying Realtime channel opens on the first subscriber and closes only
// on the last one out. Deleting this file and calling `supabase.channel()`
// directly from two hooks reintroduces the silent-teardown bug above — it
// will not fail a test against a naive mock, only in the browser, only when
// one badge outlives another's unmount, and only as a badge that quietly
// stops moving.
import { createClient } from '@/lib/supabase/client';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const channels = new Map<string, unknown>();

export function subscribeToBadgeTopic(topic: string, fn: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(fn);

  if (!channels.has(topic)) {
    const supabase = createClient();
    // Placeholder reserves the topic before the async auth completes, so two
    // hooks mounting in the same tick cannot both open a channel.
    channels.set(topic, 'pending');
    void (async () => {
      await supabase.realtime.setAuth();
      const channel = supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'badge' }, () => {
          for (const listener of listeners.get(topic) ?? []) listener();
        })
        .subscribe();
      channels.set(topic, channel);
    })();
  }

  return () => {
    const current = listeners.get(topic);
    if (!current) return;
    current.delete(fn);
    if (current.size > 0) return;
    listeners.delete(topic);
    const channel = channels.get(topic);
    channels.delete(topic);
    if (channel && channel !== 'pending') {
      createClient().removeChannel(channel as never);
    }
  };
}
