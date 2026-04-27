# HFSE SIS — Project Overview

## What This Is

A Student Information System for HFSE International School (Singapore). It centralizes enrollment, grades, documents, and student records in one place, all connected to a single student profile. The system is organized into modules — **Markbook** (grades / report cards), **P-Files** (documents), **Admissions** (applicant pipeline), **SIS** (profiles / family / discount codes / document validation) — that share the same student record as their backbone. Modules are surfaces of one system, not sibling apps, and cross-link through the stable `studentNumber` key so a student's data stays consistent regardless of which surface you're viewing it from.

## Organization Context

- **School:** HFSE International School, Singapore
- **Curriculum:** Aligned with DepEd Order No. 8, s. 2015
- **Levels:** 15 in word form — Youngstarters Little / Junior / Senior Stars (preschool, no grading yet), Primary One–Six, Secondary One–Four, Cambridge Secondary One (Year 8) + Two (Year 9)
- **Terms:** 4 terms per academic year (T1, T2, T3, T4)
- **Class Types:** Global Class and Standard Class (different grading weights per subject)
- **Current AY:** AY2026

## Key People

| Person | Role | Relevance |
|--------|------|-----------|
| Joann Clemente | Registrar / Grading Admin (Vizserve) | Manages all grading sheets, locks/unlocks, applies post-lock edits |
| Ace Guevarra | Developer (Vizserve) | Building this app |
| Kurt Arciga | Developer (Vizserve) | Supporting development |
| Amier Ordonez | IT Lead (HFSE) | Client-side decision maker |
| Ms. Chandana | Principal (HFSE) | Approves grade adjustments and lock schedules |
| Ms. Tin | Academic Head (HFSE) | Co-approves adjustments |

## The Problem Being Solved

The current system is Google Sheets with:
- Formulas that break when teachers copy-paste into locked cells
- Manual setup of new sheets every term (clearing scores, re-linking formulas)
- No audit trail for who changed what
- Grade adjustments managed by email with no tracking
- Report card generation done manually via VLOOKUP across multiple files
- Student names manually maintained per sheet (not synced from admissions)

Beyond grading, student data lived scattered across Directus, Google Drive folders, and Google Sheets with no shared identity. The SIS reunites all of it under one `studentNumber`-keyed profile so anyone looking at a student sees the same record wherever they are in the app.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend + Backend API | Next.js (App Router) |
| Database | Supabase (PostgreSQL) |
| Deployment | Vercel |
| PDF Generation | Python + FastAPI + WeasyPrint |
| PDF Deployment | Render or Railway (free tier) |
| Student Data Source | Supabase admissions DB (existing) |

## High-Level Architecture

```
Browser
  └── Next.js App (Vercel) — the SIS, one deployable with four modules
        ├── /app — React frontend (Markbook, P-Files, Admissions, Records module)
        ├── /api — Next.js API routes (CRUD, grade computation, auth)
        └── Report cards render in-browser and print via the browser's
            native print / save-as-PDF (the Python PDF service from the
            original plan was deferred — see Sprint 6 decision note).

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
