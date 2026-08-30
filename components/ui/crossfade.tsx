import { ViewTransition, type ReactNode } from 'react';

/**
 * Fades streamed content in instead of letting it pop.
 *
 * Wraps the content INSIDE a `<Suspense>` boundary, so when the fallback is
 * replaced by the real thing the swap is a crossfade rather than a jump.
 *
 * WHY THIS COMPILES AGAINST `react@19.2.4`. A plain `require('react')` in Node
 * shows no `ViewTransition`, and concluding "blocked" from that is wrong — App
 * Router code does not use the installed React. Next bundles a React canary
 * (`next/dist/compiled/react`) which has it, and the Next docs are explicit:
 * view transitions work in the App Router with no configuration and you do not
 * install `react@canary` yourself. That is why bare `react` does not export it
 * and the compiled copy does. Types come from `"types": ["react/canary"]` in
 * tsconfig.json — verified at 0 errors across the repo.
 *
 * `enter="auto" default="none"` animates content appearing and leaves
 * everything else alone.
 *
 * ⚠ `default="none"` with no `share` prop silently stops a NAMED pair
 * morphing. Harmless here because `Crossfade` names nothing, but remember it
 * if a named transition is ever added.
 *
 * Where the browser has no View Transitions support this renders its children
 * and simply does not animate.
 */
export function Crossfade({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="auto" default="none">
      {children}
    </ViewTransition>
  );
}
