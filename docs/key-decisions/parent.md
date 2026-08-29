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

✅ **Approval landed the same day as KD #196** (migrations 126/127 — ordered stages, first to act carries a stage, a rejection ends it, the steps are configuration). This flow is its first and only user: the child's form class adviser, then an officer in charge. `status` now moves. **Migrations 128 and 129 followed the same day**: the officer in charge is one post per half of the school, and the notification bell carries declarations. Full account in KD #196.

⚠ **THE FILING ROUTE 500'd ON EVERY SUBMISSION for part of 2026-08-27**, and the parent saw "Could not save that. Please try again." each time. Cause was a temporal dead zone in this route — `byStudentId` read above its own `const`, inside a `.map()` callback where TypeScript cannot prove when it runs, so `tsc` and the full suite both passed. Found by filing in a browser. ✅ **The deliberate rollback is what saved it**: the route deletes the rows it just inserted when the ladder fails, so nothing was stranded and no repair was needed. That branch was written on the reasoning that a declaration with no ladder is the worst failure shape this feature has — the first time it fired, it was right.

✅ **THE REGISTER WRITE IS BUILT — KD #197, the same day.** Approving the last step now marks every school day of the filing `EX` / `mc` on the class register. ⚠ **It corrected this feature's own assumption**: `with_medical` does NOT select the reason. Mr Ace: _"it will be either MC or vacation leave depending on the type of declaration the parent has sent"_ — the KIND of filing chooses, and a certificate changes nothing about the mark. Migration 125's header still argues the old rule and is left as history; read KD #197 instead. Approval also **supersedes** a day the teacher already marked `A`.

✅ **TWO FILING GAPS CLOSED 2026-08-27 (migration 130), both found by Mr Ace after Phase 4.**

**1. A parent could file for days the school is shut.** A Saturday, a public holiday, the middle of the term break — a filing that marks nothing, approves nothing, and spends two approvers' attention proving it. The schema validates dates against each other and against today; only the calendar knows the school is closed, so the check sits in the route and reuses `expandSchoolDays` (KD #197). ⚠ **The test is "NO school day at all", never "contains a non-school day"** — Friday-to-Tuesday is a real filing and the weekend inside it is already skipped correctly. ⚠ **One child is enough**: siblings can sit in different halves of the school and the calendar's audience precedence means a day can be open for primary and shut for secondary, so refusing the whole submission would block a filing valid for the other child.

**2. The duplicate guard caught one shape and only one.** `student_declarations_no_duplicate_filing` is unique on `(filed_by, declaration_type, student_id, start_date, end_date)`, which stops a parent double-tapping submit. It cannot see **the other parent** — `filed_by` is in the key and BOTH parents are on the application — nor **an overlapping range** (27–31 filed, then 28–29 filed; neither is a duplicate of the other and both march through approval). `findOverlappingFilings` asks the real question: is any of this child's requested time already spoken for, regardless of who filed it.

⚠ **AN IDENTICAL RE-SEND AND AN OVERLAPPING ONE GET DIFFERENT ANSWERS, and collapsing them would have undone this KD's own decision.** A re-send of the exact same filing is a double-tap on a flaky connection, and 125 chose to answer that with the existing filing and a **200** — showing somebody a failure for their own double-tap makes them tap a third time. Only a genuinely different range earns a **409** and a sentence. ⚠ **A first cut returned 409 for both**, which would have turned every double-tap into an error; caught before shipping, and `isExactMatch` is what keeps the two apart.

🔴 **Migration 130 narrows the index**, which is what makes re-filing after a rejection possible at all. It excluded only `cancelled`, so the sequence the school actually intends — file without a certificate → officer turns it down and asks for the MC → file the same dates again — collided with the rejected row, raised 23505, and handed the parent a **success carrying the rejection they were trying to replace**. No error to read, nothing to retry, no other route in. Narrowing a partial unique index covers strictly fewer rows, so it cannot fail on existing data. ⚠ **Two rejected filings for the same child and dates can now coexist, and that is correct** — each is a distinct request the school considered and turned down.

⚠ **Neither check can turn its own failure into a refusal.** If either lookup throws, the filing goes through: a filing on a closed day is a small mess somebody can see and fix, while turning a parent away over our own outage is a wall they cannot get past and will not understand.

**Not built here, deliberately:** editing or withdrawing a filing. ⚠ **"Notifying the parent of the outcome" was half-closed on 2026-08-28 — see KD #201.** Handoff brief for the portal's own repo: `docs/handoff/2026-08-27-parent-portal-declarations.md`.

