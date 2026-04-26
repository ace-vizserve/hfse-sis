# Sonner → Sileo swap via path-alias shim

**Date:** 2026-04-26
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Origin:** User asked to redesign `components/ui/sonner.tsx`; brainstorming pivoted from "redesign the wrapper" to "replace the library." User then narrowed scope further: swap with zero touch on the 55 call sites.

## 1. Goal

Replace the `sonner` toast library with the `sileo` npm package while leaving every existing `toast.X(...)` call site (~154 calls across 55 files) and the `<Toaster />` mount in `app/layout.tsx` mechanically untouched.

**Anti-goals:**
- A 55-file codemod.
- Theming `sileo` into Aurora Vault tokens — explicitly accepted as out of scope per user direction; sileo's "beautiful by default" rendering ships as-is.
- Visual upgrade. The earlier "redesign sonner.tsx" framing is dropped.

## 2. Approach

**TypeScript path alias + local shim.** The `'sonner'` module specifier is rewired in `tsconfig.json` to resolve to `components/ui/sonner.tsx`. That file is rewritten to expose a sonner-shaped public API (`Toaster`, `toast`, `ToasterProps`) that internally delegates to `sileo`.

Result: every `import { toast } from 'sonner'` resolves to our local file instead of the npm package. No call-site touches needed. Both TypeScript's resolver and Next 16's Turbopack-based bundler honor `compilerOptions.paths` at type-check, bundle, and runtime — this is the standard library-shimming pattern in Next.

## 3. Scope of change

### 3.1 `tsconfig.json`

Add one entry under `compilerOptions.paths`:

```json
"paths": {
  "@/*": ["./*"],
  "sonner": ["./components/ui/sonner.tsx"]
}
```

### 3.2 `components/ui/sonner.tsx`

Full rewrite. The old sonner-themed wrapper is replaced by a sonner-shaped facade over `sileo`. Public surface preserved:

- `export const Toaster` — wraps `sileo`'s `<Toaster>`. Accepts and **silently discards** sonner-only props (`richColors`, `closeButton`, `theme`) so `app/layout.tsx` does not need to change.
- `export const toast` — sonner-API-shaped object:
  - `success(title, opts?)` → `sileo.success({ title, ...opts })`
  - `error / warning / info` — same translation pattern.
  - `promise(p, msgs)` → delegates to `sileo.promise`. Sonner's loose shape (`string | function | object`) is normalized into sileo's strict `{ title }` object shape via a small helper.
  - `dismiss / loading / custom / message` — typed no-op stubs. Zero call sites today; preserved so a future addition does not crash the build.
- `export type ToasterProps` — preserved for any consumers that import the type.

Reference implementation:

```tsx
'use client';

import * as React from 'react';
import { sileo, Toaster as SileoToaster } from 'sileo';

type SileoToasterProps = React.ComponentProps<typeof SileoToaster>;

type LegacySonnerProps = {
  richColors?: boolean;
  closeButton?: boolean;
  theme?: string;
};

export type ToasterProps = SileoToasterProps & LegacySonnerProps;

export function Toaster(props: ToasterProps) {
  const { richColors: _r, closeButton: _c, theme: _t, ...sileoProps } = props;
  return <SileoToaster {...sileoProps} />;
}

type ToastOpts = { description?: string };

function show(kind: 'success' | 'error' | 'warning' | 'info') {
  return (title: string, opts?: ToastOpts) =>
    sileo[kind]({ title, ...(opts ?? {}) });
}

type SonnerPromiseMessages<T> = {
  loading: string | { title: string };
  success: string | ((data: T) => string) | { title: string };
  error: string | ((err: unknown) => string) | { title: string };
};

function normalize<T>(value: SonnerPromiseMessages<T>['success'], arg?: T): { title: string } {
  if (typeof value === 'string') return { title: value };
  if (typeof value === 'function') return { title: String((value as (a: T) => string)(arg as T)) };
  return value;
}

export const toast = {
  success: show('success'),
  error: show('error'),
  warning: show('warning'),
  info: show('info'),
  promise<T>(p: Promise<T>, msgs: SonnerPromiseMessages<T>) {
    return sileo.promise(p, {
      loading: normalize(msgs.loading),
      success: normalize(msgs.success),
      error: normalize(msgs.error),
    });
  },
  dismiss: (_?: unknown) => {},
  loading: (_title?: string, _opts?: ToastOpts) => {},
  custom: (_node: React.ReactNode) => {},
  message: (_title: string, _opts?: ToastOpts) => {},
};
```

