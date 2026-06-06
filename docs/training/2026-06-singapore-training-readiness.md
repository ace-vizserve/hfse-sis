# HFSE SIS — Singapore Onsite Training Readiness (June 22–26, 2026)

**Trainer:** Ace Guevarra · **Dates:** Jun 22–26, 2026 (tentative) · **Drafted:** 2026-06-06 (~16 days runway)
**Success criteria (from the engagement):** training attendance logged · every user completes a competency check.

## What this milestone is (and isn't)
This is the system's **first real-usage event** — the first time HFSE staff touch it hands-on. The bar is **"training-ready," not "full production cutover."** Training *is* the UAT: it surfaces the real bugs, workflow bottlenecks, and gaps. Sequence:

> **Train (Jun 22–26) → collect UAT/bug/bottleneck feedback → fix → THEN production cutover** (real Directus data import, ops/monitoring, scale + security pass).

Do **not** try to be fully production by the 22nd. Be training-ready; let usage write the cutover list.

---

## 1. Training environment + accounts (the foundation — do this first)

**Environment:** use a dedicated **test AY** (code `^AY9…`), never prod — no real student PII, trainees can't break live data, and the `<TestModeBanner>` makes "this is practice" obvious.
- Provision via SIS Admin → Settings → Environment switcher (superadmin, KD #52): switch to / create a training AY → auto-seeds ~200 `TEST-%` students + populated data (grades, attendance, evaluations, docs, publications). Use **"Top-up demo data"** to refresh between sessions if trainees mutate it.
- Confirm the seeded data is realistic post-seeder-fidelity pass (term-spread grades, varied doc expiry, write-ups, movements) — it is, as of Sprint 56–57.

**Per-role trainee accounts** (SIS Admin → Users, direct-create + 16-char password generator, KD #87). Create enough for hands-on, not just one each:
| Session | Role | Accounts | Data prerequisite (the gotcha) |
|---|---|---|---|
| Faculty | `teacher` | ~6–8 (one per trainee table) | **Each must be assigned to a training section** (`teacher_assignments`, form_adviser + subject_teacher) — else they see no grading sheets / roster / attendance to practice on. Assign via SIS Admin. |
| Admin/Registrar | `registrar`, `school_admin` | 2–3 | Registrar sees everything; school_admin sees config + oversight. |
| Admissions | `admissions` | 1–2 | Needs seeded applicants in the funnel + documents to validate. |
| P-Files | `p-file` | 1 | Needs enrolled students with expiring/expired docs (seeded). |
| Parent | `parent` (null-role) | 2–3 | **Link the trainee parent email to a seeded student** (mother/father email) AND **publish that student's section + term** so there's a report card to view. Otherwise the parent sees an empty state. |
| Superadmin | `superadmin` | 1 (Ace) | Break-glass + environment + AY setup. |

**Action:** stand up the training AY + all accounts + the assignment/linkage prerequisites by **~Jun 13**, then run the QA pass (§2) against it.

---

## 2. Happy-path QA per role (pre-departure — catch the embarrassing stuff)

Run *exactly the flows you'll train*, end-to-end, in the training env, as each role. Fix any blocker before the 22nd.

**Faculty (teacher):**
- [ ] Log in → land on assigned sections (Markbook + Attendance + Evaluation pickers show their sections).
- [ ] **Markbook:** open a grading sheet → enter WW/PT/QA scores → see PS/Initial/Quarterly compute → non-examinable letter (A/B/C/IP) + UG/E override → request a change on a locked sheet.
- [ ] **Attendance:** Term-sheet grid — mark P/A/EX/L (EX → pick MC/Excuse leave · compassionate · vacation from the "Excused (EX)" group; cell shows EX) → Daily view "mark-the-exceptions" → student lookup.
- [ ] **Evaluation:** open the write-up roster → Save as draft → Submit → see the per-student pill.

**Admin/Registrar:**
- [ ] **Records:** student permanent record (academic history, grades, GA, awards, FCA comments, documents) → movements feed → unsynced-students queue + assign-section → section transfer.
- [ ] **SIS Admin:** sections + teacher assignments · school calendar (day-types, audience) · school config (awards, quotas, letterhead) · AY readiness pill · discount codes · users.
- [ ] **Report cards:** publish-window panel → the **comment hard-gate** (can't publish a term until that term's FCA comments are submitted) → "Publish anyway" on soft warnings → revoke → section batch-print.
- [ ] **Change requests:** approve/reject a locked-sheet change (in-app + the one-click email path) → see it apply.
- [ ] Dashboards: every KPI card → its drill opens with matching counts (post the scope/window sweep).

**Admissions / P-Files:**
- [ ] **Admissions:** funnel → applicant detail (profile/family/documents/STP) → document-validation queue (approve/reject) → cohorts → early-bird upcoming-AY view.
- [ ] **P-Files:** enrolled student docs → expiring ≤30/60/90 → notify / mark-promised renewal chase.

**Parent orientation:**
- [ ] Parent SSO handoff → `/parent` lists children → open a published report card → confirm a revoked/expired/scheduled empty state reads sensibly.

---

## 3. Training materials (the handover deliverable)

One **plain-English quick-reference per module** (1–2 pages, screenshot-friendly, no dev jargon — per the KD #121 copy standard). Audience-grouped:
- **Faculty pack:** Markbook (enter & review grades, change requests), Attendance (mark the grid + EX subtypes + quotas), Evaluation (write-ups: draft → submit).
- **Admin/Registrar pack:** Records (student record, movements, transfers, unsynced), SIS Admin (sections, calendar, config, users, AY setup/readiness), Report cards (publish windows + the comment gate), Change-request approvals.
- **Admissions/P-Files pack:** funnel + document validation; renewals + chase.
- **Parent one-pager:** how to log in + view/download (print → PDF) a report card.
- **Champions/Power-Users pack:** the above + environment/test-mode awareness, "who can do what" (roles), and the known-issues list.

Format suggestion: a short "do this → see this" task recipe per workflow + a screenshot. Keep each to the *happy path*; edge cases go in the champions pack.

---

## 4. Competency checks (the success metric)

A short, observable per-role task list — trainee performs it unaided; trainer ticks it. Keep to 4–6 tasks each.
- **Teacher:** (1) enter a full set of WW/PT/QA for one student, (2) mark a week of attendance incl. one EX subtype, (3) save + submit one FCA write-up, (4) raise a change request on a locked sheet.
- **Registrar:** (1) assign an unsynced student to a section, (2) transfer a student, (3) open + clear the publish-comment gate then publish a term, (4) approve a change request, (5) read a student's permanent record.
- **School_admin:** (1) create a user, (2) edit a school-config value (e.g., an award threshold), (3) add a calendar day-type, (4) read the AY readiness pill.
- **Admissions:** (1) validate (approve/reject) a document, (2) move an applicant through a stage, (3) find a cohort.
- **P-file officer:** (1) find docs expiring ≤30d, (2) send a renewal reminder / mark promised.
- **Parent:** (1) log in, (2) open + download their child's report card.

Log: attendance sheet per session + a competency-check tally (pass/needs-follow-up) per trainee.

---

## 5. Trainer runbook (your train-the-trainer prep)
- **Per-session agenda** (Day-by-day across Jun 22–26): Faculty → Admin/Registrar → Parent orientation → Champions → materials handover. Each session = short concept → live demo → hands-on → competency check.
- **Demo order per module** (the click-path you'll project) — rehearse it once end-to-end (your own train-the-trainer dry run, ~Jun 20).
- **Known-issues / DON'T-demo list** — anything deferred or rough, so you're never caught flat-footed:
  - Deferred to Ms. Chandana: letter-subject term-trend alerts (M2/M4) — don't promise.
  - Post-go-live deferrals: per-module compare trend charts, Sec 4 Economics card, self-serve invite flow.
  - "MC / Excuse leave" vs "Compassionate" label tidy-up pending (cosmetic).
  - Test-mode banner is expected (you're in the training AY, not prod).
- **Fallback:** if a flow misbehaves live, switch to the screenshot in the material + note it for the post-training fix list. Have the "Top-up demo data" button ready to reset a mangled training dataset between sessions.
- **Feedback capture:** keep a running UAT log during the week (bug / bottleneck / "they expected X") — this becomes the post-training fix backlog and the real production-readiness driver.

---

## 6. Timeline (Jun 6 → Jun 26)
| By | Milestone |
|---|---|
| **~Jun 13** | Training AY stood up + all per-role accounts + assignment/parent-linkage prerequisites done. Happy-path QA pass complete; blockers logged. |
| **~Jun 16** | Blocker fixes shipped (only training-path-breaking ones; defer the rest). |
| **~Jun 18** | Materials drafted (all packs) + competency-check task lists finalized. |
| **~Jun 20** | Trainer dry run (Ace runs the full demo path solo) + known-issues list locked. |
| **Jun 22–26** | Delivery. Attendance + competency logged. UAT feedback captured daily. |
| **Post-trip** | Triage UAT log → fix → then begin the real production cutover (Directus import, ops, scale, security). |

---

## 7. Biggest risks (watch these)
1. **Trainee data prerequisites** (teacher→section assignments, parent→student linkage, a published report card) — the #1 cause of "I log in and there's nothing to do." Verify per account in the QA pass.
2. **Mutable shared training data** — many trainees on one AY will step on each other; the "Top-up / re-seed" reset is your friend, and consider one section per trainee table.
3. **Network/access onsite** — confirm the prod/staging URL is reachable from the Singapore campus + accounts work *before* the session (test from there if possible).
4. **Scope creep into "production"** — resist last-minute feature adds; training-ready ≠ feature-complete. Stability of the trained flows > new functionality.
