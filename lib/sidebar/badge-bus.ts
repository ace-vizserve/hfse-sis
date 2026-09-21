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
//
// ⚠ TEARDOWN IS SERIALIZED PER TOPIC — `teardowns`. `removeChannel()` is
// itself async (it awaits the socket's leave ack before dropping the
// channel from the client's registry), so `NotificationBell` mounted in
// all eight route-group layouts drives this refcount 2 -> 0 -> 2 on every
// module-to-module navigation, well inside one network round trip. Without
// serializing, `open()` would call `supabase.channel(topic)` while the old
// instance is still `leaving` — realtime-js dedupes to that DYING instance,
// `.subscribe()` on it is a silent no-op, and the bus caches a channel that
// can never receive another broadcast, with `channels.has(topic)` stuck
// true so no later subscriber ever gets a fresh one. `open()` awaits any
// in-flight teardown for its topic before touching `supabase.channel()`.
//
// ⚠ `attempts` GUARDS AGAINST UNSUBSCRIBING MID-OPEN. `setAuth()` is async;
// if the only subscriber leaves before it resolves, the naive version would
// still resume, open a real channel nobody wants, and leak it forever (the
// refcount never reaches 1 again to close it). Each call to `open()` is
// stamped with a token; unsubscribing invalidates it, and `open()` checks
// the token both before and after `setAuth()` before doing anything
// observable. This is also what keeps React StrictMode's synchronous
// mount-unmount-remount (in dev) from accruing two live bindings for one
// logical subscriber — the first attempt sees itself superseded and bails.
import { createClient } from '@/lib/supabase/client';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const channels = new Map<string, unknown>();
// Resolves once a topic's previous channel has finished leaving. Consulted
// by `open()` before it calls `supabase.channel()` again for that topic.
const teardowns = new Map<string, Promise<void>>();
// The token of the current (not-yet-superseded) open attempt per topic.
const attempts = new Map<string, symbol>();

export function subscribeToBadgeTopic(topic: string, fn: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(fn);

  if (!channels.has(topic)) {
    const token = Symbol(topic);
    attempts.set(topic, token);
    // Placeholder reserves the topic before the async auth completes, so two
    // hooks mounting in the same tick cannot both open a channel.
    channels.set(topic, 'pending');
    void open(topic, token);
  }

  return () => {
    const current = listeners.get(topic);
    if (!current) return;
    current.delete(fn);
    if (current.size > 0) return;
    listeners.delete(topic);

    const channel = channels.get(topic);
    channels.delete(topic);
    // Invalidate whatever open() attempt is in flight for this topic — if
    // nobody wants the topic any more, that attempt must not go on to open
    // a channel (or must not treat the placeholder it set as still live).
    attempts.delete(topic);

    if (channel && channel !== 'pending') {
      const supabase = createClient();
      const teardown = Promise.resolve(supabase.removeChannel(channel as never))
        .catch((err: unknown) => {
          console.error(
            `[badge-bus] removeChannel failed for topic "${topic}":`,
            err
          );
        })
        .then(() => {
          if (teardowns.get(topic) === teardown) teardowns.delete(topic);
        });
      teardowns.set(topic, teardown);
    }
  };
}

async function open(topic: string, token: symbol): Promise<void> {
  // Serialize with any channel still leaving on this topic — opening a new
  // one before the old one finishes leaving would dedupe onto the dying
  // instance and silently no-op.
  const pending = teardowns.get(topic);
  if (pending) await pending;

  // Superseded before we even got to auth: the last subscriber left (this
  // attempt's token was invalidated) or a fresher attempt has since started.
  if (attempts.get(topic) !== token) return;

  const supabase = createClient();
  try {
    await supabase.realtime.setAuth();
  } catch (err) {
    console.error(
      `[badge-bus] setAuth failed for topic "${topic}"; badge will not update until a new subscriber retries:`,
      err
    );
    // Only clear state that is still ours — a fresher attempt (or nobody at
    // all) may already own this topic's entry.
    if (attempts.get(topic) === token) {
      attempts.delete(topic);
      channels.delete(topic);
    }
    return;
  }

  // The only subscriber may have left DURING setAuth() — do not open a
  // channel nobody is listening for; nothing would ever close it.
  if (attempts.get(topic) !== token) return;

  const channel = supabase
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'badge' }, () => {
      for (const listener of listeners.get(topic) ?? []) listener();
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.error(`[badge-bus] topic "${topic}" subscribe status:`, status);
      }
    });

  attempts.delete(topic);
  channels.set(topic, channel);
}

// Test-only: wipe all module state between test cases. This module is a
// process-wide singleton by design (see the header comment above), so
// nothing else may call this — a real subscriber leaving is always handled
// by the unsubscribe function `subscribeToBadgeTopic` returns, never by
// resetting the bus out from under it.
export function __resetBadgeBus(): void {
  listeners.clear();
  channels.clear();
  teardowns.clear();
  attempts.clear();
}
