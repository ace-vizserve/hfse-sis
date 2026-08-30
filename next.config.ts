import type { NextConfig } from 'next';

// Side-effect import — emits a structured build-time warning when
// NEXT_PUBLIC_SIS_URL is unset. Keeps the check at the entry point of
// every `next build` / `next dev` invocation so admins can't miss it.
import './lib/env';

// NOTE: CORS for the cross-origin parent/admissions portal is handled in
// `proxy.ts` (the Next 16 middleware) — origin reflection + credentials +
// preflight, which a static `headers()` block here cannot do per-origin.
const nextConfig: NextConfig = {
  // Instant Navigations (Next 16.3). Cache Components gives each route a
  // prerendered shell it can paint before its data arrives; Partial
  // Prefetching pulls that shell to the browser before the click.
  //
  // Routes that are not ready opt out with `export const instant = false` and
  // render exactly as they do today. Every page here reads the session cookie
  // (KD #35), so expect every one to be flagged in the dev overlay — that is
  // expected, not failure. Validation is development-only and never blocks a
  // build.
  cacheComponents: true,
  partialPrefetching: true,

  serverExternalPackages: ['pdf-merger-js'],
  experimental: {
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
