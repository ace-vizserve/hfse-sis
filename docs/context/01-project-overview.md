# HFSE SIS — Project Overview

## What This Is

A Student Information System for HFSE International School (Singapore). It centralizes enrollment, grades, documents, and student records in one place, all connected to a single student profile. The system is organized into seven modules — **Markbook** (grades / report cards), **Attendance** (daily register + term rollup), **Evaluation** (form-class-adviser write-ups), **P-Files** (documents), **Admissions** (applicant pipeline), **Records** (enrolled-student system of record), and **SIS Admin** (AY setup, calendar, sections, config) — all sharing the same student record as their backbone. **Academic Summary** lives under Records as a cross-subject grade and awards view per level/class. The **Parent Portal** is an external Vite SPA (`enrol.hfse.edu.sg`) that consumes a read-only Bearer API (`/api/parent/v2/*`) to show published report cards. Modules are surfaces of one system, not sibling apps, and cross-link through the stable `studentNumber` key so a student's data stays consistent regardless of which surface you're viewing it from.

## Organization Context

- **School:** HFSE International School, Singapore
- **Curriculum:** Aligned with DepEd Order No. 8, s. 2015
- **Levels:** 15 in word form — Youngstarters Little / Junior / Senior Stars (preschool, no grading yet), Primary One–Six, Secondary One–Four, Cambridge Secondary One (Year 8) + Two (Year 9)
- **Terms:** 4 terms per academic year (T1, T2, T3, T4)
- **Class Types:** Global Class and Standard Class (different grading weights per subject)
- **Current AY:** AY2026

## Key People

| Person         | Role                                 | Relevance                                                          |
| -------------- | ------------------------------------ | ------------------------------------------------------------------ |
| Joann Clemente | Registrar / Grading Admin (Vizserve) | Manages all grading sheets, locks/unlocks, applies post-lock edits |
| Ace Guevarra   | Developer (Vizserve)                 | Building this app                                                  |
| Kurt Arciga    | Developer (Vizserve)                 | Supporting development                                             |
| Amier Ordonez  | IT Lead (HFSE)                       | Client-side decision maker                                         |
| Ms. Chandana   | Principal (HFSE)                     | Approves grade adjustments and lock schedules                      |
| Ms. Tin        | Academic Head (HFSE)                 | Co-approves adjustments                                            |

## The Problem Being Solved

HFSE's pre-SIS workflow was built on Google Sheets and disconnected spreadsheets:

**Grades**

- Grading sheets, attendance registers, and the masterfile were maintained separately — VLOOKUPs linking them broke when teachers copy-pasted into locked cells or encoded scores in inconsistent cell formats
- The masterfile could show different grades from what the teacher actually recorded, with no way to tell which was correct
- Report cards were generated manually from the masterfile, compounding the drift
- Parents accessing grades via the parent portal saw inconsistent numbers, leading to complaints

**Attendance**

- Attendance registers lived in separate Excel files, unconnected to grading or the masterfile
- Index numbers were not reliably shared across the attendance register, grading sheet, and masterfile — divergence between lists caused confusion when cross-referencing

**FCA Comments**

- No visibility into which form class advisers had or hadn't submitted their comments
- Miss Joann had no way to monitor completion without manually checking each sheet

**Admissions, Records, Documents**

- Student data scattered across Directus, Google Drive, and Google Sheets with no shared identity
- No clear pipeline tracking an applicant from inquiry through enrolment
- Document tracking (passports, passes, permits) handled manually with no expiry monitoring

## What the SIS Delivers

The core win is a **single source of truth with no reconciliation step**:

