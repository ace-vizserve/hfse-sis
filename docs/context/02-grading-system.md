# Grading System Rules

## Two grading tracks

HFSE runs **two parallel grading tracks** distinguished by `subjects.is_examinable`:

| Track               | Examinable subjects                                               | Non-examinable subjects                 |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| **Input**           | Raw scores (WW, PT, QA)                                           | Letter grade selection                  |
| **Computation**     | PS → WS → Initial → Quarterly                                     | None                                    |
| **Quarterly value** | Integer 0–100 (transmutation)                                     | Letter (`A`/`B`/`C`/`IP`/`UG`/`NA`/`E`) |
| **T4 Final Grade**  | `ROUND((T1×0.2)+(T2×0.2)+(T3×0.2)+(T4×0.4), 2)`                   | Always `"Passed"`                       |
| **General Average** | ✅ Included (examinable Final Grades only)                        | ❌ Excluded entirely                    |
| **Subject Award**   | ✅ Eligible                                                       | ❌ N/A                                  |
| **Storage**         | `grade_entries.{ww_scores, pt_scores, qa_score, quarterly_grade}` | `grade_entries.letter_grade`            |

The `is_examinable` flag (`public.subjects.is_examinable`) is the single source of truth that drives every branch: the grading-sheet UI (`<LetterGradeGrid>` vs WW/PT/QA grid), the report card cell renderer (`cellText` in `<ReportCardDocument>`), the publish-readiness check, the Masterfile column shape, and the General Average / Award computations.

## Grade Components (Track 1 only)

Every examinable subject is graded across three components per term:

| Component                 | Column Codes              | Description                                   |
| ------------------------- | ------------------------- | --------------------------------------------- |
| Written Works (WW)        | W1, W2, W3 (up to W5)     | Worksheets, textbook work, homework, spelling |
| Performance Tasks (PT)    | PT1, PT2, PT3 (up to PT5) | Quizzes, topical tests, class participation   |
| Quarterly Assessment (QA) | Exam                      | End-of-term exam                              |

Each component has a **configurable number of items** (the max score) set per subject per section per term. These are not fixed — teachers may adjust the exam total (e.g., planned 30 items becomes 40 items on exam day). Any such change requires approval from Ms. Chandana/Ms. Tin before the registrar updates it.

## Grading Weights

Weights differ by subject level. Both are confirmed from the actual grading sheets:

### Primary — Math (and most Primary subjects)

| Component            | Weight  |
| -------------------- | ------- |
| Written Works        | **40%** |
| Performance Tasks    | **40%** |
| Quarterly Assessment | **20%** |

### Secondary — Contemporary Arts (and most Secondary subjects)

| Component            | Weight  |
| -------------------- | ------- |
| Written Works        | **30%** |
| Performance Tasks    | **50%** |
| Quarterly Assessment | **20%** |

> **Important:** Weights are stored per subject configuration, not hardcoded. They are constant for the full school year but may change next AY. The system must allow admin configuration of weights per subject per AY.

## Grade Computation Formula

### Step 1 — Percentage Score (PS) per component

```
WW_PS  = (sum of W1..Wn) / WW_total_max × 100
PT_PS  = (sum of PT1..PTn) / PT_total_max × 100
QA_PS  = QA_score / QA_max × 100
```

`*_total_max` is the sum of EVERY slot's max — the workbook's fixed max row (`G10 = (F10/$F$9)*100`). A blank slot adds nothing to the score and its max still counts. Example: WW 2 × 15, only W1 = 14 → 14/30, not 14/15. Until 2026-09-26 the SIS dropped blank slots from the total; migration 177 fixed it and recomputed stored grades.

### Step 2 — Weighted Score (WS) per component

```
WW_WS  = WW_PS  × WW_weight   (e.g., × 0.40 or × 0.30)
PT_WS  = PT_PS  × PT_weight   (e.g., × 0.40 or × 0.50)
QA_WS  = QA_PS  × QA_weight   (always × 0.20)
```

### Step 3 — Initial Grade

```
Initial Grade = WW_WS + PT_WS + QA_WS
```

### Step 4 — Quarterly Grade (Transmutation)

This is the DepEd transmutation formula. Confirmed from the actual Excel formula:

```
=IF(InitialGrade < 60,
    ROUNDDOWN(60 + (15 × InitialGrade / 60), 0),
    ROUNDDOWN(75 + (25 × (InitialGrade - 60) / 40), 0)
)
```

In Python:

```python
import math

def transmute(initial_grade: float) -> int:
    if initial_grade < 60:
        return math.floor(60 + (15 * initial_grade / 60))
    else:
        return math.floor(75 + (25 * (initial_grade - 60) / 40))
```

## Subject Overall Grade (Annual, T4 only)

From the Masterfile formula — terms are weighted unequally. Computed once T4 is locked:

```
Subject Overall = ROUND((T1 × 0.20) + (T2 × 0.20) + (T3 × 0.20) + (T4 × 0.40), 2)
```

Term 4 carries double weight (40%). Terms 1–3 each carry 20%. Result is rounded to **2 decimals**. Implementation: `lib/compute/annual.ts::computeAnnualGrade`.