Type contract notes:
- The two shapes used by every call site in the codebase are `toast.X(string)` and `toast.X(string, { description })`. Both type-check against `show(kind)`'s `(title: string, opts?: ToastOpts)` signature.
- `toast.promise` is forward-insurance — zero live callers; if a future caller needs richer message shapes, extend `normalize()`.

### 3.3 `package.json` + lockfile

- `npm uninstall sonner`
- `npm install sileo`

The path alias must outlive the uninstall — once `sonner` is gone from `node_modules`, only the alias keeps `'sonner'` imports resolving.

### 3.4 Files explicitly NOT touched

- `app/layout.tsx` — `<Toaster position="top-right" richColors closeButton />` continues to work; the wrapper discards `richColors` and `closeButton`.
- The 55 files importing `from 'sonner'` — mechanically untouched.
- `components/ui/sonner.tsx` is rewritten, but its public surface is preserved (`Toaster`, `toast`, `ToasterProps`).

## 4. Accepted regressions

- **No `closeButton`.** Sileo `<Toaster>` per the docs accepts only `position`. Users can no longer manually X a toast; auto-dismiss only.
- **No `richColors`.** Sonner's per-severity background tinting is replaced by sileo's default rendering.
- **No Aurora Vault tokens.** Sileo styles itself; design system tokens do not reach into the toast. Hard Rule #7 is unaffected — that rule scopes to `app/` and `components/`, not third-party `node_modules` styles.
- **Permanent `'sonner'` import-specifier lie.** Every call site says `from 'sonner'` but resolves to our local shim. Tradeoff accepted for zero-touch swap. A future codemod can rename `'sonner'` → `'@/components/ui/sonner'` (or rename the file and drop the alias) when convenient.

## 5. Risks

- **`sileo` npm availability.** Per user direction, the package was not pre-verified. If `npm install sileo` fails, course-correct then — verify package name, accept non-existence, or fall back to a sonner-redesign path.
- **`tsconfig` paths honored by Turbopack.** Standard practice, but the `npx next build` smoke test must exercise at least one toast-using path to confirm runtime resolution.
- **Sileo prop / theme drift.** Docs pasted by the user show only `position` on `<Toaster>`. If the real package exposes additional props worth surfacing (`theme`, `expand`, `offset`), the shim can extend later — not a blocker.
- **Sileo `promise` signature divergence.** Docs show object-only message shape. The shim's `normalize()` covers sonner's looser API. Zero live callers, so divergence is theoretical until a new caller appears.

## 6. Verification

- `npx next build` clean.
- Browser smoke test on three call sites:
  - **Simple success** — any save action calling `toast.success('Saved')`.
  - **Simple error** — any failure path calling `toast.error(message)`.
  - **Description shape** — `/account/change-password` calls `toast.success('Password updated', { description: '...' })`.
- Visual sanity: stacking, auto-dismiss timing, top-right position.

## 7. Out of scope

- Theming sileo to Aurora Vault tokens.
- Renaming `'sonner'` import specifier across call sites.
- Wrappers restoring missing sonner features (`closeButton` UX, `richColors`, dismiss-by-id).
- Removing `richColors` / `closeButton` props from `app/layout.tsx`.
- Renaming `components/ui/sonner.tsx` to a less misleading name.

## 8. Files touched

| File | Change |
|---|---|
| `tsconfig.json` | +1 entry in `compilerOptions.paths` |
| `components/ui/sonner.tsx` | full rewrite — sonner-shaped facade over `sileo` |
| `package.json` + lockfile | uninstall `sonner`, install `sileo` |

Total: **3 files** (4 with the lockfile). 55 call sites untouched.
