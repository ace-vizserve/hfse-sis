import type { NextConfig } from 'next';

// Side-effect import — emits a structured build-time warning when
// NEXT_PUBLIC_SIS_URL is unset. Keeps the check at the entry point of
// every `next build` / `next dev` invocation so admins can't miss it.
import './lib/env';

// NOTE: CORS for the cross-origin parent/admissions portal is handled in
// `proxy.ts` (the Next 16 middleware) — origin reflection + credentials +
// preflight, which a static `headers()` block here cannot do per-origin.
const nextConfig: NextConfig = {
  // ⚠ DO NOT re-add `cacheComponents: true` / `partialPrefetching: true`
  // without reading this first. They were turned on 2026-08-30 and reverted
  // the same day, measured rather than guessed.
  //
  // The build only passed with `export const instant = false` on the ROOT
  // layout, because it calls getSessionUser() — a cookie read — to build the
  // sidebar, and a request read cannot go into a prerendered static shell.
  // Opting out at the root opts out EVERY route beneath it, so the app paid
  // the whole cost of the stricter model and got none of the benefit: no
  // route gained a prefetchable shell, the dev overlay filled with blocking
  // -route errors (including an unstable `Date.now()` reached from
  // RootLayout), and navigation got slower, not faster.
  //
  // The prerequisite is moving the root layout's session read behind its own
  // Suspense boundary. Until that is done this is strictly a regression.
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