Appears as the **Final Grade** column on the T4 report card and the **Overall** column on the Masterfile (KD #95). Non-examinable subjects render `"Passed"` in this slot regardless of letter inputs.

## General Average (T4 only)

Cross-subject mean of every examinable Subject Overall — excludes non-examinable subjects entirely (they have no numeric Overall to average):

```
General Average = ROUND(AVERAGE(examinable Subject Overalls), 1)
```

Result is rounded to **1 decimal** per HFSE's literal `=ROUND(AVERAGE(K8,Q8,W8,AC8,AI8),1)` formula on the Masterfile sheet. Implementation: `lib/compute/annual.ts::computeGeneralAverage`.

Appears as the **General Average** row on the T4 report card and the **G.A.** column on the Masterfile. Drives the Overall Academic Award badge.

## Subject Award + Overall Academic Award (KD #95)

Two parallel award badges share one threshold ladder. Both compute via HFSE's literal IFS formula on the Masterfile:

```
input < bronze_min       → "Not eligible for {Subject|Overall} Award"
input ≤ silver_min - 0.1 → "Bronze"
input ≤ gold_min - 0.1   → "Silver"
input ≤ max              → "Gold"
```

| Award                      | Input                 | Per                          | Label when below threshold         |
| -------------------------- | --------------------- | ---------------------------- | ---------------------------------- |
| **Subject Award**          | Subject Overall (2dp) | Examinable subject × student | `"Not eligible for Subject Award"` |
| **Overall Academic Award** | General Average (1dp) | Student                      | `"Not eligible for Overall Award"` |

**Default thresholds** (from HFSE's `=IFS(<88.5,"NE",<=91.4,"Bronze",<=95.4,"Silver",<=99.4,"Gold")`):

| Threshold                  | Default | Editable in                                |
| -------------------------- | ------- | ------------------------------------------ |
| `subject_award_bronze_min` | 88.5    | `/sis/admin/school-config` (school_admin+) |
| `subject_award_silver_min` | 91.5    | (same)                                     |
| `subject_award_gold_min`   | 95.5    | (same)                                     |
| `subject_award_max`        | 100.0   | (same)                                     |

Stored as 4 typed columns on `school_config` (migration 049) with a CHECK enforcing `bronze < silver < gold ≤ max`. Implementation: `lib/compute/awards.ts`.

**Disqualifiers** override the numeric tier:

- Withdrawn students → no badge (blank cell)
- Late enrollees missing examinable data → "Not eligible"
- Any null input → "Not eligible"

The badges render on:

- Masterfile (`/markbook/masterfile`) — Subject Award per examinable subject column + Overall Award column per student
- (Future) T4 report card General Average row badge — currently shows the numeric value only

## Grading Scale

### Examinable Subjects (numeric)

| Descriptor                 | Range    |
| -------------------------- | -------- |
| Outstanding                | 90–100   |
| Very Satisfactory          | 85–89    |
| Satisfactory               | 80–84    |
| Fairly Satisfactory        | 75–79    |
| Below Minimum Expectations | Below 75 |

### Non-Examinable Subjects (letter)

| Code | Meaning                                                          | Range        |
| ---- | ---------------------------------------------------------------- | ------------ |
| A    | Advanced — fully demonstrated the skills required                | 90–100       |
| B    | Proficient — demonstrated some skills required                   | 85–89        |
| C    | Approaching Proficiency — fairly demonstrated the skill required | 80–84        |
| IP   | In Progress                                                      | 79 and below |
| UG   | Ungraded                                                         | —            |
| NA   | Not Applicable                                                   | —            |
| E    | Exempted (**Secondary only**)                                    | —            |

The number ranges are display-only context for the legend. Teachers (or registrar via consolidated form per Phase 2) pick the letter directly — the system never derives a letter from a number.

**Phase 2 open questions** for Joann (KD #95): who enters letters and from where, complete verified letter list (whether `INC` / `CO` are also used at HFSE), whether the SharePoint Consolidated Form integrates or gets replaced.

## Score Entry Rules

- Blank cell = not entered yet; for the grade it scores zero against the full total (as in the workbooks)
- Zero (0) = student took the assessment and scored zero
- The two are stored and shown distinctly; they compute the same
- WW and PT column counts vary per level and subject — configured per grading sheet
- The number of active columns is determined by the length of ww_totals and pt_totals arrays
- Maximum possible: 5 WW, 5 PT — but most sheets use 2–4
- QA is always 1 column
- Max students per section: **50**

## Late Enrollee Handling

If a student enrolled after some assessments were already given:

- Assessments taken before enrollment date are left blank (not zero)
- Proration is handled manually by the registrar (Joann)
- If a student has zero Written Works entries at all, the case is escalated to Ms. Chandana to decide treatment
- The system must flag late enrollees and allow the registrar to mark specific assessments as "not applicable" rather than zero

## Non-Examinable Subjects

The full canonical set per migration 049 (`subjects.is_examinable=false`):

- **Primary:** Music Education, Arts Education, Physical Education, Health Education, Christian Living
- **Secondary:** Contemporary Art, Physical Education and Health, Pastoral Ministry and Personal Development, Co-curricular Activities (CCA)

These subjects do not use the WW/PT/QA formula and have no Subject Overall, Subject Award, or General Average contribution. They render as letter cells per term + `"Passed"` Final Grade on the T4 report card.

**Where letters are entered today**: this is one of the four open Phase-2 questions with Joann. Existing infrastructure (`grade_entries.letter_grade text`, `<LetterGradeGrid>` component) supports per-(student × subject × section × term) letter entry on the grading sheet, but HFSE's actual workflow uses a separate "consolidated form" workbook that VLOOKUPs into the Masterfile. Phase 2 will reconcile.

## Term-over-Term Comparison

The grading sheets show the previous term's grade alongside the current term. If the difference exceeds a configurable threshold (positive or negative), the cell is highlighted for teacher deliberation. The system should support this comparison view.
