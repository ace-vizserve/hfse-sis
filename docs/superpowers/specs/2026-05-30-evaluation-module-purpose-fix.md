# Evaluation Module — Purpose Fix

**Date:** 2026-05-30  
**Status:** Approved  
**Sprint:** 47

---

## Background

The Evaluation module was built with three features:

1. **FCA write-ups** — narrative comments per student per term (T1–T3), printed on the report card
2. **Topics/Checklists + ratings** — teacher-owned rubrics with 1–5 proficiency ratings, labeled "PTC use only"
3. **Conference Notes** — post-PTC parent feedback, registrar-gated

Features 2 and 3 were built speculatively for PTC (Parent-Teacher Conference) integration. Field investigation (Chandana, May 2026) confirmed that PTC uses Ms. JoAnn's offline evaluation form — the SIS is not part of that process. Features 2 and 3 have no users, do not affect grading, and do not appear on the report card.

---

## Module Purpose (Redefined)

> The Evaluation module has one job: the FCA writes a narrative comment per student per term (T1–T3), and it prints on the report card.

Everything else is out of scope for this module.

---

## What Gets Removed

### UI

- **Topics/Checklists tab** on `/evaluation/sections/[sectionId]`
- **Conference Notes tab** on the same page
- **PTC deadline banners** (tentative / urgent / overdue states with deadline warnings)
- **Topic count** from the sections picker cards (`/evaluation/sections`)

### Components (deleted)

- `components/evaluation/checklist-roster-client.tsx`
- `components/evaluation/ptc-roster-client.tsx`
- `components/evaluation/rating-selector.tsx`
- `components/evaluation/checklist-subject-picker.tsx`

### API Routes (→ 410 Gone)

- `POST /api/evaluation/checklist-items`
- `PATCH /api/evaluation/checklist-items/[id]`
- `DELETE /api/evaluation/checklist-items/[id]`
- `PATCH /api/evaluation/checklist-responses`
- `PATCH /api/evaluation/subject-comments`
- `PATCH /api/evaluation/ptc-feedback`
- `POST /api/sow/[id]/sync-to-eval` (SOW → checklist topic seed; no longer applicable)

### Lib functions removed

From `lib/evaluation/checklist.ts`:

- `listChecklistItems`
- `listChecklistItemsWithCreator`
- `getResponsesBySectionTerm`
- `getSubjectCommentsBySectionTerm`
- `getPtcFeedbackBySectionTerm`
- `listTeacherSubjectsForSection`

From `lib/evaluation/queries.ts`:

- `getChecklistTopicCountByTerm`

### Server-side loading removed from section roster page

- PTC event queries (`getPtcEventForSection` / calendar_events lookup)
- Checklist data (`commentsForClient`, `ratingsForClient`, `checklistItemsForClient`)
- Subject list for teacher scoping
- `canAccessPtc` gate and associated logic

### No DB migration

`evaluation_checklist_items`, `evaluation_checklist_responses`, `evaluation_subject_comments`, `evaluation_ptc_feedback` — tables stay in Postgres, dormant. No data is deleted.

---

## What Stays

| Item                                    | Reason                                             |
| --------------------------------------- | -------------------------------------------------- |
| Write-ups tab (sole tab on roster page) | FCA narrative → T1–T3 report card                  |
| `writeup-roster-client.tsx`             | Unchanged                                          |
| Virtue theme display + warning          | Virtue theme IS in the report card parenthetical   |
| Sections picker — write-up progress     | Simplified; topic count removed                    |
| Audit log                               | Unchanged                                          |
| Compare view                            | Unchanged                                          |
| Role gates                              | FCA writes; registrar/school_admin/superadmin view |
| `/api/evaluation/writeups`              | Unchanged                                          |
| `/api/evaluation/terms/[termId]/config` | Unchanged (virtue theme)                           |

### Role access after fix

- **form_adviser** — sole writer of write-ups for their section; only tab is Write-ups
- **subject_teacher** — loses access to the Checklists tab; no remaining role in this module
- **registrar / school_admin / superadmin** — read-only view of write-ups; Conference Notes tab gone

---

## Sections Picker (`/evaluation/sections`) Simplification

- Remove topic count from section cards
- Remove `getChecklistTopicCountByTerm` call
- Cards show: write-up progress (% submitted), active student count, level — same as today minus topic count
- Virtue theme warning banner stays (it gates report card quality)

---

## Subject Teachers

Subject teachers currently land on `/evaluation/sections` and see sections they teach in. After this fix, the Checklists tab — the only thing subject teachers could do — is gone. Subject teachers have no remaining role in the Evaluation module.

**Decision:** Subject teachers visiting `/evaluation/sections` will see sections they advise only (form adviser sections). If they have no adviser role, the page is empty with an appropriate empty state. The `listSubjectTeacherSectionIds` query and subject-teacher section card variant are removed from the picker.

---

## Future PTC Surface (Plug-and-Play)

When HFSE is ready to digitize PTC, it becomes a **completely separate surface**:

- New route: `/evaluation/ptc/[sectionId]` (or a standalone module)
- New sidebar entry
- Reads from the existing dormant DB tables (already intact)
- Zero changes to write-up code or report card flow
- Can be toggled on/off without touching the Evaluation module core

The FCA write-up code never knows PTC exists.

---

## Out of Scope

- Changes to the write-up entry surface itself (FCA flow appears to be working well; revisit after teacher testing)
- PTC surface implementation (future sprint, pending HFSE readiness)
- Dropping DB tables (no upside; keep for future PTC use)
