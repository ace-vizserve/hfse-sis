<!-- Topic file for `.claude/rules/key-decisions.md`. Numbering is global; do not renumber. -->

## Parent — identity, SSO, dedicated surface

---

### Parent module — current state (2026-06-09)

**The in-SIS `/parent/*` route group and all associated cookie-SSO infrastructure have been removed.** The descriptions in KD #11, #12, #65, and #73 below are historical — they document the removed implementation, kept for audit trail. The live parent surface is the following stateless Bearer API:

- **Routes:** `app/api/parent/v2/students/route.ts` + `app/api/parent/v2/report-card/route.ts` — these are the only active parent-facing endpoints.
- **Auth model:** the external admissions portal SPA (e.g. `enrol.hfse.edu.sg` / staging) authenticates parents against the **shared Supabase project**. The SPA passes the parent's `access_token` as an `Authorization: Bearer` header; the route verifies it via `service.auth.getUser(token)` (no session mutation, no cookies).
- **Parent → student linkage:** `lib/supabase/admissions.ts::getAllStudentsByParentEmail` walks all AYs and dedupes by `student_number`.
- **Gate:** active `report_card_publications` window for the student's section + requested term (KD #10 mechanism, unchanged).
- **CORS:** `lib/cors.ts` reflects the request `Origin` when it matches the allowlist (`ADMISSIONS_PORTAL_ORIGIN` env var + hardcoded staging + localhost). Credentials are allowed so the SPA can send the Bearer header cross-origin.
- **Rate limiting:** `lib/rate-limit.ts` — IP-based (30 req/60s) + per-user after token verification (20 req/60s).
- **No in-SIS parent pages** — there is no `app/(parent)/` route group, no `lib/parent/` module, no `/parent/enter` or `/parent/handoff` routes, no `parent_session` cookie, and no `PARENT_HANDOFF_SECRET` (removed/dead — only in `.env.local.example`).
- **`NEXT_PUBLIC_PARENT_PORTAL_URL`** is still live but only in email notification templates (`lib/notifications/email-parents-publication.ts`, `email-pfile-reminder.ts`), not for routing.
- **`proxy.ts`** skips `/api/*` entirely (see the matcher comment referencing `/api/parent/v2/*`); a null-role Supabase session is redirected to `/login` (line 40–44), not to any parent surface.

---

### KD #7

PDF generation deferred — browser print covers current volume. **Sprint 37 extension:** Section batch-print at `/markbook/report-cards/section/[sectionId]/print?term=N` stacks every active + late-enrollee student's `<ReportCardDocument>` with `@media print { .section-print-card { page-break-after: always; } }`. `<AutoPrintTrigger>` fires `window.print()` on mount; the browser dialog produces a single multi-page job — "Save As PDF" gives one file for the whole section. Stays within KD #7's boundary (no server-side PDF service); accessed via a "Print all" link on the Roster header at `/markbook/report-cards?section_id=...`. Auth: registrar / school_admin / superadmin.

### KD #10

Publication windows per `(section, term)` gate parent view (migration 007).

### KD #11

> ⚠ SUPERSEDED (2026-06-09) — describes the removed in-SIS cookie-SSO parent surface; the live implementation is the v2 Bearer API above.

Parents = null-role Supabase users; `proxy.ts` routes them to `/parent/*` only. Linkage via admissions `motherEmail`/`fatherEmail`. **Deprecated for fresh logins by KD #73** but tolerated as fallback identity.

### KD #12

> ⚠ SUPERSEDED (2026-06-09) — describes the removed in-SIS cookie-SSO parent surface; the live implementation is the v2 Bearer API above.

**Deprecated — replaced by KD #65.** Prior parent SSO handoff via `/parent/enter` + `supabase.auth.setSession()` from URL fragment clobbered staff Supabase sessions in shared browsers. Replaced by HMAC-signed `parent_session` cookie (KD #65). `10-parent-portal.md`.

### KD #65

> ⚠ SUPERSEDED (2026-06-09) — describes the removed in-SIS cookie-SSO parent surface; the live implementation is the v2 Bearer API above.

Parent SSO via HMAC-signed parallel cookie. Replaces KD #12. Flow: `/api/parent/handoff` verifies the inbound `access_token` via the service client (without `setSession`) and sets the signed `parent_session` cookie (2h TTL); `/api/parent/exit` clears it; `<ParentSessionWatcher>` clears via `navigator.sendBeacon` on `pagehide`. `/parent/enter` lives in its own `(parent-handoff)` route group so `proxy.ts` bypasses claim checks just for the handoff endpoint. `proxy.ts` treats `/parent/*` as fully cookie-gated (skips Supabase claim checks) and bounces null-role JWTs outside `/parent` to `/login`. Sign-out: `<SidebarProfile>` branches on role — parents call `/api/parent/exit` + `window.location` to the portal so a co-resident staff Supabase session is untouched. Cross-AY visibility: `getAllStudentsByParentEmail` walks every `academic_years` row and dedupes by `student_number`; publication-window per KD #10 is the actual gate. New env var `PARENT_HANDOFF_SECRET` (≥32 chars per `lib/parent/cookie.ts`); MUST differ per environment; rotating invalidates all live parent sessions.

### KD #73

> ⚠ SUPERSEDED (2026-06-09) — describes the removed in-SIS cookie-SSO parent surface; the live implementation is the v2 Bearer API above.

Parent surface is sidebar-less; layout never bounces parents to `/` or `/login`. The `/parent/*` route group is a single-purpose avenue for viewing report cards — no module switcher, no module sidebar, no "Parent Portal" branding. `app/(parent)/layout.tsx` renders a thin print-hidden top header (HFSE identity tile + signed-in email + "Back to parent portal" button) + a `<main>` wrapper. When `parent_session` is invalid: real staff (`role !== null`) → `/`; **everyone else** (anonymous OR null-role Supabase JWT — a legacy `setSession` leftover from pre-KD-#65) → `NEXT_PUBLIC_PARENT_PORTAL_URL`. Closes the path where stale null-role JWTs landed parents on `/login` then bounced via the proxy to the SIS module picker. Empty states are dedicated pages with case-aware copy: `/parent` distinguishes `allScheduled` / `allExpired` / `revoked-or-never-published` via `<EmptyStateCard>`; `/parent/report-cards/[studentId]` distinguishes `expired` / `scheduled` / `revoked` / generic via `<UnavailableState>`. Both helpers use the gradient icon tile + serif title + mono-uppercase eyebrow recipe (design-system §8 + §9.3 status palette: amber for time-bounded windows, destructive red for revoked).
