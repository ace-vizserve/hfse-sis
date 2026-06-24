# Data-capture gaps — insights waiting on data

**Date:** 2026-06-24 · **Audience:** HFSE admissions/registrar + dev follow-up

A live check of production data (AY2026, 490 applications) found a handful of dashboard/insight features that are built correctly but sit on **columns the current workflow never fills**. Those features have been **neutral-stated or removed** so nothing shows a confident-but-false chart. Each will **light up automatically** — no redeploy — the moment the underlying data starts flowing.

This note lists each gap: what's missing, what it unlocks, and whether closing it is a **workflow change** (the team starts capturing it) or a **code change** (we make the system stamp it automatically).

## What's already solid (no action)

These are fully populated in production and drive real charts: application status / pipeline (490/490), conversion %, applications-by-level, **conversion by applicant type** (New/Current/VizSchool), document statuses + **passport/pass expiry** (the whole P-Files renewal dashboard), enrolment status, withdrawals. The funnel, conversion, renewal, and retention surfaces are real.

## The gaps

### 1. Per-stage funnel drop-off — _workflow_

- **Missing:** the six stage timestamps (`registration / document / assessment / contract / fee / class UpdatedDate`) are **0–1 of 490**. The data arrives by bulk import / direct status changes that skip the per-stage workflow that would stamp them.
- **Current state:** the funnel shows drop-off across the four **application-status** stages (Submitted → Ongoing Verification → Processing → Enrolled) — real, but coarse.
- **To unlock** _"applicants stall most at Assessment / Fees"_ (stage-level diagnosis): process applications **through the SIS stage steps** so each stage stamps its date. Until then the status-level funnel stands in.

### 2. "Why don't they enrol" (cancellation causes) — _workflow_

- **Missing:** `applicationTerminalReason` is **0 of 490** — no reason is recorded when an application is cancelled/withdrawn.
- **Current state:** the cancellation-causes donut + "Most cancel due to X" finding show a neutral "reasons aren't being recorded yet" message.
- **To unlock:** capture a **reason at cancellation** (a dropdown when marking an application Cancelled/Withdrawn). The cancellation analysis — overall and by level — then appears on its own. _(Optional code support: make the cancel action require a reason.)_

### 3. Time-to-enrol — _code_

- **Missing:** no column is stamped when an applicant becomes **Enrolled** (`applicationUpdatedDate` is 0/490 and was the only candidate).
- **Current state:** the time-to-enrol KPI + histogram were **removed** (they can never populate as-is).
- **To unlock:** a **small code change** — stamp an enrolment timestamp on the Enrolled transition. Then average days-to-enrol + the distribution come back, real. This is the cheapest gap to close and is purely on our side.

### 4. Assessment outcomes — _workflow_

- **Missing:** `assessmentGradeMath` / `assessmentGradeEnglish` are filled for only **~15%** of applicants.
- **Current state:** the assessment pass/fail donut is **labelled honestly** ("of N applicants with grades recorded") so 15% isn't misread as the cohort.
- **To unlock** a representative view: enter assessment grades for **all assessed** applicants.

### 5. Staleness — _code (optional)_

- **Note:** the application-staleness badge is built on `applicationUpdatedDate` (never stamped), so it currently falls back to the **application date** — it measures _days since applied_, not _days since last touched_. It's functional and still a reasonable "old/forgotten application" signal.
- **To unlock** true _"not touched in N days"_: stamp an **update timestamp** whenever an application is edited (small code change). Otherwise leave as-is.

## Summary

| Gap                 | Unlocks                         | Type            | Effort                               |
| ------------------- | ------------------------------- | --------------- | ------------------------------------ |
| Stage timestamps    | Stage-level funnel drop-off     | Workflow        | Team adopts per-stage steps          |
| Terminal reason     | Cancellation-cause analysis     | Workflow        | Dropdown at cancel (+ optional code) |
| Enrolment timestamp | Time-to-enrol KPI + histogram   | **Code**        | Small — stamp on Enrolled flip       |
| Assessment grades   | Representative assessment donut | Workflow        | Enter grades for all assessed        |
| Update timestamp    | True application staleness      | Code (optional) | Small — stamp on edit                |

**The two cheapest wins are code-side and on us** (enrolment timestamp → time-to-enrol; update timestamp → true staleness). The funnel and cancellation insight depend on the team's capture workflow. None are blocking — the dashboards are honest today and self-heal as the data arrives.
