# SIS Admin Redesign — Umbrella Spec

**Date:** 2026-07-11 · **Status:** Approved direction (interview record) · **Scope:** umbrella over six sub-projects, each with its own spec → plan → build cycle.

## Why

SIS Admin has drifted into a config filing cabinet: 15 surfaces across four unrelated jobs (AY lifecycle, structural config, access control, break-glass), a heavy hub, once-a-year pages beside daily ones, role-gate mismatches, and machinery whose mental model is invisible (day-type painting, template tabs that do nothing until an unexplained Apply, a manual sync chore the system can do itself). AY setup is not a guided flow.

## Purpose statement

SIS Admin = **"run the school year."** A guided AY lifecycle (setup checklist → operational calendar → structure defaults) plus one RBAC staff directory. Everything derivable is automated (sync). Everything point-of-need moves to where the need is (section creation). One new config entity — grade-level progression — serves admissions.

## Design principles (binding for all sub-projects)

- **Benchmark existing SIS products** (Gibbon / openSIS / PowerSchool class) for each surface's conventions; adapt to HFSE's vocabulary rather than inventing. Web research is part of each sub-project's design phase.
- **KD #48 boundary holds:** SIS defines structure, modules consume. Ownership of structure stays registrar/school_admin; _creation_ becomes available at point of need, but is never relocated to the admissions role.
- **Plain-English UI**; the mental model of every surface stated on the surface itself.
- After SIS Admin, the same interview → decompose → spec → build loop runs through every other module.

## Decisions (the interview record)

1. **Levels.** Static permanent core P1–S4 + manually managed volatile levels (Cambridge CS1/CS2, Youngstarters). NOT derived from `levelApplied` — but admissions demand signals surface ("3 applicants chose CS1; CS1 isn't offered this year"). Grading weight-profile defaults (primary 40/40/20, secondary 30/50/20) live on the level.
2. **Grade-level progression.** Config-only chain UI (P1→…→S4 plus where volatile levels feed). SIS stores it; the admissions portal consumes it (pre-select next level for returning students). Extensible later without reversing KD #127's "no promotion feature" stance.
3. **Section creation at point of need.** Inline registrar-gated "+ new section for {level}" from the admissions class-assignment stage and Records — virtue-name + schedule suggestions (KD #144 official list). The admissions role requests; it never creates alone.
4. **Calendar.** "Term dates imply school days; users manage exceptions + events." Audience (all/primary/secondary) becomes a field on the exception, not tabs; the five day-types become the exception's _type_; Attendance write-gating (KD #50/#76/#98) unchanged underneath. NO tentative flags — school dates are inherently tentative; edits are audit-trailed and the public view carries HFSE's standing "subject to change" disclaimer.
5. **Public calendar.** An embeddable page served by the SIS in HFSE's website format — grouped lists (Public Holidays · School Holidays · Term Exams primary/secondary · Start of Term · Term Breaks · Parents Dialogue · Subject Weeks · School Events · HBL · PTC), which maps ~1:1 onto existing day-types + `calendar_events.category`. Frame-ancestors-locked to `https://isa.hfse.edu.sg/school-calendar/`. Managed by superadmin. Reference: `AY 2026 Calendar.png` (repo root).
6. **Class template → "Structure defaults."** Keep the master + Apply machinery (its never-delete / preserve-per-AY-columns semantics are good); fix comprehension: model stated on-page ("changes here touch no year until you push them"), **Apply-with-preview** (per-AY insert/update diff before commit), **per-AY drift chips** (master vs AY differences), and the global subject catalog visually quarantined from template-scoped weights (immediate-global vs nothing-until-Apply blast radii).
7. **Staff.** Users + Staff assignments merge into one **RBAC staff directory**: accounts with role/module access in one cut; teachers with FCA sections + subject assignments in another; inline actions (create account, change role, enable/disable, assign). The per-section Teachers tab remains as the section-scoped view of the same data.
8. **Sync from Admissions: remove the page.** Verified in code: every in-app enrolment path already syncs inline (`stage/[stageKey]/route.ts:679`, `assign-section/route.ts:291`), and an `auto-sync` sweep route exists. Wire the sweep to the deferred KD #90 cron; the Records unsynced-queue badge stays as the only human surface (catches SQL backfills / out-of-band writes).
9. **Hub.** Slims around the narrowed purpose (largely falls out of the sub-projects). Also fix inventory-found defects: `/sis/admin/staff` has no ROUTE_ACCESS entry (registrar allowed inline, blocked by proxy catch-all), `/sis/admin/settings` inline guard admits school_admin while ROUTE_ACCESS is superadmin-only, the approvers page eyebrow reads "Records · Admin", the calendar's copy-from-prior-AY is dead-wired (`copyFromPriorAyProps={null}`), and hub comments reference the retired `admin` tier.

## Sub-projects (build order)

1. **Levels & progression** — the entity everything else leans on: levels UI (core + volatile + offered-this-year), weight profiles, progression chain, admissions demand signals, portal-facing progression read.
2. **Sync removal + hub slimming + gate fixes** — cheap immediate simplification.
3. **Template → Structure defaults** — reframed editor, Apply-preview, drift chips, catalog quarantine.
4. **Section creation at point of need** — admissions class stage + Records inline flow.
5. **Staff directory** — Users + Staff merge.
6. **Calendar** — exceptions+events model, then the public embed.

## Appendix — current state (from the 2026-07-11 module inventory)

15 routes under `/sis`. Recurring: hub, calendar, sections(+detail), sync-students, staff, discount-codes, audit-log. Once-a-year: ay-setup, template, subjects. Break-glass: settings (env switcher), users, approvers, school-config. The hub renders ~10 blocks + a second audit view. `/sis/calendar` is Attendance's calendar client mounted under SIS (audit prefix `attendance.calendar.*`); `/sis/sections/[id]` overlaps Markbook's section detail. Registrar has no SIS tile — she enters via Records cross-links. Cross-module inbound links: 20+ sites (calendar, sections, discount-codes, sync, school-config letterhead).
