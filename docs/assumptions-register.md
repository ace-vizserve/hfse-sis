# HFSE SIS — Assumptions to Confirm

**Purpose.** The SIS's academic core (grading formula, weights, awards, attendance quotas, admissions pipeline, identity) was validated against real HFSE documents and people. The **operational / workflow layer** (approvals, chasing, validation, some convenience features) was built on reasonable defaults that haven't been pressure-tested against real use — because there are no live users yet. This is the checklist to walk through with the people who do the work, so we change only what's actually wrong (twice already, speculative workflow features — PTC and SOW-ownership — were built then unwound; this prevents a third).

**How to use.** For each item: ask the question to the named person. If the answer is "yes, that's how we do it" → mark Confirmed. If "no / not quite" → note what they actually do; that becomes a change request. Don't pre-build alternatives.

**Who's who.** Joann = registrar (enrolment, approvals, chasing, attendance ops). Chandana = academic/school_admin (grading, evaluation, virtues). P-file officer = document renewals. Admissions team = pre-enrolment funnel + document validation.

**Status legend.** ☐ to confirm · ✅ confirmed against a real artifact/person · ⏸ deferred decision (already flagged).

---

## Markbook (grading)

✅ Already confirmed: the formula + weights (40/40/20 primary, 30/50/20 secondary), annual grade, General Average (1dp), the award ladder, non-examinable letters + per-term UG/E overrides (JoAnn). No need to re-ask.

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| M1 | After a sheet is **locked**, a grade change needs a structured request: the teacher picks a **primary + secondary approver** (office staff), both are notified, and a reason + reference is recorded. | Joann | "When a teacher needs to fix a grade after the sheet is locked, what really happens? Do you pick two approvers, or does one person just approve it directly?" | Simplify the approver model (e.g. single approver / registrar-only) |
| M2 ⏸ | For letter-graded subjects (Music, Arts, PE, HE…), the term-to-term **Alerts** trend shows the numeric-equivalent swing (same as numeric subjects). | Chandana | "For the letter subjects, do you want the term-over-term trend flagged differently — or is showing the number-equivalent fine?" | Build a letter-specific trend treatment |
| M3 | The **publishing checklist** is a soft gate — the registrar can always "Publish anyway"; warnings don't block. | Joann | "Before report cards go out, should any of the warnings *block* publishing, or is it always your call to publish anyway?" | Make specific checks hard gates |

---

## Attendance

✅ Already confirmed: day-types, vacation leave (1/term), compassionate (5/yr) — verified against your actual T1 workbook; the HBL/marking-day overlay matches the published AY2026 calendar.

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| A1 | A student who **joins mid-year** is only judged from their join date — earlier terms show 0/0 (not counted against them). | Joann | "If a student joins in Term 2, should Term 1 attendance just be blank for them — never counted as absences?" | Adjust the proration rule |
| A2 | Exceeding the VL quota shows a **warning but still records** the leave (registrar can grant an exception). | Joann | "If a student goes over their leave quota, should the system let you record it anyway with a warning, or block it?" | Make the quota a hard block |
| A3 ⏸ | Attendance marks use the SIS's semantic colours, **not** the old sheet's colours (P=blue, A=yellow, EX=cyan, Late=pink). | Teachers | "Do you want the marks colour-matched to the old paper sheet?" | Recolour the grid |

---

## Evaluation (form-class-adviser write-ups)

✅ Already confirmed (the hard way): the module is FCA write-ups only — PTC runs on JoAnn's offline form, not the SIS. Manual Save-as-draft / Submit (registrar feedback).

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| E1 ⏸ | A write-up's **text already shows on the report card even as a draft** — "Submit" only drives the progress counts, not parent visibility. | Joann / Chandana | "Should a comment be hidden from parents until the adviser hits Submit — or is it fine that the draft text already appears?" | Gate report-card visibility on Submit |
| E2 | The FCA comment header reads "Form Class Adviser's Comments (HFSE Virtues: …)" pulled from the term's virtue theme. | Chandana | "Is that heading wording right, and is the per-term virtue theme the correct source?" | Adjust wording/source |
| E3 | T4 (final report) has **no** FCA comment block. | Chandana | "Is it correct that the year-end report has no adviser comment — comments are T1–T3 only?" | Add T4 comment handling |

