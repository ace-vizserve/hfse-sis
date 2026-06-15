'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * App-wide TanStack Query provider (KD #24). Mounted once at the root layout.
 *
 * Defaults encode the project's data conventions:
 *  - queries: `staleTime: 60s` mirrors the app's 60s `unstable_cache` TTL
 *    (KD #46/#56); `retry: 2` self-heals transient blips; window-focus refetch
 *    is off (this is a data-entry tool, not a live feed).
 *  - mutations: `retry: 0` — never auto-replay a POST/PATCH/DELETE (a write
 *    whose response was lost would double-write; not all routes are
 *    idempotent). Failed writes surface a manual "Try again" instead.
 *
 * The client is created once per mount via `useState` initializer so it is not
 * recreated on re-render and is per-request safe in the App Router.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
