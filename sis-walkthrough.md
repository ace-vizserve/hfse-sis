# HFSE SIS — User Manual & Walkthrough

Welcome to the HFSE Student Information System. This is where everything about a student lives — application, documents, grades, attendance, report cards — all tied to one profile, one identity, one place.

This guide walks you through what the system is, why it replaces the old way of working, and exactly how to use it day-to-day no matter what your role is.

---

## 1. What This System Is

The HFSE SIS is one application with five connected modules:

| Module | What it handles | Who uses it most |
| --- | --- | --- |
| **Records** | Applicant pipeline, student profiles, family info, enrolment stages, discount codes | School admin, registrar |
| **P-Files** | Every official document per student (passports, contracts, medical, etc.) | P-Files officers |
| **Markbook** | Grading sheets, grade changes, report cards | Teachers, registrar, academic admin |
| **Attendance** | Daily attendance, school calendar, holidays, compassionate-leave tracking | Teachers, registrar |
| **SIS Admin** | Academic-year setup, approver routing, subject weights, system health | Superadmin |

They are not separate apps. They are windows into the **same student record**. When you look at a student in Records, view their documents in P-Files, grade them in Markbook, and mark them present in Attendance, you are looking at one person with one permanent ID.

---

## 2. Before vs. After — Why This Exists

For years, HFSE ran on Google Sheets, Google Drive folders, Directus, and email threads. The SIS replaces that.

### Enrolment & Records

| Before | After |
| --- | --- |
| Applicant data scattered across Directus, Sheets, and email | One searchable list at `/records` with cross-year history |
| Duplicate student entries across academic years | Permanent `studentNumber` that never resets |
| No visibility on who's at which enrolment stage | 8-stage pipeline with counts and drill-down per applicant |
| Family details retyped every year | Edit once — profile, family, and stage carry forward |

### Documents (P-Files)

| Before | After |
| --- | --- |
| Loose PDFs in Drive folders per student | Structured document slots per student with status badges |
| Overwriting a file meant losing the old version | Every replacement auto-archives the previous version |
| Multiple-page PDFs emailed and manually combined | Multi-PDF upload auto-merges into one file |
| No way to know which documents are missing or expiring | Dashboard shows "top missing" and "expiring in 30 days" at a glance |

### Grading (Markbook)

| Before | After |
| --- | --- |
| Google Sheets formulas broke when teachers pasted scores | All computation is server-side; teachers only enter raw scores |
| Blank cells silently counted as zero, dropping averages | Blank is preserved as "did not take"; zero is "took it, scored zero" |
| Manual VLOOKUP across files to build report cards | Report card assembles itself from locked grades + attendance + comments |
| Grade changes handled by informal email with no paper trail | Structured change-request workflow with approver routing and full audit log |
| New term meant copy-pasting a fresh workbook | New sheets auto-generate per subject × section × term |

### Attendance

| Before | After |
| --- | --- |
| Attendance tracked in a separate Excel per class per term | One Excel-style grid in the browser, auto-saves per cell |
| Holidays and school days decided sheet by sheet | Central school calendar — set once, respected by every class |
| Compassionate-leave allowance tracked on paper | Automatic quota chip per student, counts only compassionate leave |
| Report card attendance % hand-calculated | Rolls up automatically into the published report card |

### Reporting & Parent Access

| Before | After |
| --- | --- |
| Physical report cards printed and distributed | Parents receive an email link; one click opens their child's report card |
| Parents phoned the office to ask about status | Live publication windows control exactly when parents can view |
| No record of which parent saw what, when | Every parent view and document access is logged |

### System-Wide

| Before | After |
| --- | --- |
| No audit trail — "who changed this grade?" was unanswerable | Every mutation logs actor, action, entity, and context |
| Rolling over a new academic year took weeks of manual setup | Superadmin runs one wizard — terms, sections, subjects, teachers all copy forward |
| Each role needed to know which file lived where | Role-aware dashboards show only what that person needs |

---

## 3. Meet the Team — Roles at a Glance

Each role sees a tailored version of the system. Nobody sees more than they need, and nobody has to click through screens that aren't theirs.

| Role | Who | What they can do |
| --- | --- | --- |
| **Parent** | Enrolled student's parent or guardian | View published report cards, upload documents for their child |
| **Teacher** | Subject teachers and form advisers | Enter raw scores, mark attendance, write report-card comments for assigned sections |
| **P-Files Officer** | Document management staff | Upload, replace, validate, and archive student documents |
| **Registrar** | Joann Clemente | Lock/unlock grading sheets, publish report cards, manage roster, apply approved grade changes |
| **School Admin** | Office staff | Manage enrolment, validate documents in Records, run exports, oversee fees |
| **Academic Admin** | Ms. Chandana, Ms. Tin | Approve or reject grade-change requests, oversee grading integrity |
| **Superadmin** | Amier, CEO | Academic-year rollover, approver assignments, subject weights, destructive operations |

