# HFSE SIS — Demo Recording Plan

> Self-recorded demo tutorials. You capture the real workflows; Remotion handles the branded
> wrapper (intro / section cards / callouts / outro) in post.
>
> `★` = must-record (core) · `○` = optional / nice-to-have

---

## Part 1 · Presentation Spec

How to record so the clips cut together cleanly.

### Format

- [ ] Record **1920×1080, 30fps, MP4 (H.264)** — match everywhere so clips drop into one timeline without scaling.
- [ ] Browser at **100% OS scaling**; page zoom ~**100–110%** for legibility.
- [ ] **Full-screen (F11)** or hide tab/bookmark bars — no browser chrome in frame.
- [ ] **Disable OS/browser notifications** before recording (no popups mid-take).

### Environment & data

- [ ] Record in the **AY9999 test environment** with seeded `TEST-` students — never real PII.
- [ ] Decide on the **Test Mode banner**: keep it (honest) or crop the top edge (cleaner). Pick one, stay consistent.
- [ ] **Pre-stage each workflow's starting state** (unlocked sheet ready to fill, application at the right stage, unpublished section). Reset between takes.
- [ ] Use **one demo account per role** (Teacher, Registrar, School Admin, P-File, Admissions) with neutral display names. Never show a password.

### Per-clip discipline

- [ ] **One workflow per clip** — not one long take. Start already on the relevant screen.
- [ ] Move the cursor **slowly and deliberately**; pause ~1s **after** each click; hold ~2s on the final result (room for a callout).
- [ ] Leave **1–2s of "air"** at the start and end of every clip for trims and transitions.
- [ ] **Happy path only** — show validations/errors as their own deliberate clips.

### Audio

- [ ] Cleanest path: record **silent**, then voice-over in post (Descript / CapCut) from a short script. Fast, re-recordable.

### File naming

- [ ] `NN-module-NN-action.mp4` (zero-padded both numbers) → e.g. `30-markbook-02-enter-scores.mp4`. Sorts in order; trivial to assemble.

### Post / branding (Remotion, later)

- [ ] Intro title card → per-module **section card** (reuse the `TutorialIntro` composition, swap `module` / `lesson`) → recorded clip with **zoom/callout** overlays → outro "Next: …".
- [ ] One consistent transition style (e.g. 300ms crossfade).

### Recommended order

Follow the **student lifecycle** for a cohesive story; each module also stands alone as a role tutorial:

**Intro → Admissions → Records → (SIS Admin setup) → Markbook → Attendance → Evaluation → P-Files → Report Cards & Publishing → Parent view → Outro.**

---

## Part 2 · Features to Record, per Module

### 0 · Login & shell — _everyone (short, opens the video)_

- [x] ★ Branded login screen → land on dashboard
- [x] ★ Module switcher + sidebar
- [x] ○ Cmd+K command palette

### 1 · Admissions — _admissions seat_

- [x] ★ Dashboard — funnel KPIs, new-applications priority, chase strip
- [x] ★ Applications list — search/filter, open one
- [x] ★ Application detail — **Profile** edit, **Family**, **Documents** tab, **STP** application + residence history, **Enrollment** stage editor (advance a stage), **Lifecycle** timeline
- [x] ★ Document validation queue — table mode **and** triage mode (PDF preview, Approve/Reject with note, ←/→ nav)
- [ ] ○ Closed applications + terminal reasons
- [ ] ○ Feedback page
- [ ] ○ Insights (Enrollment Health)
- [ ] ○ Upcoming / early-bird applications (read-only)

### 2 · Records — _registrar_

