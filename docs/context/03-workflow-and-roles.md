# Workflow & Roles

## User Roles

| Role | Who | Permissions |
|------|-----|-------------|
| `teacher` | Subject teachers | Enter/edit scores for their assigned subject + section + term (while unlocked) |
| `registrar` | Joann Clemente | Lock/unlock sheets, apply post-lock edits, manage student roster, generate report cards |
| `admin` | Ms. Chandana, Ms. Tin | Approve grade adjustment requests, set lock schedules |
| `superadmin` | Ace/Kurt (Vizserve) | Full system access, configuration, user management |

## End-to-End Grading Workflow

### Phase 1 — Setup (Admin / Registrar)
1. Admin configures the term (AY, term number, date range)
2. Admin configures subjects per level — weights (WW%/PT%/QA%), max score slots
3. Registrar syncs student roster from Supabase admissions DB
4. Registrar creates grading sheets per subject per section per term
5. Grading sheets are **unlocked** — teachers can now enter scores

### Phase 2 — Score Entry (Teachers)
1. Teacher logs in and sees their assigned subject(s) and section(s)
2. Teacher enters raw scores: W1, W2... PT1, PT2... QA
3. System auto-computes Initial Grade and Quarterly Grade in real time
4. Teacher can see previous term's grade for comparison
5. If a score entry exceeds the configured max, the system warns the teacher

### Phase 3 — Lock (Registrar, per Ms. Chandana's schedule)
1. Registrar receives lock deadline from Ms. Chandana
2. Registrar locks the grading sheet — teachers can no longer edit
3. Any blank cells at lock time remain blank (registrar reviews and fills if needed)
4. Lock timestamp and who locked it are recorded

### Phase 4 — Post-Lock Adjustments (Registrar only)
1. Teacher identifies an error or missing score after lock
2. Teacher emails the registrar with the correction, CC'd to Ms. Chandana/Ms. Tin
3. Ms. Chandana or Ms. Tin approves via email reply
4. Registrar applies the edit directly in the system
5. All post-lock edits are logged with: who changed it, what changed, timestamp, approval reference

### Phase 5 — Report Card Generation (Registrar)
1. After all sheets for a term are locked and verified, registrar generates report cards
2. System aggregates: quarterly grades per subject + attendance + teacher comments
3. Registrar previews the report card per student
4. Registrar exports PDF — either one student at a time or batch by section
5. PDFs are printed and distributed

## Score Adjustment Rules

| Scenario | Who Handles | Process |
|----------|-------------|---------|
| Exam total changes (e.g., 30 → 40 items) | Registrar | Requires approval from Ms. Chandana/Ms. Tin first |
| Teacher forgot to enter a score | Registrar | Email approval required post-lock |
| Parent complaint leads to grade review | HFSE (Ms. Chandana's team) | Handled outside the system; registrar applies final adjusted grade |
| Late enrollee with missing assessments | Registrar | Registrar marks assessments as N/A; proration handled manually |

## Locking Rules

- Only the registrar can lock and unlock sheets
- Lock is per grading sheet (subject + section + term)
- A locked sheet shows as read-only to teachers
- Post-lock edits by the registrar are tracked in an audit log
- Unlock is possible (e.g., if a mistake is found before report cards are generated) but must be intentional

## Student Roster Management

- **Source of truth:** Supabase admissions DB (`ay{YY}_enrolment_applications` + `ay{YY}_enrolment_status`)
- **Sync trigger:** On-demand by registrar (not automatic)
- **Sync query filters:** `classSection IS NOT NULL` AND `applicationStatus NOT IN ('Cancelled', 'Withdrawn')`
- **Stable ID:** `studentNumber` (carries over across AYs — do NOT use `enroleeNumber`)
- **Index numbers:** Fixed per section per AY. New students appended at the bottom (not alphabetically inserted). Withdrawn students are greyed out but remain in the roster with their index preserved.
- **Name format in system:** Stored as separate `lastName`, `firstName`, `middleName` fields. Display as "LASTNAME, First Middle" for consistency with existing sheets.

## Sections per Level (AY2026)

### Primary
| Level | Sections |
|-------|---------|
| Primary One | Patience, Obedience |
| Primary Two | Honesty, Humility |
| Primary Three | Courtesy, Courageous, Responsibility |
| Primary Four | Diligence, Trust |
| Primary Five | Commitment, Perseverance, Tenacity |
| Primary Six | Grit, Loyalty |

### Secondary
| Level | Sections |
|-------|---------|
| Secondary One | Discipline 1, Discipline 2 |
| Secondary Two | Integrity 1, Integrity 2 |
| Secondary Three | Consistency |
| Secondary Four | Excellence |

> **Other levels in `levels` (no Markbook surface yet):** Youngstarters Little / Junior / Senior Stars (preschool tier, deferred until the YS report-card template is designed) and Cambridge Secondary One (Year 8) + Two (Year 9). Sections per AY for these levels are seeded by SIS Admin → AY Setup as they come online.

> Note: "DO NOT USE" sheets in the Excel files indicate deprecated section tabs. Only the non-prefixed sheets are active.
