---
name: env-vars
description: Required and optional env vars (Supabase, Resend, parent portal URL). Read when touching .env.local, auth/Supabase plumbing, or Resend emails.
load: on-demand
---

<!-- Stable rule. NOT auto-loaded. Read via the Read tool when relevant. Edit only with explicit user approval. -->

## Environment variables

`.env.local` at repo root:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (server-only, bypasses RLS).
- `NEXT_PUBLIC_PARENT_PORTAL_URL` — used in parent/p-file email notification links (`lib/notifications/email-parents-publication.ts`, `email-pfile-reminder.ts`) and as a CTA destination. NOT used for in-app routing. The parent surface is a stateless Bearer API (`/api/parent/v2/*`) consumed by the external admissions SPA, not an in-SIS route group.
- `ADMISSIONS_PORTAL_ORIGIN` — server-only; the production origin of the external admissions portal SPA (e.g. `https://enrol.hfse.edu.sg`). Used by `lib/cors.ts` to build the CORS allowlist for `/api/parent/v2/*`. Staging fallback `https://online-admission-staging.vercel.app` + local `http://localhost:5173` are hardcoded in `lib/cors.ts`. When unset, only the hardcoded origins are permitted.
- ~~`PARENT_HANDOFF_SECRET`~~ — **REMOVED / DEAD.** The in-SIS `parent_session` cookie-SSO surface (KD #65/#73) was removed. The secret is present in `.env.local.example` for historical reference but is referenced by no live code. Do not provision or rotate it.
- `CHANGE_REQUEST_ACTION_SECRET` — server-only, ≥32 chars (`openssl rand -hex 32`); HMAC key signing the one-click approve/reject action tokens in change-request emails. MUST differ per environment; rotating invalidates outstanding quick-action links (recipients then fall back to logging in). Best-effort: when unset, `signActionToken` throws and the email buttons fall back to the in-app deep-link (warned at import in `lib/env.ts`); emails still send.
- `NEXT_PUBLIC_SIS_URL` — the deployed app's own origin (e.g. `https://sis.hfse.edu.sg`). Used to build absolute links in outbound email (notably the change-request quick-action links, KD #123). Best-effort: `lib/env.ts` warns at import when unset rather than throwing, so a missing value can't block a hotfix to grading; `/sis` surfaces `<SisUrlMissingBanner />` (KD #88). Note the parent portal has its own separate `VITE_SIS_URL` pointing here.
- `RESEND_API_KEY` (server-only); `RESEND_FROM_EMAIL` optional.
- `CRON_SECRET` — server-only; Vercel sets this as `Authorization: Bearer <value>` when invoking cron jobs. Must be configured in Vercel project environment variables. Verified by `POST /api/grading-sheets/lock-overdue` (auto-lock cron).
- `PDF_SERVICE_URL` reserved, currently unused.