### KD #201

**A parent who is turned down is told why — and the approver's note is where the reason lives.** 2026-08-28. No migration, no new column.

**The problem.** A rejection stopped the ladder and the parent's portal showed `"Not approved"` and nothing else. The approver could write a note, but it reached nobody: not the status list, not an email, and deliberately not `audit_log` (migration 109's rule, restated by 125 and 126). The commonest real reason — _"please attach the medical certificate and file again"_ — had nowhere to go, so a family was told no with no way to learn what to do next.

**Why the existing note field could be reused rather than a second column added.** ⚠ **The decision sheet promised the approver, in writing, "The parent does not see this."** Exposing that column would have retroactively broken a promise. It cost nothing, because **nobody had relied on it**: measured against production before deciding — 4 declarations, all approved, **0 rejections, and not one note ever written** across 8 stages. The field's meaning was still ours to set.

**The rule.** ⚠ **On a rejection the note has no internal reader by construction.** `approval_advance` closes the request and leaves every later stage `waiting` forever, so there is no "next person" — the parent is its only possible audience. On an approval the note does travel to the next approver, so it stays internal and optional. **One field, two audiences, and the copy names both.** A rejection without a reason is refused: `DecideApprovalSchema` carries a `.refine`, and the sheet checks the same rule locally so the person finds out beside the box rather than as a toast.

**Reading it back.** `ParentDeclarationView.decisionReason` is populated **only** when `status === 'rejected'`. ⚠ **Read the stage that REJECTED, never the last stage** — the last one is a `waiting` row with no note, so `stages.at(-1)` would return null and tell the parent nothing, which is the bug this set out to fix. `rejectionReasonFor` carries that rule and `__tests__/declarations/rejection-reason.test.ts` pins it. The ladder is fetched with the existing `loadLaddersBySubject`, batched over the whole list, and **only when something was actually rejected** — the common case is a parent with nothing turned down, and they should not pay for a second query.

⚠ **`register_write_error` stays withheld.** An approved-but-unencoded filing still reads "Approved" to the parent; the register is the school's problem and the staff queue surfaces it.

**Proven end to end against production**, through the real routes: filing 201, a rejection with no reason **400** with its own sentence, a rejection with a reason 200, and the parent's read-back carrying the approver's exact words while every other status returned `null`.

**Still not built:** any email. The seam is clean (`filed_by_email` is `not null`, `after()` is the established trigger, `renderEmailFrame` is the template), but more outbound mail is blocked on the new subdomain and Resend account. The portal status list remains how a parent finds out — it can now say why.

✅ **Browser-proven 2026-08-29** — Mr Ace turned filings down through the SIS and the reason reaches `GET /api/parent/v2/declarations` as `decisionReason`. ⚠ **The parent not seeing it yet is EXPECTED**: the portal is the other team's app and does not render the field. Do not treat that as a defect on this side.

🔴 **OPEN AND NOT FIXED — the exact-match success discards a certificate (found 2026-08-29).**

Reproduced against production: a parent files for a date their child already has an **approved** absence on, and the route returns **200 with the OLD filing**. Nothing is written and the `evidenceUrl` / `evidencePath` they just attached is thrown away. No queue entry appears, because the existing filing is already decided and therefore waits on nobody.

**The cause is a rule doing its job outside the case it was written for.** `findOverlappingFilings` counts a clash against `['pending','approved']` (`lib/declarations/filing-window.ts:154`), and the exact-date branch (`app/api/parent/v2/declarations/route.ts:292-308`) answers it as a **double-tap**. ⚠ **That answer is right for what it was designed for** — a re-submit seconds apart on a flaky connection loses nothing, and showing somebody a failure for their own double-tap makes them tap a third time. It is wrong days later, when the parent is doing something genuinely new: supplying the medical certificate the school asked for.

**Proposed, awaiting Mr Ace:** keep 200 for an exact match on a **pending** filing; return **409** with a plain sentence when the existing one is already **decided**. ⚠ **The deeper question is the school's, not ours** — when a parent obtains the MC _after_ an absence is approved, may they attach it to the existing filing, or is that "contact the office"? Note the register already reads `EX` / `mc` regardless of the certificate (KD #197), so this is about **evidence**, not about the mark.

⚠ **The trap only fires when a filing for those exact dates already exists.** A filing for a different child, or different dates, lands normally — which is why one of Mr Ace's attempts worked and the others silently did not.
