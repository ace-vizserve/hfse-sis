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
- **sonner** for toasts; `<Toaster />` mounted once in `app/layout.tsx`.
- **`@tanstack/react-table`** + **`recharts`** for filterable lists and dashboards.
- **`pdf-merger-js`** (server-only) for P-Files upload merge.
- **`xlsx`** / SheetJS (server-only, trusted registrar input only) for attendance bulk import.
- **Resend** for best-effort parent + change-request emails.
- **Vercel** deploy. **PDF generation deferred** — browser Print covers current volume.

### Next.js 16 gotchas

- `middleware.ts` is renamed to `proxy.ts` at repo root; exported function is `proxy`.
- `cookies()` / `headers()` / `params` / `searchParams` are async — always `await`.
- Use `@supabase/ssr`, not the deprecated `@supabase/auth-helpers-nextjs`.
- `next/navigation` for server-component redirects; never `next/router`.
