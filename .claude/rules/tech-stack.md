---
name: tech-stack
description: Framework + library pins, and Next.js 16 gotchas (proxy.ts, async cookies/headers, @supabase/ssr). Read when touching code, installing/upgrading a dep, or debugging a framework behavior.
load: on-demand
---

<!-- Stable rule. NOT auto-loaded. Read via the Read tool when relevant. Edit only with explicit user approval. -->

## Tech stack

- **Next.js 16** (App Router, Turbopack, TS) — single deployable at repo root.
- **Supabase** (Postgres + Auth, `@supabase/ssr`) — one shared project also hosts admissions tables.
- **Tailwind v4** via `@tailwindcss/postcss` (no JS config) + `tw-animate-css`.
- **RHF + zod + shadcn `Form`** for submit-based forms; schemas in `lib/schemas/`.
- **sileo** for toasts via tsconfig path-alias shim (KD #58) — `'sonner'` is rewired in `tsconfig.json::compilerOptions.paths` to resolve to `components/ui/sonner.tsx`, which is a sonner-shaped facade over `sileo`. Call sites still `import { toast } from 'sonner'`. `<Toaster />` mounted once in `app/layout.tsx`.
- **`@tanstack/react-query` v5** is the client data layer (KD #24) — `useQuery` for lazy reads, `useMutation` for writes, all routed through `lib/query/fetcher.ts::apiFetch`. Provider in `components/providers/query-provider.tsx` (mounted in `app/layout.tsx`); query keys in `lib/query/keys.ts`. Model A: mutations still `router.refresh()` on success (RSC-first; data is not moved into the client cache). `toast` (sonner) remains the feedback mechanism.
- **`@tanstack/react-table`** + **`@tanstack/react-virtual`** + **`recharts`** for filterable lists, virtualized drill sheets, and dashboards. `react-virtual` integrated in `components/dashboard/drill-down-sheet.tsx` via the spacer-row pattern (preserves native `<table>` semantics).
- **Component testing** (added with the KD #24 migration): Vitest runs under **jsdom** with `@testing-library/react` + `@testing-library/jest-dom` (`.test.tsx` under `__tests__/`; setup in `vitest.setup.ts`; helpers `renderWithClient`/`mockFetch` in `__tests__/_utils/`). Pure-logic `.test.ts` suites run under the same jsdom env.
- **`cmdk`** for the global Cmd+K command palette (`components/ui/command.tsx` is the shadcn-style wrapper; `components/sis/command-palette.tsx` is the wired-up palette mounted in the root layout). Trigger lives in the module-sidebar header + topbar.
- **`pdf-merger-js`** (server-only) for P-Files upload merge.
- **`xlsx`** / SheetJS (server-only, trusted registrar input only) for attendance bulk import.
- **Resend** for best-effort parent + change-request emails.
- **Vercel** deploy. **PDF generation deferred** — browser Print covers current volume.

### Next.js 16 gotchas

- `middleware.ts` is renamed to `proxy.ts` at repo root; exported function is `proxy`.
- `cookies()` / `headers()` / `params` / `searchParams` are async — always `await`.
- Use `@supabase/ssr`, not the deprecated `@supabase/auth-helpers-nextjs`.
- `next/navigation` for server-component redirects; never `next/router`.
- Internal navigation always uses `next/link` — a raw `<a href="/...">` forces a full hard reload, bypassing the router entirely (perf-patterns.md §11).
- `experimental.staleTimes.dynamic` in `next.config.ts` is `0` by default — since nearly every page here is dynamically-rendered (KD #35's `cookies()`-based auth check), that makes `loading.tsx` re-fire on every revisit to an already-loaded page. Raised to `30` (perf-patterns.md §11).
- `next.config.ts` edits require a full server restart — never picked up by HMR on a running `next dev`/`next start` process.