If you can't see something, it's almost always because your role doesn't need it — not because something is broken.

---

## 4. The Student Journey — End to End

This is the life of a student inside the SIS, from first application to year-end report card. Every step corresponds to a real screen you can click to.

### Step 1 — Application

A parent applies at `enrol.hfse.edu.sg`. On submission the student is issued a **permanent `studentNumber`** that will follow them for their entire time at HFSE, even across academic years.

*You don't do anything in the SIS for this step — the parent portal handles it. The applicant shows up automatically in Records.*

### Step 2 — Records Processing

Open **Records → Students** to see every applicant and enrolled student. Each student moves through 8 stages:

> Registration → Documents → Assessment → Contract → Fees → Class → Supplies → Orientation

Click any student to see their full profile. Five tabs are available: **Profile**, **Family**, **Stages**, **Documents**, **Attendance**. Edit fields inline — every change logs who/what/when automatically.

**Tip:** Use the search bar at the top of `/records/students` to find a student by name, `studentNumber`, or `enroleeNumber`. Search works across academic years.

### Step 3 — Documents (P-Files)

Open **P-Files** to manage every official document for every student.

- **Parent uploads** arrive as "Pending review" and must be validated in Records.
- **Staff uploads** are marked "Valid" immediately.
- Uploading multiple PDFs at once **auto-merges** them into one file.
- Replacing a document **auto-archives** the previous version — click History to see every revision.
- If a parent uploads the wrong file, reject it from Records to request a re-upload.

The P-Files dashboard shows completion by level, top-missing documents, revisions over time, and documents expiring in the next 30 days.

### Step 4 — Class Assignment

Once a student has passed Assessment and paid Fees, the registrar assigns them to a section in Records → Stages. To actually put them on a teacher's roster, click **Sync Students** on the Markbook sections page. This pulls the latest assignments from Records into the Markbook roster.

Withdrawn students stay in the roster with their index preserved (greyed out) — they are never deleted.

### Step 5 — Markbook Setup (per Term)

At the start of each term, the registrar sets up grading:

1. **Confirm grading weights** for each subject × level × AY (Primary 40/40/20, Secondary 30/50/20 by default).
2. **Assign teachers** per section × subject (form adviser + subject teachers).
3. **Generate grading sheets** — one click creates every subject × section × term sheet for the AY.

From this point on, teachers can enter scores.

### Step 6 — Grade Entry (Teachers)

Open **Markbook → Grading**. You'll see only the sheets you're assigned to.

- Enter **raw scores** — the system computes PS, Initial, and Quarterly grades for you.
- **Blank ≠ zero.** Leaving a cell empty means "did not take." Typing "0" means "took it and scored zero."
- Everything **autosaves** per cell. No submit button, no lost work.
- The system shows previous-term grades side by side for comparison.
- If you enter a score above the configured max, the cell flags a warning.

### Step 7 — Attendance (Teachers)

Open **Attendance → [Your Section]**. The grid shows students down the left and school days across the top — just like Excel.

- Click any cell to set status: **Present / Absent / Late / Excused / Not Counted**.
- Holidays are greyed out automatically (set in the school calendar).
- Special events (field trips, assemblies) show a ★ overlay — still school days, but noted.
- Each student shows a **compassionate-leave quota chip** — you'll see if they're approaching their 5-day annual allowance.
- Bulk-import from Excel is supported at `/attendance/import` for registrar-driven backfills.

### Step 8 — Lock Grades (Registrar)

When Ms. Chandana signals a term's grades are final, the registrar locks the sheets:

1. Open Markbook → Grading → click the sheet → **Lock**.
2. Teachers can no longer edit; the sheet becomes read-only.
3. The lock timestamp and actor are recorded.

### Step 9 — Grade Changes After Lock (Structured Workflow)

Locked sheets can still be corrected, but only through the proper workflow:

1. **Teacher files a change request** with the corrected score and a reason. They pick a primary and secondary approver.
2. **Only those two approvers see the request** — at Markbook → Change Requests.
3. **Academic admin approves or rejects.** Ms. Chandana and Ms. Tin are the grade-change pool (School Admin and Superadmin deliberately are not).
4. **Registrar applies the approved change** — the system derives the approval reference and writes an audit row.