- [ ] ★ Dashboard (registrar operational view)
- [ ] ★ Students directory — search, **index number** column, open a student
- [ ] ★ Student permanent record — **Overview** (doc strip, quick actions), **Academic** (term grades, annual, award badges, GA, FCA comments), **Placement** (status, section, late-enrollee term, withdrawal reason)
- [ ] ★ **Academic Summary** hub → Awards / Attendance / Comments quick-views → **Generate Masterfile** (.xlsx / .csv)
- [ ] ★ **Section transfer** (Move action) → show it land in the **Movements** feed
- [ ] ○ Unsynced-students queue + assign section
- [ ] ○ Late-enrollee → normal convert (T1)
- [ ] ○ Generate class index
- [ ] ○ Insights (Retention & Population)

### 3 · Markbook

**Teacher seat**

- [ ] ★ Sections list → open a grading sheet
- [ ] ★ **Score entry grid** — enter WW / PT / QA, watch **PS → Initial → Quarterly compute live**; Totals editor
- [ ] ★ Non-examinable subject — derived letter display + **Override** (UG / E / N.A.)
- [ ] ○ Activity labels — date administered, page #, "Ongoing"

**Registrar seat**

- [ ] ★ Lock a sheet (+ **bulk lock**)
- [ ] ★ **Change-request flow** — edit a locked sheet → raise request (pick primary/secondary approver) → approver approves
- [ ] ○ One-click email Approve/Reject
- [ ] ★ **Report cards** — roster → open an interim card and a final (T4) card → **section batch print → Save as PDF**
- [ ] ★ **Publishing** — publish-window readiness checklist → publish clean **and** "publish anyway" with gaps → **bulk publish** with per-section checklist
- [ ] ○ Insights (Academic Performance)
- [ ] ○ Audit log

### 4 · Attendance

**Teacher seat**

- [ ] ★ Sections picker → section
- [ ] ★ **Term sheet (wide grid)** — mark **P / A / EX / L** (show the paper-sheet colors), pick an EX subtype, note before-enrolment dimmed cells
- [ ] ★ **Daily view** — everyone defaults Present, flip the exceptions, save
- [ ] ○ Student-lookup sheet

**Registrar seat**

- [ ] ★ Dashboard analytics + one drill-down
- [ ] ★ Vacation-leave & compassionate **quota cards**
- [ ] ○ Insights (Attendance Health)

### 5 · Evaluation — _form advisers + registrar_

- [ ] ★ Sections picker → **writeup roster** — write a comment, **Save as draft**, **Submit / Resubmit**, per-row status pill
- [ ] ★ **Virtue themes** editor (`/evaluation/virtue-themes`) — registrar sets T1–T3
- [ ] ○ Dashboard chase metrics (outstanding write-ups / advisers behind)

### 6 · P-Files — _p-file officer_

- [ ] ★ Dashboard (officer) — expiring-soon, chase strip
- [ ] ★ Student detail — document group tabs + statuses; **upload** (multi-PDF merge, archive-on-replace)
- [ ] ★ **Notify parent** + **Mark as promised**
- [ ] ★ Document validation queue — approve an uploaded doc
- [ ] ○ Revision-history dialog
- [ ] ○ Expiring 30/60/90 bulk-select quicklinks

### 7 · SIS Admin — _school_admin / superadmin; some registrar_

- [ ] ★ Hub — Year Setup cards + **AY Readiness pill**
- [ ] ★ AY Setup — terms with dates + grading-lock
- [ ] ★ **School Calendar** — audience filter, set day-types, add an event
- [ ] ★ Sections — create a section, **Generate index**, **Generate sheets**, schedule chip
- [ ] ★ Class template editor — Sections / Subjects / Weights / Schedule → **Apply to AY**
- [ ] ★ Users — create a user with a role
- [ ] ★ School Config — letterhead, attendance quotas, award thresholds
- [ ] ○ Discount codes
- [ ] ○ Approvers
- [ ] ○ Audit log
- [ ] _(skip the Environment switcher on camera)_

### 8 · Parent view — _external_

- [ ] ○ The parent surface is a **separate SPA** (Bearer API), not an in-SIS page. If you have access, show a **published report card** from the parent side to close the loop; otherwise skip and narrate it.