| Old pain                                                | SIS resolution                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Masterfile ≠ grading sheet (VLOOKUPs)                   | Report card, Academic Summary, and parent portal all compute live from the same `grade_entries` row the teacher encoded              |
| Teachers encoding different cell formats                | Structured WW/PT/QA input — scores are numbers with defined slots, not free text                                                     |
| Parent-visible grades inconsistent with teacher records | No intermediate file; parents see the computed output of exactly what the teacher saved                                              |
| Attendance register not aligned with grading sheet      | `section_students.index_number` is the single roster — attendance, grading sheets, masterfile, and Academic Summary all read from it |
| No FCA comment monitoring                               | Miss Joann monitors write-up completion per section and per adviser from Evaluation; virtue themes are set once per term             |
| Admissions, records, documents in separate silos        | Admissions → Records → P-Files pipeline with hard module boundaries and one `studentNumber` across all of them                       |

**Miss Joann's role in the SIS is deliberately narrow:**

- Configure grading structure: subject weights, WW/PT slot counts, QA max scores
- Set virtue themes per term (T1–T3)
- Monitor FCA comment completion — see which advisers haven't submitted yet
- Manage index numbers per section
- Lock/unlock grading sheets and process post-lock change requests

Everything else (encoding scores, submitting comments, marking attendance) is owned by teachers. The system enforces this separation so Joann spends time on configuration and oversight, not on reconciling spreadsheets.

## Tech Stack

| Layer                  | Technology                                        |
| ---------------------- | ------------------------------------------------- |
| Frontend + Backend API | Next.js (App Router)                              |
| Database               | Supabase (PostgreSQL)                             |
| Deployment             | Vercel                                            |
| Report Cards           | Browser print / save-as-PDF (no separate service) |
| Student Data Source    | Supabase admissions DB (existing)                 |

## High-Level Architecture

```
Browser
  └── Next.js App (Vercel) — the SIS, one deployable (7 modules: Markbook / Attendance /
        Evaluation / P-Files / Admissions / Records / SIS Admin; Academic Summary under Records)
        ├── /app — React frontend (all modules share one route tree under app/)
        ├── /api — Next.js API routes (CRUD, grade computation, auth)
        └── Report cards render in-browser — browser's native print / save-as-PDF.
            No separate PDF service. (/api/parent/v2/* serves the external parent SPA.)

External SPA (parent portal — enrol.hfse.edu.sg / staging)
  └── Vite app — authenticates against the shared Supabase project via Bearer token;
        sends Authorization: Bearer <access_token> to /api/parent/v2/*.
        Shows published report cards gated by per-section publication windows (KD #10).
        CORS gated via lib/cors.ts (ADMISSIONS_PORTAL_ORIGIN env var).

Supabase (PostgreSQL) — single shared project
  ├── Admissions tables (owned by the parent portal, read from by the SIS)
  │     ├── ay{YY}_enrolment_applications   ← Profile / Family edits via Records module
  │     ├── ay{YY}_enrolment_status         ← Stage-pipeline edits via Records module
  │     ├── ay{YY}_enrolment_documents      ← File URLs via P-Files; Status via SIS
  │     └── ay{YY}_discount_codes           ← Catalogue CRUD via Records module
  └── SIS-owned tables (Markbook + cross-module infrastructure)
        ├── students, section_students, academic_years, terms, levels, subjects
        ├── subject_configs, sections, teacher_assignments
        ├── grading_sheets, grade_entries, grade_audit_log
        ├── evaluation_writeups, attendance_records, report_card_publications
        ├── grade_change_requests, p_file_revisions, audit_log
        └── supabase.auth.users (shared with parent portal for SSO)
```

## Guiding Constraints

1. Teachers only enter raw scores — the system handles all computation
2. Grading sheets lock on a schedule set by the registrar (Ms. Chandana's instruction)
3. Post-lock edits require email approval from Ms. Chandana/Ms. Tin, then applied by Joann only
4. The system must produce a PDF report card that matches the existing physical format exactly
5. Student roster is sourced from the shared admissions tables — the SIS's Markbook module does not own applicant records; it syncs from admissions into its own `students` table and never writes back to the admissions applications row for roster purposes
6. `studentNumber` is the stable cross-year student identifier (not `enroleeNumber`, which resets each AY)