Every step is logged forever. Withdrawing a score is never a deletion — it's an update to `null` with an audit entry.

### Step 10 — Report Cards (Registrar)

Open **Markbook → Report Cards**. For each section:

1. Review the **pre-publish readiness checklist** — all sheets locked, all comments entered, attendance finalized. Any item can be overridden if you need to publish anyway.
2. Preview the report card per student.
3. Schedule the **publication window** — `publish_from` and `publish_until`. Parents can only view inside that window.
4. Click **Publish**. Parents automatically receive an email with a magic link.

Templates differ by term:
- **Q1–Q3:** Interim template — three terms side by side, no final grade column.
- **Q4:** Final template — all four terms, Final Grade column, general average, cumulative attendance.

Non-examinable subjects display "Passed" in Q4.

### Step 11 — Parent Access

Parents click the link in their email → arrive at `/parent/enter` → the SIS exchanges the URL token for a session → they land directly on their child's report card. No second login.

Parents can also upload documents from the parent portal, which arrive in P-Files as "Pending review."

### Step 12 — New Academic Year (Superadmin)

When the school year ends, the superadmin runs the AY rollover wizard at `/sis/ay-setup`:

1. Create the new AY — this atomically inserts the year, 4 terms, AY-prefixed admissions tables, and copies sections + subject configs.
2. (Optional) Copy teacher assignments forward from the prior year.
3. Flip the `is_current` flag — the entire system switches to the new AY.

`studentNumber` persists. Everything else rolls cleanly.

---

## 5. Role-Specific Quick Starts

### For Teachers

**Your daily 10 minutes:**

1. Log in → you land on `/markbook`.
2. Click **Grading** → pick today's class → enter scores. Autosave handles the rest.
3. Click **Attendance** → pick your section → mark Present/Absent/Late per student.
4. If you need to correct a locked grade, click **Request Edit** on the sheet — fill in the new score, reason, and pick two approvers.

**What you will not see:**
- Other teachers' sheets
- Admin panels
- Report-card publication controls

### For the Registrar (Joann)

**Term-end rhythm:**

1. **Sync students** in Markbook whenever Records has new class assignments.
2. **Lock sheets** per Ms. Chandana's schedule.
3. **Apply approved grade changes** from `/markbook/change-requests`.
4. **Check pre-publish readiness** on each section.
5. **Set publication windows** and click Publish.

**You also own:** student roster management, post-lock edits (via approved change requests), report-card publication.

### For P-Files Officers

**Your core loop:**

1. Open `/p-files` → dashboard shows "top missing" and "expiring" documents.
2. Click any student → document slots are listed by type.
3. Upload, replace, or validate. Replacements auto-archive the previous version.
4. Parent uploads come in as "Pending review" — validate them from the Records tab on the student profile.

### For Academic Admin (Ms. Chandana, Ms. Tin)

**Your primary job is grade integrity:**

1. Open `/markbook/change-requests` → you see pending requests assigned to you.
2. Click any request → see the original score, requested score, reason, and full context.
3. **Approve** or **Reject** with a note.
4. Approved requests move to the registrar's queue automatically.

### For School Admin

**You cover:** enrolment progression, fees coordination, document oversight (read-only in P-Files), exports, and discount-code management.

You do **not** approve grade changes — that is intentional. The academic pool (Ms. Chandana, Ms. Tin) owns grading integrity.

### For Superadmin (Amier, CEO)

**Your landing page is `/sis`**, with three admin cards plus a system-health strip.

- **AY Setup** (`/sis/ay-setup`) — create new academic years, set term dates, copy teacher assignments forward.
- **Approvers** (`/sis/admin/approvers`) — assign admin users to approval flows (currently `markbook.change_request`, extensible).
- **Subjects** (`/sis/admin/subjects`) — edit subject weights (WW/PT/QA) and slot counts per level per AY.

You are **not** in the grade-change approval pool. Your job is structural oversight, not daily academic decisions.

### For Parents

1. Open your email → click the "View Report Card" link.
2. You land on your child's report card with no second login.
3. You can also open the parent portal to upload documents.
4. If the publication window has closed, you'll see a friendly message telling you when it reopens.

---

## 6. Module Walkthroughs in Detail

### Records Module (`/records`)

**Dashboard** — the operational admissions surface. You'll see:
- Pipeline stage counts (Registration through Orientation)
- Document backlog
- Level distribution
- Expiring documents panel
- Conversion funnel and time-to-enroll
- Assessment outcomes and referral sources
- Recent activity feed

**Students list** (`/records/students`) — searchable, filterable table of every student across every AY. Search works on name, `studentNumber`, and `enroleeNumber`.

