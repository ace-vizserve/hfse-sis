---
name: env-vars
description: Required and optional env vars (Supabase, Resend, M365/SharePoint, parent portal URL). Read when touching .env.local, auth/Supabase plumbing, Resend emails, or M365 inquiry sync.
load: on-demand
---

<!-- Stable rule. NOT auto-loaded. Read via the Read tool when relevant. Edit only with explicit user approval. -->

## Environment variables

`.env.local` at repo root:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (server-only, bypasses RLS).
- `NEXT_PUBLIC_PARENT_PORTAL_URL` — per-environment, see `10-parent-portal.md`.
- `RESEND_API_KEY` (server-only); `RESEND_FROM_EMAIL` optional.
- M365 inquiry sync (all 5 required together; silently no-ops if any missing): `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`, `SHAREPOINT_LIST_ID`.
- `PDF_SERVICE_URL` reserved, currently unused.
