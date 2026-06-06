# Session 00 — Train-the-Trainer + Week Overview

**Audience:** Ace (facilitator) — pre-departure self-prep + the master plan for Jun 22–26.
**Goal:** you can run every session confidently, the environment is ready, and you know exactly what to demo and what to avoid.

> Companion docs: setup + QA + competency lists live in `docs/training/2026-06-singapore-training-readiness.md`. Per-session guides are `01`–`05` in this folder.

---

## How every session runs (the repeatable shape)
Each module/topic follows the same 4-beat loop — keep it tight, keep them clicking:
1. **Concept (2–3 min)** — what this does + why it matters to *their* day (frame in their words: "this is where you mark who's absent," not "the attendance writer").
2. **Live demo (5–8 min)** — you drive, projected. Narrate the click-path. Show the *happy path* only.
3. **Hands-on (10–15 min)** — they do it on their own training account. Walk the room.
4. **Competency check (3–5 min)** — the observable task; tick each trainee off.

**Golden rules for the room:**
- Always on the **training AY** (test-mode banner visible) — never prod, never real student data.
- One concept at a time; resist tangents into deferred features (see the DON'T-demo list).
- "Show, don't tell" — every claim is a click.
- Plain language — match the UI's plain-English copy; avoid dev jargon (no "RLS," "upsert," "cache").
- Capture every "huh, I expected X" into the **UAT log** — that's the real prize of the week.

---

## Week-at-a-glance (suggested)
| Day | Session | Audience | Modules |
|---|---|---|---|
| Mon Jun 22 | **Faculty / Teacher** (Session 01) | Subject + form-class teachers | Markbook · Attendance · Evaluation |
| Tue Jun 23 | **Admin & Registrar** (Session 02) | Joann + office staff | SIS Admin · Records · Report cards |
| Wed Jun 24 | **Admissions / P-Files** (part of 02 or its own block) | Admissions team · P-file officer | Admissions funnel · document validation · renewals |
| Thu Jun 25 | **Parent Orientation** (Session 03) | Parent reps | Parent portal |
| Thu/Fri | **Power Users / Champions** (Session 04) | 2–4 selected staff | Cross-module + troubleshooting + admin |
| Fri Jun 26 | **Materials handover** (Session 05) + wrap | All leads | Guides, accounts, support plan |

Adjust to HFSE's actual room/time blocks — the *order* matters more than the exact days (teachers first; champions after they've seen the modules; handover last).

---

## Pre-departure checklist (you, before you fly)
- [ ] **Training AY** stood up (test AY, `^AY9…`) with realistic seeded data; "Top-up demo data" tested as a reset.
- [ ] **Per-role trainee accounts** created (teacher ×6–8, registrar, school_admin, admissions, p-file, parent ×2–3) — passwords printed/sheeted.
- [ ] **Data prerequisites** verified per account: each teacher assigned to a training section; a parent account linked to a seeded student **with a published report card**; admissions has applicants + docs to validate; p-file has expiring docs.
- [ ] **Happy-path QA** run as each role (see readiness doc §2); blockers fixed.
- [ ] **Onsite access confirmed** — the URL loads + accounts log in *from the Singapore campus network* (test ahead if possible).
- [ ] **Your dry run** — click every demo path end-to-end once (this doc + 01–05).
- [ ] **Printed:** competency-check tally sheets + attendance sheets per session.
- [ ] **Materials** (handout packs) finalized.

---

## The DON'T-demo / known-issues list (keep this in your pocket)
- **Letter-subject term-trend alerts** (MAPEH ±5) — deferred to Ms. Chandana. Don't promise it.
- **Post-go-live deferrals** — per-module compare trend charts, Sec 4 Economics card, self-serve invite flow. Mention as "roadmap," don't demo.
- **Test-mode banner** is expected — explain it ("we're in the practice environment").
- Minor cosmetic: "Compassionate" vs "Urgent / compassionate" label (same thing) — ignore if it comes up.
- If a flow misbehaves live → switch to the screenshot in the handout, log it, move on. Reset mangled data with "Top-up demo data."

---

## If something breaks live (composure plan)
1. Don't debug in front of the room. "Let me note that — here's the result from earlier" → screenshot.
2. Log it in the UAT log (one line: what / which role / expected vs got).
3. If data is mangled from hands-on, hit **Top-up demo data** between sessions to refresh.
4. Keep the energy on *their* learning, not the bug.

---

## What "success" looks like (your deliverable metrics)
- Attendance logged per session.
- **Every trainee completes their role's competency check** (pass / needs-follow-up).
- A populated **UAT log** (bugs, bottlenecks, "expected X") → becomes the post-trip fix backlog → drives the real production cutover.
- Materials handed over + at least 2 **champions** who can support peers after you leave.