---

## Admissions

✅ Already confirmed: the 13-step intake → 9-stage pipeline; both application-status fields; STP/Edutrust tracking; "parents upload ICA documents directly, so the SIS doesn't track those files."

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| AD1 | When parents upload documents, an officer works a **validation queue** approving/rejecting each one. | Admissions | "After a parent uploads documents, who checks them and how? Does one person work through a queue approving/rejecting each?" | Rework the validation flow |
| AD2 | Chasing splits into "parent owes us" (To follow / Rejected / Expired) vs "we owe a review" (Uploaded). | Admissions | "When you chase families for documents, is that the right split — and are those the statuses you actually use?" | Adjust the chase buckets |
| AD3 | There's a page collecting **applicant feedback** on the online application experience (1–5 + comments). | Admissions / leadership | "Do you actually ask families to rate the application form? Is this page useful or unused?" | Remove or repurpose the page |
| AD4 | You open **next year's** applications while the current year is still running (early-bird window, controlled in SIS Admin). | Joann / admissions | "Do you collect next-year applications early while this year runs? Is opening/closing that window from SIS Admin the right place?" | Move/adjust the early-bird control |

---

## Records & SIS Admin (enrolment, identity, config)

✅ Already confirmed: studentNumber as the permanent ID; atomic mid-year section transfer; "the school year has started → anyone joining is a late enrollee" (registrar rule); the staff→role mapping.

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| R1 | Sometimes an enrolled student has no class section yet and won't appear in Records until assigned; the SIS has a **queue to assign them a section**. | Joann | "Does it happen that a student is enrolled but has no class section (a gap from the old system)? Is assigning them from a queue the right fix?" | Rework the unsynced handling |
| R2 | The withdrawal **reason list** (the dropdown when a student leaves) matches your categories. | Joann | "Are these the right reasons for why a student leaves — anything missing?" | Adjust the reason list |
| R3 | A section's roll can be **re-numbered alphabetically** on demand (a button). | Joann | "Do you ever re-number a class roll alphabetically? Is that button something you'd use?" | Drop the feature |
| R4 | There's a single **movements feed** of all transfers / withdrawals / late joins. | Joann | "Would one combined list of all enrolment changes be useful, or do you track those elsewhere?" | Drop or reshape it |
| R5 ⏸ | **Discount codes** are managed under SIS Admin. | Joann / admissions | "Who should own discount codes — office/SIS Admin, or the admissions team?" | Move codes to Admissions |

---

## P-Files (document renewals)

✅ Already confirmed: it's a repository (not a review queue); enrolled-students-only; STP docs not tracked (parents upload to ICA directly).

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| P1 | When a document is expiring/expired, the officer chases the parent by **emailing a reminder** or **marking "promised by <date>"**, with a 24-hour cooldown between reminders. | P-file officer | "When a passport/pass is expiring, how do you chase the family? Is emailing a reminder / marking a promised date how you'd work?" | Rework the renewal chase |
| P2 | "Expiring soon" surfaces at **30 / 60 / 90 days** before expiry. | P-file officer | "How far ahead do you start chasing renewals — 30, 60, 90 days?" | Adjust the windows |

---

## Parent portal

✅ Already confirmed: parents see report cards gated by publication windows; secure sign-in.

| # | What the SIS assumes / does | Ask | Question | If "no" → |
|---|---|---|---|---|
| PA1 ⏸ | Saving a report card as PDF is done via **browser Print** (no one-click PDF button). | Joann | "Is 'Print → Save as PDF' acceptable for report cards, or do you need a one-click PDF download?" | Add server-side PDF generation |
| PA2 | Report cards are released per **(section, term) publication window** the registrar opens/closes. | Joann | "Is releasing report cards per class-and-term, on a window you open, the right model?" | Adjust the release model |

---

## How to close this out
Walk each table with the named person. Anything marked **☐ → "no"** becomes a small change request (most are simplifications, which is cheap and safe). Anything **✅** needs no action. The **⏸** items are decisions already waiting on them. The highest-value confirmations are the workflow ones — **M1 (grade-change approval), AD1 (document validation), P1 (renewal chase)** — because those touch how staff spend their day.
