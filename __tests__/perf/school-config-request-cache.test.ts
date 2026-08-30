/**
 * `getSchoolConfig` is wrapped in React `cache()` (phase 3, item 2) so that a
 * render calling it seventeen ways — a 50-student batch print resolves it once
 * per student inside `buildReportCard` — pays for one read of the one-row
 * `school_config` table instead of fifty.
 *
 * THE RISK THIS FILE EXISTS TO RULE OUT. Three of its callers run INSIDE an
 * `unstable_cache` body: `loadMasterfileUncached` (lib/markbook/masterfile.ts),
 * `loadOverviewDataUncached` (lib/markbook/overview-data.ts), and
 * `computePublishReadiness` (wrapped by lib/classroom/health.ts). A cached
 * callback runs outside the React request scope, so a `cache()`-wrapped
 * function called from in there has no dispatcher to memoise into. React's
 * documented behaviour is to fall through to a plain call — but "documented"
 * is not "measured", and this whole pass runs on measure-don't-estimate, so
 * the behaviour is exercised here rather than asserted from the docs.
 *
 * WHAT THIS FILE DOES NOT PROVE. Vitest has no React server dispatcher, so the
 * memoisation ITSELF cannot be observed here — with no dispatcher every call
 * falls through, which is exactly the fall-through case below. The saving is
 * real only inside a Server Component render, which is where the seventeen
 * call sites live. Do not read a "2 calls, 2 reads" result below as the cache
 * failing; read it as the fall-through path working.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One shared spy for the service client, so every read this file triggers is
// counted in one place regardless of which module issued it.
const selectSpy = vi.fn();

const CONFIG_ROW = {
  principal_name: 'Ms Principal',
  ceo_name: 'Mr CEO',
  pei_registration_number: 'PEI-1',
  default_publish_window_days: 7,
  default_compassionate_allowance_per_year: 5,
  default_vl_allowance_per_term: 1,
  subject_award_bronze_min: 88.5,
  subject_award_silver_min: 91.5,
  subject_award_gold_min: 95.5,
  subject_award_max: 100,
  organization_name: 'HFSE Global Education Group',
  address_line_1: '223 Mountbatten Road',
  address_line_2: 'Singapore 398008',
  phone_number: '+65 6451 0080',
  website_url: 'https://hfse.edu.sg',
  contact_email: 'enquiry@hfse.edu.sg',
  pei_registration_start_date: '2025-03-26',
  pei_registration_end_date: '2029-03-25',
  logo_url: '',
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => {
        selectSpy(table, cols);
        return {
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: CONFIG_ROW, error: null }),
          }),
        };
      },
    }),
  }),
}));

beforeEach(() => {
  selectSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getSchoolConfig — React cache() wrapper', () => {
  it('still returns the mapped config when called with no React dispatcher', async () => {
    const { getSchoolConfig } = await import('@/lib/sis/school-config');

    const cfg = await getSchoolConfig();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy.mock.calls[0][0]).toBe('school_config');
    expect(cfg.principalName).toBe('Ms Principal');
    expect(cfg.defaultVlAllowancePerTerm).toBe(1);
    expect(cfg.subjectAwardGoldMin).toBe(95.5);
  });

  it('does not throw when called from inside an unstable_cache body', async () => {
    // The REAL Next.js helper, not a stand-in — the point is to run the
    // wrapped function in the exact context its three cached callers put it
    // in, including Next's own `workUnitAsyncStorage.run(...)` around the
    // callback. If React `cache()` threw without a dispatcher (the failure
    // this whole item was gated on), this await would reject here.
    //
    // `unstable_cache` refuses to run at all without an incremental cache
    // ("Invariant: incrementalCache missing"), which a Next server normally
    // supplies. `globalThis.__incrementalCache` is the helper's own documented
    // fallback for exactly the out-of-server case, so a minimal in-memory one
    // is installed for the duration — every code path below it is the real
    // helper.
    // Next's async-local-storage helper reads `globalThis.AsyncLocalStorage`
    // and, when it is absent, hands back a fake that throws on ANY access
    // ("Invariant: AsyncLocalStorage accessed in runtime where it is not
    // available"). Next's own server runtime installs that global; this suite
    // runs under jsdom, which does not. Installing the real Node class is
    // therefore restoring the production runtime, not stubbing it out.
    const { AsyncLocalStorage } = await import('node:async_hooks');
    const hadAls = 'AsyncLocalStorage' in globalThis;
    (globalThis as Record<string, unknown>).AsyncLocalStorage ??=
      AsyncLocalStorage;

    const store = new Map<string, unknown>();
    (globalThis as Record<string, unknown>).__incrementalCache = {
      isOnDemandRevalidate: false,
      // Next 16.3 SPLIT this method: `generateCacheKey(url, init)` is now the
      // fetch-key generator, and `unstable_cache` calls the new
      // `generateSimpleCacheKey(input)` instead (see
      // node_modules/next/dist/server/lib/incremental-cache/index.js). A mock
      // carrying only the old name makes unstable_cache throw
      // "generateSimpleCacheKey is not a function" — a test-only break;
      // production unstable_cache is unaffected.
      generateSimpleCacheKey: async (k: string) => k,
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        store.set(key, { value, isStale: false });
      },
    };

    try {
      const { unstable_cache } = await import('next/cache');
      const { getSchoolConfig } = await import('@/lib/sis/school-config');

      const loader = unstable_cache(
        async () => {
          const cfg = await getSchoolConfig();
          return cfg.organizationName;
        },
        ['test', 'school-config-inside-unstable-cache'],
        { revalidate: 60 }
      );

      await expect(loader()).resolves.toBe('HFSE Global Education Group');
      expect(selectSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as Record<string, unknown>).__incrementalCache;
      if (!hadAls) {
        delete (globalThis as Record<string, unknown>).AsyncLocalStorage;
      }
    }
  });

  it('falls through to a real read per call when there is no dispatcher', async () => {
    // Documents the environment honestly: outside a Server Component render
    // there is nothing to memoise into, so two calls are two reads. This is
    // the degradation path, not a defect — see the file header.
    const { getSchoolConfig } = await import('@/lib/sis/school-config');

    const [a, b] = await Promise.all([getSchoolConfig(), getSchoolConfig()]);

    expect(a).toEqual(b);
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });
});
