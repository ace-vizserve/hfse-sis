---
name: env-vars
description: Required and optional env vars (Supabase, Resend, parent portal URL). Read when touching .env.local, auth/Supabase plumbing, or Resend emails.
load: on-demand
---

<!-- Stable rule. NOT auto-loaded. Read via the Read tool when relevant. Edit only with explicit user approval. -->

## Environment variables

`.env.local` at repo root:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (server-only, bypasses RLS).
- `NEXT_PUBLIC_PARENT_PORTAL_URL` — per-environment, see `10-parent-portal.md`.
- `PARENT_HANDOFF_SECRET` — server-only, ≥32 chars (`openssl rand -hex 32`); HMAC key for the `parent_session` cookie (KD #65). MUST differ per environment; rotating invalidates all live parent sessions.
- `CHANGE_REQUEST_ACTION_SECRET` — server-only, ≥32 chars (`openssl rand -hex 32`); HMAC key signing the one-click approve/reject action tokens in change-request emails. MUST differ per environment; rotating invalidates outstanding quick-action links (recipients then fall back to logging in). Best-effort: when unset, `signActionToken` throws and the email buttons fall back to the in-app deep-link (warned at import in `lib/env.ts`); emails still send.
- `RESEND_API_KEY` (server-only); `RESEND_FROM_EMAIL` optional.
- `CRON_SECRET` — server-only; Vercel sets this as `Authorization: Bearer <value>` when invoking cron jobs. Must be configured in Vercel project environment variables. Verified by `POST /api/grading-sheets/lock-overdue` (auto-lock cron).
- `PDF_SERVICE_URL` reserved, currently unused.
