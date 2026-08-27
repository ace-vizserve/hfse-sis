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
- **Security hardening (2026-07-08 bug-hunt, C1+C2):** the report-card route filters its payload to **exactly the terms with an active publication window** (pure `lib/report-card/publication-window.ts`, unit-tested) — previously any one active window unlocked all 4 terms. The parent-email match in `getAllStudentsByParentEmail` is parameterized (`.ilike()` per column, no spliced `.or()`) **and escapes `%`/`_`** before matching (regression test `__tests__/supabase/parent-email-ilike-escape.test.ts`) — a `%`-containing registered email can no longer over-match other families. Any future filter on user-controlled strings here must follow the same escape pattern (`lib/sis/queries.ts` cross-AY search does too).
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

---

### KD #165

Parent report card: **cumulative earlier-term comments + parents may read the letterhead** (2026-07-30; migration 100, applied). Two defects on the external portal's report card, both traced to this side.

**1. Only one term's comment reached the parent.** The card is cumulative on adviser comments (KD #129 — a Term 3 card carries T1+T2+T3), but the payload is narrowed to terms with a currently-active publication window (the 2026-07-08 C1 hardening), so earlier terms never arrived. Parents saw one comment where the adviser had written three, and where the publish hard-gate had required all three.

- Fixed with a **new field, `earlierComments`**, on the `/api/parent/v2/report-card` payload: `{ term_id, term_number, term_label, virtue_theme, comment }[]`, ascending by term number. Built by pure `selectEarlierComments` in `lib/report-card/publication-window.ts` (unit-tested).
- **Deliberately NOT merged into `comments`.** The portal reads `payload.comments[0]` / `terms[0]` / `attendance[0]` — the _first_ element — which works only because exactly one term arrives. Appending would have rendered an EARLIER term's comment under the viewed term's heading: wrong data on a document parents keep, which is worse than missing data. As a new field, nothing existing can read it, so it could ship without touching the portal.
- **Each entry is self-describing** (`term_label` + `virtue_theme`), because `terms` still holds only the viewed term — a `terms.find(...)` on an earlier comment misses, and the portal's heading is built from exactly that lookup, so a miss either blanks the heading or throws on a parent-facing page.
- **Bounds:** strictly before the viewed term (so `comments` and `earlierComments` never overlap), terms 1–3 only, submitted + non-empty, and **empty for the Term 4 card** — the final card has no comment section at all (KD #49), so returning them would invite the portal to render a block that shouldn't exist.
- **A first cut also required each earlier term to have its OWN opened publication window** ("only re-show what the parent already saw"). That was wrong and was removed: a school publishes the current term's window and nothing else, so T1/T2 have no publication row and the field arrived **empty every time**. The window gates the **CARD**, not each paragraph on it — and the card it releases is the one staff see on their own preview. Authorisation is unchanged and still real: the route 403s unless the **viewed** term has an active window, and marks + attendance stay narrowed to it. `computePublishedTermNumbers` was deleted with its only caller.
- Marks and attendance are still viewed-term-only. Widening those is a separate, unmade decision.

**2. Blank letterhead — migration 100.** The portal reads `school_config` **directly** using the parent's own session (a `useSchoolConfig` hook), and 022's only SELECT policy requires `current_user_role() is not null`. Parents are deliberately role-less, so the query returned **zero rows silently** and the header fell back to empty — while the table held correct data throughout. `school_config_parent_read` mirrors `rcp_parent_read` (007) with the same `current_user_role() is null` predicate; SELECT only, 022's three write denials untouched. Chosen over having the portal read it from the payload (where `buildReportCard` already attaches `schoolConfig` via the service client) because it fixes the header with **no portal change at all**. Safe to expose: every column is either already printed on the card the parent is being shown or is public record.

**General lesson (see also the module note above): the portal does NOT get everything through `/api/parent/v2/*`.** It queries some tables directly as the parent. As of 2026-07-30 the only parent-readable tables are `school_config` and `report_card_publications`; `terms`, `academic_years`, `evaluation_writeups`, `students`, grades and attendance all require a staff role and return nothing. When content is missing on the portal, establish first whether it comes from the payload or a direct query. Handoff brief for the portal's own repo: `docs/handoff/2026-07-30-parent-portal-earlier-term-comments.md`.

### KD #195

**Parents write for the first time — the Student Absence and Travel Declaration** (2026-08-27; migration 125). Action item #6, reshaped 2026-08-17 so the **parent** files the medical certificate rather than the form class adviser. Christina raised it unprompted and then showed Mr Ace the screen at her sons' school; his call: _"this is the best way since parents are the ones who initially have the doc."_

**What it joins up.** Today the reason for an absence is four disconnected things — a WhatsApp message to the teacher, a paper MC in Mr Hanafi's drawer, the teacher's guess between `A` and `EX`, and the mark. The declaration puts the proof on the day, so the teacher stops guessing. The payoff is the attendance warning letter, which lists absence dates as unexcused: whoever writes it must know which days carried a certificate, and today that means asking Hanafi.

⚠ **THE PARENT→STUDENT LINK STILL DOES NOT EXIST IN POSTGRES, AND THIS DID NOT ADD ONE.** A parent is an `auth.users` row with **no role** (`current_user_role()` is null) and the link is an email match into the AY-prefixed admissions tables, which no policy can reach. So `student_declarations` denies `authenticated` **every** write and the parent matches no arm of its read policy — they see nothing through PostgREST. Authorisation lives in `/api/parent/v2/declarations`, which verifies the Bearer token and resolves linkage with `getAllStudentsByParentEmail`, exactly as the report-card route does. **This is the only shape available**; a row-scoped RLS policy for parent writes is not expressible today.

**One row per child, grouped by `filing_group_id`** — structural, not tidiness. The first approval stage is **that child's** form class adviser and siblings sit in different classes, so a single shared row would have to pool two advisers into one stage, and "first to act carries it" would then let one class's adviser decide another class's child. Fanning out also makes the vacation quota per student, which is what the quota is.

⚠ **Two authorisation steps, and the second is the one that is easy to miss.** Student numbers in the body are checked against the parent's own children — and so is `evidencePath`, which is otherwise just a string. The upload route writes to `declarations/<parent user id>/<uuid>.<ext>`, so a path outside the caller's own folder is an attempt to attach **someone else's medical certificate** to their declaration, where the staff queue would then render it. The prefix is the only thing tying a path to a person.

**Files go in the EXISTING public `parent-portal` bucket**, under a `declarations/` folder. ⚠ **An earlier plan made private storage its own phase**, quoting migration 121's refusal to store warning letters because it would be "the app's FIRST private file". Mr Ace pushed back and was right: P-Files has kept **passports, birth certificates and medical reports** in that same public-by-URL bucket since the beginning (`DOCUMENT_SLOTS`). An MC is the same category of document. The real observation is broader and predates this feature — the whole document store is public-by-URL — and fixing it is one project across every document type, not a special case bolted onto medical certificates.

**`GET /api/parent/v2/enrolled-students` is a SECOND child list, and picking the wrong one is a silent bug.** `/students` is gated on **publication** — it answers "which of my children has a report card I can read right now", and a child who is enrolled and attending but between publications is correctly absent from it. Anything a parent does **about** a child (this, and event registration later) needs the enrolment list instead. Using `/students` there hides a child from their own parent for the stretch between publications, and it does not look like a bug — it looks like the child is not there. Both route headers point at each other.

**`corsHeaders` took a `methods` argument rather than having its hardcoded string edited.** The obvious change would have handed `POST` to the report-card and students routes on the same deploy. The default stays `GET, OPTIONS` and only the two declaration routes opt in. ⚠ **The first version of the guard test did not work** — it matched `corsHeaders\([^)]*\)` and asserted the match held no comma, but that regex stops at the first `)`, the one closing `request.headers.get('origin')`, so it never saw the second argument. `__tests__/api/cors-methods.test.ts` now reads the declared methods, proves the assertion can fail, and requires **every** route under `app/api/parent/v2` to be classified — the risk was never a route advertising the wrong methods, it was one nobody remembered to think about.

**Both parents see the same list.** The status read is scoped by **child**, not by `filed_by` — if the mother files, the father sees where it got to. Both are on the application.

**Status labels are the parent's words, not the schema's.** `pending` renders as **"With the school"**: _pending_ reads as _stuck_ to somebody watching a form they filed about a sick child.

**Not built here, deliberately:** approval (KD forthcoming — stages, first-to-act), the register write on final approval, editing or withdrawing a filing, and notifying the parent of the outcome. Handoff brief for the portal's own repo: `docs/handoff/2026-08-27-parent-portal-declarations.md`.
