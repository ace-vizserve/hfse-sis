import type { NextConfig } from 'next';

// Side-effect import — emits a structured build-time warning when
// NEXT_PUBLIC_SIS_URL is unset. Keeps the check at the entry point of
// every `next build` / `next dev` invocation so admins can't miss it.
import './lib/env';

// NOTE: CORS for the cross-origin parent/admissions portal is handled in
// `proxy.ts` (the Next 16 middleware) — origin reflection + credentials +
// preflight, which a static `headers()` block here cannot do per-origin.
const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-merger-js'],
};

export default nextConfig;