**Student detail** — five tabs:
- **Profile** — personal info, edit inline
- **Family** — parents, guardians, contact
- **Stages** — move the student through the 8-stage pipeline
- **Documents** — validate, reject, or view history of every document
- **Attendance** — read-only chronological log + monthly breakdown + compassionate-leave quota

**Discount Codes** — catalogue CRUD. Grants are applied to individual applications via the parent portal.

### Markbook Module (`/markbook`)

**Dashboard** — grading-specific only:
- Grade distribution
- Sheet lock progress
- Change-request summary
- Publication coverage
- Recent markbook activity

**Grading** (`/markbook/grading`) — filterable table of every grading sheet. Click one to open the score-entry grid.

**Report Cards** (`/markbook/report-cards`) — per-section list with pre-publish readiness and publish-window controls.

**Sections** (`/markbook/sections/[id]`) — the roster for a section, with a read-only attendance rollup card and per-student comments.

**Sync Students** — one-click pull from Records into the Markbook roster.

**Change Requests** — approve/reject queue (admin) and apply queue (registrar).

**Audit Log** — every grading mutation, searchable.

### P-Files Module (`/p-files`)

**Dashboard** — completion by level, top missing, revisions over time, expiring documents.

**Student detail** (`/p-files/[enroleeNumber]`) — document slots grouped by category. Each slot shows status, last update, and a History button for revision audit.

**Upload dialog** — drag-and-drop multiple PDFs; auto-merge; up to 10 MB per file / 30 MB per request.

**Audit log** — module-scoped. All P-Files mutations logged separately from the main audit log.

### Attendance Module (`/attendance`)

**Sections list** — all active sections, filterable.

**Section grid** (`/attendance/[sectionId]`) — Excel-style wide matrix. Rows are students, columns are school days in the current term. Each cell is a dropdown: Present / Absent / Late / Excused / Not Counted. Autosave per cell.

**Calendar** (`/attendance/calendar`) — registrar admin surface. Toggle holidays, set event overlays, copy holidays forward from prior AY.

**Import** (`/attendance/import`) — bulk xlsx upload with dry-run report before committing.

**Audit log** — every attendance write, correction, calendar change, and bulk import.

### SIS Admin Hub (`/sis`)

Three admin cards plus a superadmin-only system-health strip:

- **Records** — navigation shortcut to the Records module
- **AY Setup** — academic year rollover wizard
- **Approvers** — assign users to approval flows

---

## 7. Key Concepts (Expanded)

### One Student, One Identity

Every student has a **permanent `studentNumber`** assigned at their very first application. It never resets, never changes, and is the key that links their Records profile, P-Files documents, Markbook grades, Attendance ledger, and report cards. Even if a student takes a gap year and returns two years later, the system reunites their history under the same ID.

`enroleeNumber` is an internal working ID that resets each AY — never use it for cross-year linking.

### Blank Is Not Zero

One of the most important distinctions in grading:
- **Blank (`null`)** — "did not take the assessment." Excluded from averages entirely.
- **Zero (`0`)** — "took it, scored zero." Fully counted.

Getting this wrong in the old Google Sheets system was the single biggest source of quiet grade errors. The SIS enforces the distinction everywhere.

### Full Audit Trail

Every mutation — grade entry, score edit, document upload, stage change, attendance correction, publication — writes a row to the audit log with actor, action, entity, timestamp, and context. The log is **append-only**. Unlocking a sheet does not purge history. Withdrawing a student does not delete them. Correcting a score writes an update row, not a replacement.

If anyone asks "who changed this?", the answer is always retrievable.

### Role-Aware Dashboards

Each module's landing page shows **only the data that module owns**:
- Markbook dashboard = grading data only
- P-Files dashboard = document data only
- Records dashboard = admissions + documents + stages
- SIS dashboard = system health

Markbook deliberately does not show admissions widgets. Records does not show grading charts. If you need a cross-module view, switch modules via the header dropdown — don't mix data on a single dashboard.

### Publication Windows

Parents cannot see a report card just because it exists. They can see it only during its **publication window** — a `publish_from` / `publish_until` range set by the registrar per section per term. Outside the window, the URL shows a friendly "not yet available" message. This is how we coordinate school-wide parent release.

### Password & Account Management

Every user manages their own password at **Profile → Account → Change Password**. No need to ask IT. Reset links from the login page also work if you're locked out.

---

## 8. A Typical Day at HFSE

