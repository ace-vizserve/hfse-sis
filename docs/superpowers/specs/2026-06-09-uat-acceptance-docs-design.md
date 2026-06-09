# HFSE SIS — Role-based UAT (User Acceptance Testing) docs

**Date:** 2026-06-09
**Status:** Design — approved (user: "LGTM ill check it either way")
**Purpose:** Turn the internal `docs/assumptions-register.md` into **plain-English, per-role UAT documents** HFSE staff can run at the onsite — verify each behaviour, mark pass/fail, and **write the correct process** when the system is wrong.

## Why

The assumptions register is an internal dev artifact (IDs, KD refs, "if no →" fallbacks, named people). Staff need acceptance-test docs: role-scoped, jargon-free, answerable, and writable. The system also changed materially since the last validation (2026-06-06) — Sprints 57–59 added index-number generation, the Academic Summary hub, the virtue-theme editor move, section tables, and a **hard publish gate** — none seen by staff. UAT is the moment to confirm.

## Deliverable

**Three role docs**, each as **Markdown** (readable/printable) **+ CSV** (drops into Google Sheets for filling):

- `docs/uat/uat-registrar.md` + `.csv`
- `docs/uat/uat-academics.md` + `.csv` (teachers + academic coordinator)
- `docs/uat/uat-admin-office.md` + `.csv` (school admin + **Admissions** + **P-File** as labelled sections)

## Format (each item = a UAT test case)

A table; columns:

| # | Area | What the system does (expected) | How to check it | Works as expected? (Yes/No) | If not — the correct process |

- **Plain English.** No internal IDs/KD-refs, no "if no → drop the feature" hints. A simple per-doc number (R-01, A-01, AD-01).
- **"Ask" reframed to ROLE**, never a person's name (Registrar / Teacher / Academic Coordinator / Admissions / P-File Officer).
- **Last column is blank** — the fillable "what should actually happen" field.
- Each doc opens with a 3-line header: what this is, how to fill it (mark Yes/No, write the correct process if No), and who it's for.
- CSV mirrors the table 1:1 (last two columns empty) so it imports clean to Sheets.

## Per-role coverage map (accurate to the CURRENT system)

Each row below becomes one or more test cases. Behaviour must match shipped code (audited 2026-06-09).

### Registrar (`uat-registrar.md`)

- **Enrolment & identity:** studentNumber is permanent across years; unsynced-students queue + one-click Assign-section (R1); withdrawal reason dropdown + "Other" (R2); combined movements feed of transfers/withdrawals/late-joins (R4); late-enrollee joining-term prompt once the year has started.
- **Sections:** Generate class index — alphabetical by surname at year start, **withdrawn numbers retired/never reused**, late enrollees + **mid-year transfers append at the bottom**, escalated warning once a term has started (KD #136); atomic section transfer (same level only, 50-cap).
- **Attendance (ops):** mid-year proration (join-date onward, earlier terms blank — A1); leave-quota **warns but still records** (A2); EX subtypes (MC / Vacation 1-per-term / Compassionate 5-per-year).
- **Grading (registrar duties):** configure grading sheets (QA max editable; WW/PT fixed at 5); **bulk lock** sheets at term end (M5); grade-change requests routed to designated approvers + one-click email approve/reject; the publishing checklist + **hard gate** (a section can't publish a term until every required student has a _submitted_ comment **and** the term's virtue theme is set — KD #129/#138; other checks stay soft "publish anyway"); **bulk publish** with per-section readiness (publishes ready, skips blocked); Academic Summary hub + masterfile export (.xlsx/.csv).
- **Virtue themes:** registrar sets each term's virtue theme at Evaluation → Virtue Themes (T1–T3).
- **Report cards:** released per (section, term) window the registrar opens/closes (PA2); Save-as-PDF via browser Print, "Print all" for a whole section (PA1).

### Academics — teachers + coordinator (`uat-academics.md`)

- **Markbook:** enter WW/PT/QA raw scores per section/subject/term — grades compute on the server (you never write a formula); **blank ≠ zero** (blank = not taken/excluded; 0 = took it, scored zero); Primary 40/40/20, Secondary 30/50/20 weights; letter subjects (Music/Arts/PE/HE…) derive A/B/C/IP from the same scores with UG/E/N-A overrides.
- **Slot labels (CORRECTED — KD #105):** you _can_ label each WW/PT slot with a description + date administered (shows in the column header), but it's **optional — it does NOT lock score entry** (verify: a slot with no label/date is still editable). _(This corrects a previously-documented gate that doesn't exist — confirm the real behaviour suits them.)_
- **Locked sheets:** when a sheet locks, cells go read-only; fixes go through a **change request** (propose value + reason + approver).
- **Attendance (marking):** Daily view — everyone defaults Present, flip exceptions; P/A/EX/L with paper-sheet colours; pick the EX subtype.
- **Evaluation (form-class advisers):** one write-up per student per term (T1–T3; **T4 has none**); Save-as-draft / Submit / Resubmit; the term's virtue theme heads the comment box (E2/E3); **a section's report cards can't publish for a term until its write-ups are submitted** (the hard gate from the registrar side — advisers should know their submit is the blocker).
- **Coordinator-only (still open):** for letter-graded subjects, is the numeric-equivalent term trend fine, or do you want a letter-specific trend treatment? (M2/M4 — the one genuinely unresolved item.)

### Admin / Office (`uat-admin-office.md`)

- **SIS configuration (school admin):** AY setup + rollover from the master template (terms/dates/sections/weights); school calendar (day-types, per-audience primary/secondary); subjects + weights (changes sync to unlocked sheets); users + grade-change approvers; school config (award thresholds 88.5/91.5/95.5, leave-quota defaults, report-card letterhead); early-bird application window — open next year while this year runs (AD4); discount codes (now accessible to the admissions team too — R5).
- **Admissions (labelled section):** the application pipeline stages (Submitted → Ongoing Verification → Processing → Enrolled); **document validation queue** — approve/reject each uploaded doc (AD1); chase split — "parent owes us" (To follow/Rejected/Expired) vs "we owe a review" (Uploaded) (AD2); applicant **feedback** page (1–5 + comments — keep? AD3); STP/Edutrust tracking (type/status/residency); ICA documents are **not** tracked in the SIS (parents upload to ICA directly).
- **P-File officer (labelled section):** renewals repository for enrolled students (not a review queue); expiry auto-flags; "expiring soon" at **30/60/90 days** (P2); chase by **emailing a reminder** or **marking "promised by <date>"**, 24-hour reminder cooldown (P1); replacing a file archives the old version.

## Non-goals

- Not a test of the academic math itself (already validated against HFSE artifacts — formula/weights/awards confirmed).
- No code changes — pure documentation.
- The internal `docs/assumptions-register.md` stays as the dev-side record (this is the staff-facing companion; cross-reference, don't delete).

## Verification

- Three role docs + three CSVs created under `docs/uat/`.
- Each test case's "expected behaviour" matches shipped code (cross-checked against the 2026-06-09 audit + KDs); no internal IDs/KD-refs/person-names leak into the staff-facing text; "Ask" is role-based; the correct-process column is blank.
- CSVs import cleanly to Google Sheets (proper escaping/quoting).
- Spot-read each doc for plain-English readability (no dev jargon — per the plain-English-copy rule).
