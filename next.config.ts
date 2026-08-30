import type { NextConfig } from 'next';

// Side-effect import — emits a structured build-time warning when
// NEXT_PUBLIC_SIS_URL is unset. Keeps the check at the entry point of
// every `next build` / `next dev` invocation so admins can't miss it.
import './lib/env';

// NOTE: CORS for the cross-origin parent/admissions portal is handled in
// `proxy.ts` (the Next 16 middleware) — origin reflection + credentials +
// preflight, which a static `headers()` block here cannot do per-origin.
const nextConfig: NextConfig = {
  // Instant Navigation. A route can paint a prerendered shell the moment the
  // link is clicked, and stream the rest into its Suspense fallbacks.
  //
  // ⚠ Turning these on is the EASY half and on its own buys nothing. The win
  // comes from the per-route work: anything reading `cookies()`/`headers()`
  // or uncached data has to sit behind a `<Suspense>` boundary, or be given a
  // lifetime with `use cache`, before that route's shell can be static.
  //
  // A first attempt on 2026-08-30 flipped these and then silenced the fallout
  // with `export const instant = false` on the ROOT layout. That opts out
  // every route beneath it, so the app paid the whole cost of the stricter
  // model and got none of the benefit — navigation got slower, not faster.
  // The root layout has since been fixed properly (its session read now sits
  // behind a boundary), which is what makes a static shell possible at all.
  cacheComponents: true,
  partialPrefetching: true,

  serverExternalPackages: ['pdf-merger-js'],
  experimental: {
    // Default is 'warning', which validates EVERY page in dev — that is the
    // wall of overlay errors from the first attempt. 'manual-warning' checks
    // only routes that opt in with `export const instant = true`, so routes
    // are migrated deliberately, one at a time, and an un-migrated route
    // behaves exactly as it does today.
    instantInsights: { validationLevel: 'manual-warning' },
    // Next's default is 0 — every dynamically-rendered route (which is
    // effectively every page here, since getSessionUser() reads cookies()
    // on all of them, KD #35) is treated as instantly stale by the client
    // router cache, so revisiting a page you already opened re-triggers its
    // loading.tsx every time. 30s lets a quick back/forward or sidebar
    // round-trip skip that refetch; router.refresh() after mutations (KD
    // #24) still forces a fresh fetch regardless of this window.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