| Time | Who | What they do |
| --- | --- | --- |
| Morning | Teachers | Mark attendance in `/attendance/[section]` (2 min per class) |
| Throughout the day | Teachers | Enter raw scores in Markbook grading grids as assessments get returned |
| Late morning | P-Files staff | Process new parent document uploads; validate or reject |
| Midday | School admin | Move applicants through the stage pipeline in Records |
| Afternoon | Academic admin | Review pending grade-change requests |
| End of day | Registrar | Lock any sheets past deadline; apply approved corrections |
| As needed | Parents | Open their emailed report-card link; upload requested documents |

No module depends on another's daily rhythm. Everyone works in parallel, and the system keeps the shared student record consistent behind the scenes.

---

## 9. Frequently Asked Questions

**Q: A teacher entered a score by accident on a locked sheet. What now?**
They file a change request at the top of the grading sheet. It routes to their picked approvers. Once approved, the registrar applies it. The original value is preserved in the audit log.

**Q: A parent says they didn't receive their report card email.**
Check the publication window — it may not have opened yet. If the window is open, check their email on file in Records → Family. They can also log into the parent portal directly and see the report card there.

**Q: A student's name is spelled wrong. Where do I fix it?**
Records → Students → click the student → Profile tab → edit the name field. It propagates to every module instantly because every module reads the same record.

**Q: Two students have the same name. How do I tell them apart?**
Use the `studentNumber` column — it's unique and permanent. The search bar also accepts `studentNumber` directly.

**Q: A teacher's assigned sections look wrong.**
Superadmin → `/sis/admin/approvers` or the Markbook teacher-assignments panel. Verify the AY and section × subject rows. Assignments are AY-scoped — they don't carry forward automatically unless explicitly copied via the AY rollover wizard.

**Q: The grade for one student shows 0 instead of blank.**
That's because someone typed `0` instead of leaving the cell empty. Edit the cell and clear it — it will save as `null` (blank). Blank is excluded from the average; zero is counted.

**Q: Can I delete a student?**
No. Students are never deleted. If they leave HFSE, set their enrolment status to `withdrawn` — they stay in the roster with their index preserved and all historical data intact.

**Q: Why can't I see the Module Switcher?**
Because your role is locked to one module. Teachers see Markbook and Attendance via the sidebar, not the switcher. P-Files officers are scoped to P-Files only. School Admin, Admin, Registrar, and Superadmin all see the full switcher.

**Q: How do I know if a document was uploaded by a parent or by staff?**
Parent uploads come in as "Pending review" with the parent's email in the actor field of the audit log. Staff uploads are "Valid" immediately. Both are visible in the history dialog for that document slot.

**Q: What happens on 31 July when the new academic year begins?**
Nothing dramatic. Superadmin runs `/sis/ay-setup` → creates AY2027, copies sections and subjects, optionally copies teacher assignments, flips the `is_current` flag. The entire system switches over. Every student keeps their `studentNumber`.

---

## 10. Glossary

| Term | Meaning |
| --- | --- |
| **AY** | Academic Year (e.g., AY2026 = 2026-2027 school year) |
| **`studentNumber`** | Permanent student ID, persists across all academic years |
| **`enroleeNumber`** | Per-AY working ID, resets each year — do not use for cross-year linking |
| **WW / PT / QA** | Written Work / Performance Task / Quarterly Assessment — the three grading components |
| **PS** | Percentage Score |
| **Initial Grade** | Weighted sum of PS across WW/PT/QA before transmutation |
| **Quarterly Grade** | Final term grade after DepEd transmutation |
| **Form Adviser** | Homeroom teacher for a section; writes general comments on report cards |
| **Subject Teacher** | Teacher assigned to a specific subject × section |
| **Grading Sheet** | One sheet = one subject × one section × one term |
| **Lock** | Registrar action that makes a sheet read-only — prevents further teacher edits |
| **Change Request** | Structured workflow for correcting a locked grade |
| **Publication Window** | `publish_from` to `publish_until` range controlling parent visibility of a report card |
| **Compassionate Leave** | Leave reason that counts against a student's yearly quota (default 5 days) |
| **School Calendar** | Central registry of school days, holidays, and events — set once, respected everywhere |
| **Audit Log** | Append-only record of every system mutation with actor, action, and context |

---

## 11. Getting Help

- **Forgot password?** Login page → "Forgot password" → email link.
- **Lost access?** Contact your superadmin (Amier).
- **Found a bug or have a feature idea?** Flag it to the Vizserve team.
- **Need training?** Each role's Quick Start in Section 5 covers 90% of daily work. The rest is in this doc.

This system exists to get you out of spreadsheets and back to teaching, advising, and running the school. If something feels harder than it should — tell us. That's a bug.
