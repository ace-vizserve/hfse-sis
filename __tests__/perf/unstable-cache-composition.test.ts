/**
 * SETTLES A DOC-VS-CODE CONTRADICTION BY MEASUREMENT (phase 7, item 2).
 *
 * `docs/context/11-performance-patterns.md` §2 said: "Hoist the
 * `unstable_cache` wrapper to module scope. Creating the wrapper inside a
 * function call (`return unstable_cache(...)()` in a per-request function) can
 * break cache stability across Next.js versions." Its §9 checklist repeated
 * the rule. The codebase does the opposite in the overwhelming majority of
 * cases — ~110 per-call compositions against 8 hoisted, across 60 files — so
 * one of the two was wrong, and that inconsistency was itself the defect.
 *
 * The rule is now amended, on the evidence below rather than on an opinion.
 *
 * WHAT NEXT ACTUALLY KEYS ON (next 16.2.10,
 * node_modules/next/dist/server/web/spec-extension/unstable-cache.js):
 *
 *     const fixedKey = `${cb.toString()}-${keyParts.join(',')}`;
 *     const invocationKey = `${fixedKey}-${JSON.stringify(args)}`;
 *     const cacheKey = await incrementalCache.generateCacheKey(invocationKey);
 *
 * The key is derived entirely from the callback's SOURCE TEXT, the keyParts
 * and the arguments. The wrapper object's identity appears nowhere in it, and
 * the store it reads is the shared `incrementalCache`, not per-wrapper state.
 * So a wrapper composed fresh on every call produces a byte-identical key and
 * hits the same entry. That is the reading; the tests below are the running.
 *
 * ⚠ THE REAL HAZARD OF THE INLINE FORM IS THE OPPOSITE OF A CACHE MISS — it is
 * a cache COLLISION, and this repo has already been bitten by it once
 * (`lib/sis/staff.ts::loadFormAdvisersBySection`, recorded in the same perf
 * doc's header: its keyParts omitted `sectionIds`, so two pages asking for
 * different section sets in the same AY served each other's answer). Because
 * `cb.toString()` is the same literal text no matter what the closure captured,
 * a captured variable that is NOT also in keyParts is invisible to the key. The
 * last test pins that class.
 *
 * HOW THIS RUNS OUTSIDE A NEXT SERVER. Two of Next's own fallbacks, exactly as
 * `school-config-request-cache.test.ts` established them:
 * `globalThis.__incrementalCache` (the helper's documented out-of-server
 * fallback) and the `AsyncLocalStorage` global Next's runtime installs and
 * jsdom does not. Everything below those two is the real helper — the key
 * derivation this file is about is Next's own code, untouched.
 *
 * With no workStore the helper takes its "called outside of a render" branch,
 * which still does the full `generateCacheKey` → `get` → `cb` → `set` cycle.
 * That is the branch measured here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CacheEntry = { value: unknown; isStale: boolean };

// Every key the helper asks for, in order — the direct evidence for "the same
// key twice", which is the whole question.
let requestedKeys: string[] = [];
let store: Map<string, CacheEntry>;
let restoreAls: (() => void) | null = null;

beforeEach(() => {
  requestedKeys = [];
  store = new Map();

  const hadAls = 'AsyncLocalStorage' in globalThis;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require('node:async_hooks');
  (globalThis as Record<string, unknown>).AsyncLocalStorage ??=
    AsyncLocalStorage;

  (globalThis as Record<string, unknown>).__incrementalCache = {
    isOnDemandRevalidate: false,
    generateCacheKey: async (invocationKey: string) => {
      requestedKeys.push(invocationKey);
      return invocationKey;
    },
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, { value, isStale: false });
    },
  };

  restoreAls = () => {
    delete (globalThis as Record<string, unknown>).__incrementalCache;
    if (!hadAls) {
      delete (globalThis as Record<string, unknown>).AsyncLocalStorage;
    }
  };
});

afterEach(() => {
  restoreAls?.();
  restoreAls = null;
  vi.clearAllMocks();
});

describe('unstable_cache — per-call composition vs module-scope hoisting', () => {
  it('a wrapper composed FRESH on every call still serves the second call from cache', async () => {
    const { unstable_cache } = await import('next/cache');
    const loader = vi.fn(async (ayCode: string) => ({ rows: 3, ayCode }));

    // Byte-for-byte the shape ~110 call sites in this repo use — see
    // `lib/admissions/dashboard.ts::loadJoinedRows` and
    // `app/(sis)/sis/page.tsx::loadUnassignedAdviserSectionsCached`. A NEW
    // wrapper object is constructed on every single call.
    const composePerCall = (ayCode: string) =>
      unstable_cache(
        () => loader(ayCode),
        ['composition-probe-joined', ayCode],
        { revalidate: 600, tags: [`sis:${ayCode}`] }
      )();

    const first = await composePerCall('AY2026');
    const second = await composePerCall('AY2026');

    // THE MEASUREMENT. Two separate wrapper objects, one underlying read.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    // ...and the direct cause: both compositions asked for the same key.
    expect(requestedKeys).toHaveLength(2);
    expect(requestedKeys[0]).toBe(requestedKeys[1]);
    expect(store.size).toBe(1);
  });

  it('the hoisted form behaves identically — the two are equivalent, not better/worse', async () => {
    const { unstable_cache } = await import('next/cache');
    const loader = vi.fn(async (ayCode: string) => ({ rows: 7, ayCode }));

    // Composed ONCE, at "module scope", the form §2 used to mandate.
    const hoisted = unstable_cache(
      () => loader('AY2026'),
      ['composition-probe-hoisted', 'AY2026'],
      { revalidate: 600, tags: ['sis:AY2026'] }
    );

    await hoisted();
    await hoisted();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(requestedKeys).toHaveLength(2);
    expect(requestedKeys[0]).toBe(requestedKeys[1]);
    expect(store.size).toBe(1);
  });

  it('different keyParts still separate — per-call composition does not merge two AYs', async () => {
    const { unstable_cache } = await import('next/cache');
    const loader = vi.fn(async (ayCode: string) => ({ ayCode }));

    const composePerCall = (ayCode: string) =>
      unstable_cache(
        () => loader(ayCode),
        ['composition-probe-split', ayCode],
        {
          revalidate: 600,
          tags: [`sis:${ayCode}`],
        }
      )();

    const a = await composePerCall('AY2025');
    const b = await composePerCall('AY2026');

    expect(loader).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ ayCode: 'AY2025' });
    expect(b).toEqual({ ayCode: 'AY2026' });
    expect(requestedKeys[0]).not.toBe(requestedKeys[1]);
    expect(store.size).toBe(2);
  });

  it('⚠ a captured variable missing from keyParts COLLIDES — the real inline hazard', async () => {
    // This is the `loadFormAdvisersBySection` bug class, reproduced. The
    // closure captures `sectionIds`, but keyParts names only the AY — and
    // because the key is built from `cb.toString()`, which is the same literal
    // text either way, the second caller is served the FIRST caller's answer.
    //
    // This is why the amended rule is "keyParts must name every captured
    // variable", not "hoist the wrapper": hoisting does not prevent this and
    // per-call composition does not cause it.
    const { unstable_cache } = await import('next/cache');
    const loader = vi.fn(async (sectionIds: string[]) => ({
      forSections: sectionIds,
    }));

    const composeBadly = (ayCode: string, sectionIds: string[]) =>
      unstable_cache(
        () => loader(sectionIds),
        ['composition-probe-collision', ayCode], // sectionIds NOT here
        { revalidate: 600, tags: [`sis:${ayCode}`] }
      )();

    const pageA = await composeBadly('AY2026', ['sec-1', 'sec-2']);
    const pageB = await composeBadly('AY2026', ['sec-9']);

    expect(loader).toHaveBeenCalledTimes(1);
    // Page B asked about sec-9 and was handed page A's sections.
    expect(pageB).toEqual({ forSections: ['sec-1', 'sec-2'] });
    expect(pageB).toEqual(pageA);
    expect(requestedKeys[0]).toBe(requestedKeys[1]);
  });
});
