'use client';

import { useSyncExternalStore } from 'react';

// Task 2 of the "Unified Subject Setup page" plan. Shares the header's
// Secondary-only Track view-filter (`SubjectTrackViewToggle`) with
// `SubjectCatalogCard`'s table — two sibling client components mounted by
// the SAME server component (`app/(sis)/sis/admin/subjects/page.tsx`) with
// no client-side ancestor to lift shared state into (a Server Component
// can't hold `useState`).
//
// A plain module-scoped `useSyncExternalStore` singleton was chosen over
// the two obvious alternatives: (1) a Context Provider would require
// wrapping page.tsx's existing header + card JSX in a new client boundary
// — a bigger, riskier page.tsx diff than this task's brief invites
// ("don't touch page.tsx unless you find a genuine defect... that should
// be rare"); (2) a `?track=` URL param would round-trip through the
// Server Component on every click just to re-render a client-only
// highlight/filter that writes nothing server-side — wasteful for what's
// explicitly a "pure client-side filter/highlight." This store needs
// neither: it's page-scoped by construction (only these two files import
// it), survives client-side navigation away and back (a mild feature —
// the admin's last filter choice is remembered), and never causes a
// server round-trip.
export type TrackFilterValue = 'all' | 'global' | 'standard';

let currentValue: TrackFilterValue = 'all';
const listeners = new Set<() => void>();

function setTrackFilter(next: TrackFilterValue) {
  if (currentValue === next) return;
  currentValue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TrackFilterValue {
  return currentValue;
}

// SSR-safe fallback — this store is only ever read by 'use client'
// components, but useSyncExternalStore still requires a server snapshot;
// 'all' (the no-op/unfiltered default) is correct either way.
function getServerSnapshot(): TrackFilterValue {
  return 'all';
}

export function useTrackFilter(): [
  TrackFilterValue,
  (next: TrackFilterValue) => void,
] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [value, setTrackFilter];
}
