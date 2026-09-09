# scripts/gen-implementation-gantt.py
#
# Builds HFSE-SIS-Implementation-Gantt-2026.xlsx at the repo root.
#
#   Sheet "Gantt Chart"     Plan vs Actual vs Slip table + a weekly bar grid,
#                           in the shape of the GoHighLevel implementation Gantt
#                           the client asked us to match.
#   Sheet "Assumptions"     Source of dates / key assumptions / open questions,
#                           each with a provenance classification.
#   Sheet "Phase 2 Backlog" The 11 ClickUp candidates, board status vs what is
#                           actually in production, with migration numbers as
#                           evidence.
#
# Every derived number is a REAL CELL FORMULA, not a baked value: Days, Slip,
# the phase-level MIN/MAX/AVERAGE rollups and the whole KPI strip. Bars are
# conditional formatting driven by the same date cells, so moving a date on the
# table moves the bar. openpyxl does not evaluate formulas, so the workbook is
# marked fullCalcOnLoad and scripts/verify-implementation-gantt.py recomputes
# the same arithmetic independently for checking.
#
# Why Python: the repo's `xlsx` package is the SheetJS community build and can
# write neither cell fills nor conditional formatting. openpyxl does both.
# Same reason as scripts/gen-gantt.py.
#
# READ-ONLY with respect to the database AND to the proposal workbook. The
# baseline dates below are transcribed from the proposal's "Scope of Work" tab
# and carried here as literals, so this script opens nothing and writes exactly
# one file.
#
# Run:
#   python scripts/gen-implementation-gantt.py

import sys
from datetime import date, timedelta
from pathlib import Path

try:
    from openpyxl import Workbook
    from openpyxl.formatting.rule import FormulaRule
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation
except ImportError:
    sys.stderr.write("Needs openpyxl:  pip install openpyxl\n")
    sys.exit(1)

OUT = "HFSE-SIS-Implementation-Gantt-2026.xlsx"

# ---------------------------------------------------------------- palette
# lifted from scripts/gen-gantt.py, which lifted it from the school's own sheet
NAVY = "12284C"
BAND = "2E75B6"
PHASE = "D9E2F3"
CYAN = "00B0F0"
WHITE = "FFFFFF"
GREEN = "00B050"
AMBER = "FFC000"
SKY = "41A5EE"
GREY = "A6A6A6"
RED = "C00000"
ORANGE = "ED7D31"
INK = "1F3864"
LINE = "BFBFBF"
KPIBG = "EEF3FA"

D = date
STATUS_DATE = D(2026, 9, 1)
CONTRACT_END = D(2026, 6, 26)          # Scope of Work tab, deliverable 14
GRID_START, GRID_END = D(2026, 3, 16), D(2026, 12, 28)   # Mondays

DATE_FMT = "d-mmm"
DAYS_FMT = "0"
SLIP_FMT = '+0;-0;""'          # on time shows nothing; only variance is visible
# plain, NOT '0"%";;""' - a real 0% must read "0%". Blank is reserved for
# "there is no completion measure for this row", which is a different fact.
PCT_FMT = '0"%"'

# ------------------------------------------------- contracted baseline (SOW)
# HFSE-SIS-Proposal-May2026-v3 (3).xlsx -> "Scope of Work" tab, column E.
# Deliverables 3..11 all carry the same contracted window.
B_KICKOFF = (D(2026, 3, 17), D(2026, 3, 22))
B_DISCOVERY = (D(2026, 3, 23), D(2026, 3, 29))
B_BUILD = (D(2026, 3, 30), D(2026, 5, 15))
B_REVISIONS = (D(2026, 5, 18), D(2026, 6, 5))
B_FINAL = (D(2026, 6, 15), D(2026, 6, 19))
B_TRAINING = (D(2026, 6, 22), D(2026, 6, 26))
B_SUPPORT = (D(2026, 6, 29), D(2026, 7, 31))
# Not a SOW line. The Term 3 parallel-run window agreed with the school.
B_PARALLEL = (D(2026, 6, 29), D(2026, 9, 4))

NONE = (None, None)

VE = "VizBytes Engineering"
AA = "Amier / Ace"
ACE = "Ace"
HFSE = "HFSE"

# (id, activity, owner, status, in_sow, plan, actual, pct, note)
# pct None means "no completion measure exists" and is left blank deliberately.
PHASES = [
 ("PHASE 1: KICKOFF", [
  ("1.1", "Project Kickoff & Scope Confirmation", AA, "Completed", "Yes",
   B_KICKOFF, (D(2026, 3, 17), D(2026, 3, 22)), 100,
   "Charter, RACI, comms cadence. Delivered exactly to the contracted window."),
 ]),
 ("PHASE 2: DISCOVERY", [
  ("2.1", "User Research & Requirements Gathering", AA, "Completed", "Yes",
   B_DISCOVERY, (D(2026, 3, 23), D(2026, 3, 29)), 100,
   "Interviews with the grading coordinator. Delivered to plan."),
 ]),
 ("PHASE 3: FOUNDATION", [
  ("3.1", "SIS Admin Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 14), D(2026, 7, 14)), 100,
   "Year setup, roles, calendar, subjects. The 14 Apr start is the repository's "
   "first commit, to the day."),
 ]),
 ("PHASE 4: CORE BUILD", [
  ("4.1", "Markbook (Grading) Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 14), D(2026, 6, 6)), 100,
   "Server-side computation, audit log, Masterfile export."),
  ("4.2", "Records Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 17), D(2026, 6, 12)), 100,
   "Student profile, family, enrolment."),
  ("4.3", "Admissions Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 17), D(2026, 8, 5)), 100,
   "Application form, document workflow, 9-stage pipeline."),
  ("4.4", "P-Files Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 17), D(2026, 7, 30)), 100,
   "Document repository with versioning."),
 ]),
 ("PHASE 5: INTEGRATION", [
  ("5.1", "Attendance Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 21), D(2026, 6, 26)), 100,
   "Daily register feeding the report card."),
  ("5.2", "Student Evaluation Module", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 22), D(2026, 5, 30)), 100,
   "Virtue theme and adviser write-ups."),
  ("5.3", "Cross-Module Integration & QA", VE, "Completed", "Yes",
   B_BUILD, (D(2026, 4, 14), D(2026, 8, 28)), 100,
   "Continuous, not a fixed window. 3,152 automated checks green."),
 ]),
 ("PHASE 6: DEMO PREP", [
  ("6.1", "Demo Environment & Test Data", ACE, "Completed", "Yes",
   B_BUILD, (D(2026, 5, 5), D(2026, 7, 30)), 100,
   "Retired 30 Jul once real school data was loaded."),
  ("6.2", "Executive Demo Presentation", AA, "Completed", "Yes",
   B_BUILD, (D(2026, 5, 14), D(2026, 5, 18)), 100,
   "Deck and walkthrough script. The SOW covers 6.1 and 6.2 as a single deliverable."),
 ]),
 ("PHASE 7: DEVELOPMENT OF REVISIONS", [
  ("7.1", "Post-Demo Revisions & Refinement", VE, "Completed", "Yes",
   B_REVISIONS, (D(2026, 5, 18), D(2026, 8, 28)), 100,
   "Started on the contracted day and ran to 28 Aug. Contracted to end 5 Jun."),
  ("7.2", "Historical Data Migration", VE, "Completed", "Add-on",
   NONE, (D(2026, 7, 9), D(2026, 7, 20)), 100,
   "AY2025 T1-T3 and AY2026 T1-T2 loaded. AY2025 T4 permanently blocked, no source "
   "workbooks. The SOW defers migration to joint scoping, so this was never a priced "
   "deliverable and has no baseline to slip against."),
 ]),
 ("PHASE 7B: EXTENDED BUILD  (delivered, not in the signed Scope of Work)", [
  ("7b.1", "Platform & Workflow Extensions", VE, "Completed", "Add-on",
   NONE, (D(2026, 4, 15), D(2026, 7, 31)), 100,
   "Change requests, dashboards, test pipeline, calendar, insights, year setup, "
   "grade levels, subject setup, permissions."),
  ("7b.2", "Parent Portal", VE, "Completed", "Add-on",
   NONE, (D(2026, 4, 29), D(2026, 8, 29)), 100,
   "Sign-in, report card access, publication emails, parent-filed declarations."),
  ("7b.3", "Classroom Module & Teacher Tools", VE, "Completed", "Add-on",
   NONE, (D(2026, 7, 28), D(2026, 8, 24)), 100,
   "Per-class workspace: health, timeline, student details, at-risk list, discipline filing."),
  ("7b.4", "Post-Training Enhancements", VE, "Completed", "Add-on",
   NONE, (D(2026, 8, 3), D(2026, 8, 17)), 100,
   "Excused-absence reason, House colours, whole-year trend, save/confirm across every screen."),
 ]),
 ("PHASE 8: FINAL PRESENTATION", [
  ("8.1", "Final System Presentation to Leadership", AA, "Completed", "Yes",
   B_FINAL, (D(2026, 7, 15), D(2026, 7, 19)), 100,
   "Go-live readiness review. Delivered a month after the contracted window."),
 ]),
 ("PHASE 9: TRAINING", [
  ("9.1", "Travel - Manila to Singapore", ACE, "Cancelled", "Yes",
   B_TRAINING, NONE, None,
   "Contracted as onsite training in Singapore. Cancelled; training moved to virtual. "
   "A change of delivery mode, not only of dates."),
  ("9.2", "Virtual Faculty / Teacher Training - Session 1", ACE, "Completed", "Yes",
   B_TRAINING, (D(2026, 7, 31), D(2026, 7, 31)), 100,
   "Markbook, Attendance, Evaluation, Classroom. 11 feedback items raised."),
  ("9.3", "Virtual Admin & Registrar Training - Session 1", ACE, "Completed", "Yes",
   B_TRAINING, (D(2026, 8, 13), D(2026, 8, 13)), 100,
   "SIS Admin, Records, P-Files, Admissions. 13 action items raised."),
  ("9.4", "Virtual Power Users / Champions Training", ACE, "Not Started", "Yes",
   B_TRAINING, (D(2026, 9, 21), D(2026, 9, 21)), 0,
   "Train-the-trainer. The original 19 Aug date passed. The date shown is an ESTIMATE "
   "placed in the first full week of Term 4 and needs confirming."),
  ("9.5", "Wrap-up & Handover", ACE, "Not Started", "Yes",
   B_TRAINING, (D(2026, 9, 25), D(2026, 9, 25)), 0,
   "Training materials handover. No evidence the 30 Aug attempt took place. "
   "The date shown is an ESTIMATE."),
 ]),
 ("PHASE 10: PHASE 2 SCOPE CONSOLIDATION  (requirements intake - the build itself follows the transition)", [
  ("10.0", "Consolidation of Additional Features for Phase 2", AA, "In Progress", "Add-on",
   NONE, (D(2026, 8, 3), None), 45,
   "11 candidate features on the ClickUp board. 5 already built ahead of Phase 2, "
   "6 awaiting school input. Per cent is 5 of 11."),
  ("10.1", "Student Disciplinary Records", VE, "Completed", "Add-on",
   NONE, (D(2026, 8, 18), D(2026, 8, 21)), 100,
   "Built ahead of Phase 2. Evidence: migrations 120-122. Browser-checked 24 Aug."),
  ("10.2", "House Colour & House-Points Tracking", VE, "Completed", "Add-on",
   NONE, (D(2026, 8, 3), D(2026, 8, 6)), 100,
   "Built ahead of Phase 2. Evidence: migrations 110-111 and lib/sis/houses.ts."),
  ("10.3", "Relief Teacher Covers", VE, "Completed", "Add-on",
   NONE, (D(2026, 8, 12), D(2026, 8, 25)), 100,
   "Built ahead of Phase 2. Evidence: migration 123. Browser-verified 25 Aug."),
  ("10.4", "MC & Travel Declaration Upload", VE, "Completed", "Add-on",
   NONE, (D(2026, 8, 17), D(2026, 8, 31)), 100,
   "Built ahead of Phase 2, end to end on both the parent and the staff side. "
   "Evidence: migrations 125-131 and 134."),
  ("10.5", "Expand P-Files Document List", VE, "Completed", "Add-on",
   NONE, (D(2026, 8, 25), D(2026, 9, 1)), 100,
   "Built ahead of Phase 2. Evidence: migrations 135-136."),
  # The blocked six carry their ClickUp board due date as the plan window, so
  # they draw a bar and their Slip counts how long they have been stuck. That
  # date is a board target, not a contracted one - every note says so.
  ("10.6", "Awards - Certificates & Participation", VE, "Blocked", "Add-on",
   (D(2026, 8, 12), D(2026, 8, 12)), NONE, 0,
   "Board target 12 Aug, not a contracted date. Extends the existing Bronze/Silver/Gold "
   "computation; a different feature, not the same one. Awaiting Ms Chandana / Ms Tin."),
  ("10.7", "Supplies & Book Tracking", VE, "Blocked", "Add-on",
   (D(2026, 8, 13), D(2026, 8, 13)), NONE, 0,
   "Board target 13 Aug, not a contracted date. Awaiting the per-level supplies and books list."),
  ("10.8", "Scheme of Work", VE, "Blocked", "Add-on",
   (D(2026, 8, 21), D(2026, 8, 21)), NONE, 0,
   "Board target 21 Aug, not a contracted date. Reopened 21 Aug by Ms Christina. Teacher "
   "dashboard for lesson planning, scheme of work and delivery."),
  ("10.9", "Transcript of Records (TOR)", VE, "Blocked", "Add-on",
   (D(2026, 8, 21), D(2026, 8, 21)), NONE, 0,
   "Board target 21 Aug, not a contracted date. Awaiting Ms Wynne's TOR template "
   "(temporary and permanent)."),
  ("10.10", "AEB Grade Change Request Flow", VE, "Blocked", "Add-on",
   (D(2026, 8, 27), D(2026, 8, 27)), NONE, 0,
   "Board target 27 Aug, not a contracted date. Awaiting Ms Chandana's AEB form and "
   "membership list."),
  ("10.11", "Parent Portal - Event Registration Tracking", VE, "Blocked", "Add-on",
   (D(2026, 8, 13), D(2026, 8, 13)), NONE, 0,
   "Board target 13 Aug, not a contracted date. Requested by Ms Apple. Parents to view "
   "events they have previously registered for."),
 ]),
 ("PHASE 11: POST-LAUNCH & TRANSITION", [
  ("11.1", "System Implementation - Parallel Run with Current System", HFSE, "Not Started", "No",
   B_PARALLEL, NONE, 0,
   "Agreed to run through Term 3, 29 Jun - 4 Sep 2026. No parallel-run activity has been "
   "recorded in that window; it lapses in 3 days. Client-led, and not a priced SOW deliverable."),
  ("11.2", "System Implementation - Parallel Run (re-planned, Term 4)", HFSE, "Not Started", "No",
   NONE, (D(2026, 9, 14), D(2026, 11, 19)), 0,
   "ESTIMATE. Term 4 is the school's next available window. There is no term at all "
   "between 5 and 13 Sep, so nothing can run in that gap."),
  ("11.3", "Platform Stabilisation & Monthly Support", ACE, "In Progress", "Yes",
   B_SUPPORT, (D(2026, 8, 25), D(2026, 12, 18)), None,
   "Contracted as a one-month hypercare ending 31 Jul. Running since 25 Aug alongside a "
   "parallel run that has not started. The end date is an ESTIMATE and there is no "
   "completion measure, so per cent is deliberately blank."),
  ("11.4", "System Implementation - Full Transition", HFSE, "Client-Led (TBC)", "No",
   NONE, NONE, None,
   "No go-live or transition date exists anywhere on the project. Follows a clean parallel "
   "run. Owned by HFSE leadership - no bar can be drawn until a date is set."),
  ("11.5", "Phase 2 Build - begins after the full transition", VE, "Client-Led (TBC)", "No",
   NONE, NONE, None,
   "The consolidated features from Phase 10. Cannot be scheduled until the transition "
   "date is agreed."),
 ]),
]

STATUSES = ["Completed", "In Progress", "Blocked", "Not Started",
            "Client-Led (TBC)", "Cancelled"]
SOW_VALUES = ["Yes", "No", "Add-on"]

MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
       "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

# ---------------------------------------------------------------- geometry
COL_MARK = 1                     # hidden A: PHASE / TASK, so CF can tell them apart
COL_ID, COL_ACT, COL_OWNER, COL_STATUS, COL_SOW = 2, 3, 4, 5, 6
COL_PS, COL_PE, COL_AS, COL_AE = 7, 8, 9, 10
COL_DAYS, COL_SLIP, COL_PCT = 11, 12, 13
COL_GAP = 14                     # narrow spacer between the table and the grid
GRID_FIRST = 15                  # O
ROW_MONTH, ROW_WEEK = 7, 8
ROW_FIRST = 9


def weeks():
    out, cur = [], GRID_START
    while cur <= GRID_END:
        out.append(cur)
        cur += timedelta(days=7)
    return out


WEEKS = weeks()
GRID_LAST = GRID_FIRST + len(WEEKS) - 1
NOTE_COL = GRID_LAST + 2         # notes park to the right of the grid


def thin(c=LINE):
    return Side(style="thin", color=c)


def box(c=LINE):
    return Border(left=thin(c), right=thin(c), top=thin(c), bottom=thin(c))


def solid(c):
    return PatternFill("solid", fgColor=c)


def put(ws, r, c, v, *, fill=None, font=None, align=None, fmt=None, border=None):
    cell = ws.cell(row=r, column=c, value=v)
    if fill:
        cell.fill = solid(fill)
    if font:
        cell.font = font
    if align:
        cell.alignment = align
    if fmt:
        cell.number_format = fmt
    if border:
        cell.border = border
    return cell


CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)


def build_gantt(ws):
    ws.column_dimensions["A"].hidden = True
    widths = {COL_ID: 7, COL_ACT: 52, COL_OWNER: 20, COL_STATUS: 15, COL_SOW: 9,
              COL_PS: 10, COL_PE: 10, COL_AS: 11, COL_AE: 11,
              COL_DAYS: 7, COL_SLIP: 8, COL_PCT: 8, COL_GAP: 1.5}
    for c, w in widths.items():
        ws.column_dimensions[get_column_letter(c)].width = w
    for i in range(len(WEEKS)):
        ws.column_dimensions[get_column_letter(GRID_FIRST + i)].width = 2.4
    ws.column_dimensions[get_column_letter(NOTE_COL)].width = 78

    def band(r, colour, height=None):
        for c in range(COL_ID, GRID_LAST + 1):
            ws.cell(row=r, column=c).fill = solid(colour)
        if height:
            ws.row_dimensions[r].height = height

    # ---- title
    ws.merge_cells(start_row=2, start_column=COL_ID, end_row=2, end_column=GRID_LAST)
    put(ws, 2, COL_ID, "HFSE INTERNATIONAL SCHOOL  |  STUDENT INFORMATION SYSTEM - IMPLEMENTATION GANTT",
        font=Font(name="Calibri", size=16, bold=True, color=CYAN), align=CENTER)
    band(2, NAVY, 30)

    ws.merge_cells(start_row=3, start_column=COL_ID, end_row=3, end_column=GRID_LAST)
    put(ws, 3, COL_ID,
        "VizServe Inc. - VizBytes Division   |   Ref: VZ-HFSE-SIS-2026-05-001   |   "
        "Contracted 17 Mar - 26 Jun 2026 (~14 weeks / 102 days)   |   "
        "Plan columns are the signed Scope of Work; see the Assumptions tab for every source",
        font=Font(name="Calibri", size=10, bold=True, color=WHITE), align=CENTER)
    band(3, NAVY, 20)

    # ---- KPI strip
    kpis = [
        ("Status date", STATUS_DATE, DATE_FMT),
        ("% complete - contracted scope", None, PCT_FMT),
        ("% complete - all activities", None, PCT_FMT),
        ("Contracted end (SOW)", CONTRACT_END, DATE_FMT),
        ("Programme end (actual + forecast)", None, DATE_FMT),
        ("Slip vs original", None, '0" days"'),
        ("Open items", None, "0"),
    ]
    kpi_cols = [COL_ACT, COL_OWNER + 1, COL_PS + 1, COL_AS + 1, COL_PCT,
                COL_PCT + 3, COL_PCT + 6]
    for (label, value, fmt), col in zip(kpis, kpi_cols):
        ws.merge_cells(start_row=4, start_column=col, end_row=4, end_column=col + 1)
        put(ws, 4, col, label, fill=KPIBG,
            font=Font(name="Calibri", size=8, bold=True, color=INK), align=CENTER)
        ws.merge_cells(start_row=5, start_column=col, end_row=5, end_column=col + 1)
        put(ws, 5, col, value, fill=KPIBG, fmt=fmt,
            font=Font(name="Calibri", size=12, bold=True, color=NAVY), align=CENTER)
    ws.row_dimensions[4].height = 14
    ws.row_dimensions[5].height = 20
    ws.row_dimensions[6].height = 6

    # ---- header
    heads = [(COL_ID, "ID"), (COL_ACT, "Activity"), (COL_OWNER, "Owner"),
             (COL_STATUS, "Status"), (COL_SOW, "In SOW"),
             (COL_PS, "Plan Start"), (COL_PE, "Plan End"),
             (COL_AS, "Actual /\nRevised Start"), (COL_AE, "Actual /\nRevised End"),
             (COL_DAYS, "Days"), (COL_SLIP, "Slip (d)"), (COL_PCT, "% Done")]
    for col, label in heads:
        ws.merge_cells(start_row=ROW_MONTH, start_column=col,
                       end_row=ROW_WEEK, end_column=col)
        put(ws, ROW_MONTH, col, label, fill=NAVY,
            font=Font(name="Calibri", size=9, bold=True, color=WHITE),
            align=CENTER, border=box(WHITE))
        ws.cell(row=ROW_WEEK, column=col).border = box(WHITE)
    put(ws, ROW_MONTH, NOTE_COL, "Notes / evidence", fill=NAVY,
        font=Font(name="Calibri", size=9, bold=True, color=WHITE), align=CENTER)

    # month bands across the grid, then the real week-start dates
    run, key = GRID_FIRST, (WEEKS[0].year, WEEKS[0].month)
    for i in range(len(WEEKS) + 1):
        k = (WEEKS[i].year, WEEKS[i].month) if i < len(WEEKS) else None
        if k != key:
            end = GRID_FIRST + i - 1
            for c in range(run, end + 1):
                put(ws, ROW_MONTH, c, None, fill=BAND, border=box(WHITE))
            put(ws, ROW_MONTH, run, MON[key[1] - 1], fill=BAND,
                font=Font(name="Calibri", size=8, bold=True, color=WHITE), align=CENTER)
            ws.merge_cells(start_row=ROW_MONTH, start_column=run,
                           end_row=ROW_MONTH, end_column=end)
            run, key = GRID_FIRST + i, k
    for i, w in enumerate(WEEKS):
        put(ws, ROW_WEEK, GRID_FIRST + i, w, fill=NAVY, fmt="d",
            font=Font(name="Calibri", size=7, color=WHITE), align=CENTER)
    ws.row_dimensions[ROW_MONTH].height = 15
    ws.row_dimensions[ROW_WEEK].height = 15

    # ---- body
    r = ROW_FIRST
    task_rows, phase_rows = [], []
    for phase_name, tasks in PHASES:
        head_row = r
        for c in range(COL_MARK, GRID_LAST + 1):
            ws.cell(row=r, column=c).fill = solid(PHASE)
        put(ws, r, COL_MARK, "PHASE")
        put(ws, r, COL_ACT, phase_name, fill=PHASE,
            font=Font(name="Calibri", size=9, bold=True, color=INK), align=LEFT)
        ws.row_dimensions[r].height = 17
        r += 1
        first_child = r

        for (tid, act, owner, status, sow, plan, actual, pct, note) in tasks:
            put(ws, r, COL_MARK, "TASK")
            put(ws, r, COL_ID, tid, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=8, color="808080"), align=CENTER)
            put(ws, r, COL_ACT, act, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=9, color=INK), align=LEFT)
            put(ws, r, COL_OWNER, owner, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=8), align=CENTER)
            put(ws, r, COL_STATUS, status, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=8, bold=True), align=CENTER)
            put(ws, r, COL_SOW, sow, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=8), align=CENTER)
            for col, value in ((COL_PS, plan[0]), (COL_PE, plan[1]),
                               (COL_AS, actual[0]), (COL_AE, actual[1])):
                put(ws, r, col, value, fill=WHITE, border=box(), fmt=DATE_FMT,
                    font=Font(name="Calibri", size=8), align=CENTER)
            write_derived(ws, r)
            put(ws, r, COL_PCT, pct, fill=WHITE, border=box(), fmt=PCT_FMT,
                font=Font(name="Calibri", size=8, bold=True), align=CENTER)
            for c in range(GRID_FIRST, GRID_LAST + 1):
                ws.cell(row=r, column=c).fill = solid(WHITE)
                ws.cell(row=r, column=c).border = box("E8E8E8")
            put(ws, r, NOTE_COL, note,
                font=Font(name="Calibri", size=8, color="404040"), align=LEFT)
            ws.row_dimensions[r].height = 22
            task_rows.append(r)
            r += 1

        last_child = r - 1
        phase_rows.append(head_row)
        write_phase_rollup(ws, head_row, first_child, last_child)

    last_row = r - 1
    write_kpis(ws, kpi_cols, last_row)
    add_bars(ws, last_row)
    add_validation(ws, last_row)
    legend_row = add_legend(ws, last_row + 2)

    ws.freeze_panes = ws.cell(row=ROW_FIRST, column=GRID_FIRST)
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return task_rows, phase_rows, last_row, legend_row


def write_derived(ws, r):
    """Days and Slip. Identical on task and phase rows so they cannot drift."""
    ps, pe = f"$G{r}", f"$H{r}"
    as_, ae = f"$I{r}", f"$J{r}"
    # actual window if we have one; a running row reaches the status date;
    # otherwise fall back to the contracted window.
    put(ws, r, COL_DAYS,
        f'=IF({as_}<>"",IF({ae}<>"",{ae}-{as_}+1,$C$5-{as_}+1),'
        f'IF(AND({ps}<>"",{pe}<>""),{pe}-{ps}+1,""))',
        fill=WHITE, border=box(), fmt=DAYS_FMT,
        font=Font(name="Calibri", size=8), align=CENTER)
    # no baseline means nothing to slip against, so it stays blank
    put(ws, r, COL_SLIP,
        f'=IF({pe}="","",IF({ae}<>"",{ae}-{pe},'
        f'IF(AND($E{r}<>"Completed",$E{r}<>"Cancelled",$C$5>{pe}),$C$5-{pe},"")))',
        fill=WHITE, border=box(), fmt=SLIP_FMT,
        font=Font(name="Calibri", size=8, bold=True, color=RED), align=CENTER)


def write_phase_rollup(ws, row, first, last):
    """MIN/MAX over the children. Both return 0 on an all-blank range, so both
    are guarded by COUNT."""
    if last < first:
        return
    for col, fn in ((COL_PS, "MIN"), (COL_PE, "MAX"),
                    (COL_AS, "MIN"), (COL_AE, "MAX")):
        L = get_column_letter(col)
        put(ws, row, col,
            f'=IF(COUNT({L}{first}:{L}{last})=0,"",{fn}({L}{first}:{L}{last}))',
            fill=PHASE, fmt=DATE_FMT,
            font=Font(name="Calibri", size=8, bold=True, color=INK), align=CENTER)
    write_derived(ws, row)
    for col in (COL_DAYS, COL_SLIP):
        ws.cell(row=row, column=col).fill = solid(PHASE)
    put(ws, row, COL_PCT,
        f'=IFERROR(ROUND(AVERAGE(M{first}:M{last}),0),"")',
        fill=PHASE, fmt=PCT_FMT,
        font=Font(name="Calibri", size=8, bold=True, color=INK), align=CENTER)


def write_kpis(ws, cols, last_row):
    lo, hi = ROW_FIRST, last_row
    formulas = [
        None,                                                     # status date is a literal
        f'=IFERROR(ROUND(AVERAGEIFS($M${lo}:$M${hi},$A${lo}:$A${hi},"TASK",'
        f'$F${lo}:$F${hi},"Yes"),0),"")',
        f'=IFERROR(ROUND(AVERAGEIF($A${lo}:$A${hi},"TASK",$M${lo}:$M${hi}),0),"")',
        None,                                                     # contracted end is a literal
        f'=MAX($H${lo}:$H${hi},$J${lo}:$J${hi})',
        None,                                                     # filled below, needs its neighbours
        f'=COUNTIFS($A${lo}:$A${hi},"TASK",$E${lo}:$E${hi},"<>Completed",'
        f'$E${lo}:$E${hi},"<>Cancelled")',
    ]
    for f, col in zip(formulas, cols):
        if f:
            ws.cell(row=5, column=col).value = f
    end_ref = f"{get_column_letter(cols[4])}5"
    con_ref = f"{get_column_letter(cols[3])}5"
    ws.cell(row=5, column=cols[5]).value = f"={end_ref}-{con_ref}"


def add_bars(ws, last_row):
    """One rule set over the whole grid. Bars are driven by the date cells, so
    editing a date moves the bar. Rule order matters: the status line is first
    so its border wins, and the lapsed-window rule precedes the plain
    Not Started rule so it wins the fill."""
    a = get_column_letter(GRID_FIRST)               # anchor column, O
    rng = f"{a}{ROW_FIRST}:{get_column_letter(GRID_LAST)}{last_row}"
    R = ROW_FIRST

    start = f'IF($I{R}="",$G{R},$I{R})'
    end = f'IF(IF($J{R}="",$H{R},$J{R})="",$C$5,IF($J{R}="",$H{R},$J{R}))'
    overlap = f'AND({start}<>"",{a}${ROW_WEEK}+6>={start},{a}${ROW_WEEK}<={end})'

    def rule(formula, colour=None, border=None):
        ws.conditional_formatting.add(rng, FormulaRule(
            formula=[formula], stopIfTrue=False,
            fill=PatternFill("solid", start_color=colour, end_color=colour) if colour else None,
            border=border))

    # 1. the status-date line, drawn as an orange edge down the whole grid
    rule(f'AND({a}${ROW_WEEK}<=$C$5,{a}${ROW_WEEK}+6>$C$5)',
         border=Border(left=Side(style="medium", color=ORANGE)))
    # 2. phase summary
    rule(f'AND($A{R}="PHASE",{overlap})', NAVY)
    # 3-5. delivered / running / blocked
    rule(f'AND($E{R}="Completed",{overlap})', GREEN)
    rule(f'AND($E{R}="In Progress",{overlap})', AMBER)
    rule(f'AND($E{R}="Blocked",{overlap})', RED)
    # 6. a window that has already passed with nothing done - before rule 7 so it wins
    rule(f'AND($E{R}="Not Started",$H{R}<>"",$H{R}<$C$5,{overlap})', SKY,
         Border(left=Side(style="medium", color=RED),
                bottom=Side(style="medium", color=RED)))
    # 7. ordinary forecast
    rule(f'AND($E{R}="Not Started",{overlap})', SKY)
    # Client-Led (TBC) and Cancelled match nothing on purpose: no bar is drawn.


def add_validation(ws, last_row):
    for col, values in ((COL_STATUS, STATUSES), (COL_SOW, SOW_VALUES)):
        dv = DataValidation(type="list", allow_blank=True,
                            formula1='"' + ",".join(values) + '"')
        ws.add_data_validation(dv)
        dv.add(f"{get_column_letter(col)}{ROW_FIRST}:{get_column_letter(col)}{last_row}")


def add_legend(ws, r):
    put(ws, r, COL_ID, "LEGEND", font=Font(name="Calibri", size=9, bold=True, color=INK))
    entries = [
        (GREEN, "Completed", "Delivered and verified."),
        (AMBER, "In Progress", "Running now; a row with no end date reaches the status date."),
        (RED, "Blocked", "Cannot proceed until a named input arrives."),
        (SKY, "Not Started / Forecast", "Dates shown are an ESTIMATE awaiting sign-off."),
        (SKY, "Not Started - window lapsed", "Red edge: the planned window has passed with nothing recorded in it."),
        (NAVY, "Phase summary", "Spans its own child rows; dates are formulas, not typed."),
        (None, "Client-Led (TBC)", "No bar drawn - HFSE owns the date and none has been set."),
        (None, "Cancelled", "No bar drawn."),
    ]
    for i, (colour, name, meaning) in enumerate(entries, start=1):
        row = r + i
        if colour:
            put(ws, row, COL_ID, None, fill=colour, border=box())
        put(ws, row, COL_ACT, name, font=Font(name="Calibri", size=8, bold=True), align=LEFT)
        put(ws, row, COL_OWNER, meaning, font=Font(name="Calibri", size=8, color="404040"), align=LEFT)
        ws.merge_cells(start_row=row, start_column=COL_OWNER, end_row=row, end_column=COL_PCT)
    tail = r + len(entries) + 2
    put(ws, tail, COL_ACT,
        "The orange vertical line is the status date (1 Sep 2026). Bars are drawn from the "
        "Actual / Revised dates where they exist and from the Plan dates otherwise, so a row "
        "with no actuals shows its contracted window standing empty. Slip is measured against "
        "Plan End: a blank means on time or no baseline to measure against.",
        font=Font(name="Calibri", size=8, italic=True, color="404040"), align=LEFT)
    ws.merge_cells(start_row=tail, start_column=COL_ACT, end_row=tail, end_column=COL_PCT + 8)
    ws.row_dimensions[tail].height = 26
    return tail


# ------------------------------------------------------------ assumptions
ASSUMPTIONS = [
 ("SOURCE OF DATES", [
  ("Plan Start / Plan End (every row marked In SOW = Yes)",
   "Taken verbatim from HFSE-SIS-Proposal-May2026-v3 (3).xlsx, 'Scope of Work' tab, column E. "
   "That tab states the engagement as 17 Mar - 26 Jun 2026, approximately 14 weeks / 102 calendar days.",
   "Contracted baseline"),
  ("Actual / Revised Start and End",
   "From the 'Implementation Timeline' tab of the same workbook, cross-checked against the "
   "repository's commit history module by module.",
   "User-supplied actual, git-corroborated"),
  ("Phase 3 start, 14 Apr 2026",
   "Matches the repository's very first commit to the day. The strongest-evidenced date on the chart.",
   "Verified"),
  ("Phase 10 completion dates",
   "Evidenced by database migrations: 110-111 House colours, 120-122 Disciplinary records, "
   "123 Relief covers, 125-131 and 134 MC & Travel declarations, 135-136 P-Files slots.",
   "Verified against code"),
  ("Rows 9.4, 9.5, 11.2, 11.3 end date",
   "No agreed date exists. Dates shown are our forecast, placed against the school's own Term 4 "
   "calendar (14 Sep - 19 Nov 2026) rather than invented.",
   "ESTIMATE - needs sign-off"),
  ("Plan dates on the six blocked rows, 10.6 to 10.11",
   "These are ClickUp BOARD TARGETS, not contracted dates. They are shown so the blocked work is "
   "visible and so the Slip column can count how long each has been waiting. They are the only "
   "Plan dates on the chart that do not come from the signed Scope of Work.",
   "Board target, not contractual"),
  ("Rows 11.4, 11.5",
   "Deliberately dateless and barless. HFSE owns the transition date and none has been set.",
   "Client-Led"),
 ]),
 ("KEY ASSUMPTIONS", [
  ("What 'Completed' means on a module row",
   "Feature-complete first delivery, not last touch. Every module has continued to receive "
   "refinement commits through 1 Sep 2026 under row 7.1, Post-Demo Revisions.",
   "Definition"),
  ("Phase % complete",
   "A simple average of the child rows. NOT weighted by effort or man-hours.",
   "Calculation choice"),
  ("The two headline percentages",
   "'Contracted scope' averages only rows marked In SOW = Yes. 'All activities' includes the "
   "add-ons and the Phase 2 candidates, which is why it reads lower.",
   "Calculation choice"),
  ("Slip vs original",
   "The headline measures from the contracted end (26 Jun 2026) to the latest date anywhere on "
   "the chart, which today is a forecast support end in December. Two narrower readings are more "
   "useful and both are smaller: to the last completed CONTRACTED deliverable (Cross-Module "
   "Integration & QA, 28 Aug 2026) the slip is 63 days; to the last completed activity of any "
   "kind (Expand P-Files Document List, 1 Sep 2026) it is 67 days. The gap between 67 and the "
   "headline is entirely the post-launch tail, which is long because the transition has not started.",
   "Calculation choice"),
  ("Timeline granularity",
   "One column is one calendar week, Monday start. Bars round out to whole weeks.",
   "Design choice"),
  ("Phase 9 delivery mode",
   "Contracted as onsite training in Singapore, 22-26 Jun. Delivered as virtual sessions. "
   "A change of mode as well as of dates; the travel row is kept and marked Cancelled so the "
   "change is visible rather than quietly dropped.",
   "Scope change"),
  ("Rows marked Add-on",
   "Built and delivered but not named in the signed Scope of Work. They have no baseline, so "
   "their Slip is blank by design - there is nothing to measure them against.",
   "Definition"),
 ]),
 ("OPEN QUESTIONS FOR HFSE / INTERNAL", [
  ("1. The proposal contradicts itself on Phase 7",
   "The 'Proposal Overview' tab says May 18 - Jun 12. The 'Scope of Work' tab says May 18 - Jun 5. "
   "Both are in the same signed file. This chart uses the Scope of Work date. Which is contractual?",
   "NEEDS A DECISION"),
  ("2. The parallel run has not started",
   "It was agreed to run through Term 3, 29 Jun - 4 Sep 2026. That window lapses in 3 days with no "
   "activity recorded in it. The next available window is Term 4, 14 Sep - 19 Nov; there is no term "
   "at all between 5 and 13 Sep. Needs a commitment from the school.",
   "Client-Led"),
  ("3. There is no go-live or full-transition date",
   "None exists anywhere on the project. It is recorded internally as 'not scheduled - needs a date'. "
   "Everything after the parallel run is unschedulable until this is set.",
   "Client-Led"),
  ("4. Power Users / Champions training was never held",
   "The original 19 Aug date passed. A new date is needed.",
   "NEEDS A DATE"),
  ("5. Wrap-up & Handover, 30 Aug",
   "No evidence it took place. Please confirm whether it did.",
   "NEEDS CONFIRMATION"),
  ("6. The ClickUp board understates delivery by five features",
   "The board shows 0% on all 11 Phase 2 items. Five are live in production with migrations to prove "
   "it (see the Phase 2 Backlog tab). The board needs updating.",
   "Internal - board hygiene"),
  ("7. The contracted engagement has been exceeded with no change request on record",
   "Delivery was contracted to 26 Jun and hypercare to 31 Jul. Work has continued to 1 Sep. Is there "
   "a signed variation, and is the extended period billable?",
   "NEEDS A DECISION"),
  ("8. Item 16 is missing from the existing timeline",
   "The numbering in the proposal's Implementation Timeline tab jumps 15 to 17. Was a row deleted?",
   "Internal"),
  ("9. No UAT sign-off record exists",
   "The internal Phase 2 gate requires 'UAT signed off by Joann and Amier'. No document records that "
   "it occurred.",
   "NEEDS CONFIRMATION"),
  ("10. AY2025 Term 4 data is permanently blocked",
   "No source workbooks exist for it. This will never be backfilled unless the files surface.",
   "Accepted limitation"),
  ("11. Two defects in the proposal workbook itself",
   "Cells F33 and F34 read =(D33-E33)+1 - start minus end, reversed. They return 1 only because both "
   "training rows are single-day, so the error is masked. Cell C38 reads 'Cosolidation'. This chart "
   "does not modify the proposal; flagging for whoever maintains it.",
   "Internal - defect"),
 ]),
]


def build_assumptions(ws):
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 52
    ws.column_dimensions["C"].width = 104
    ws.column_dimensions["D"].width = 30

    ws.merge_cells("B2:D2")
    put(ws, 2, 2, "ASSUMPTIONS, SOURCES & OPEN QUESTIONS",
        fill=NAVY, font=Font(name="Calibri", size=14, bold=True, color=CYAN), align=CENTER)
    for c in (3, 4):
        ws.cell(row=2, column=c).fill = solid(NAVY)
    ws.row_dimensions[2].height = 26

    ws.merge_cells("B3:D3")
    put(ws, 3, 2,
        "Every date on the Gantt tab traces to a row below. Where no source exists the row says so "
        "rather than showing an invented date.",
        font=Font(name="Calibri", size=9, italic=True, color="404040"), align=LEFT)

    r = 5
    for section, items in ASSUMPTIONS:
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
        put(ws, r, 2, section, fill=BAND,
            font=Font(name="Calibri", size=10, bold=True, color=WHITE), align=LEFT)
        for c in (3, 4):
            ws.cell(row=r, column=c).fill = solid(BAND)
        ws.row_dimensions[r].height = 18
        r += 1
        put(ws, r, 2, "Item", fill=PHASE,
            font=Font(name="Calibri", size=8, bold=True, color=INK), align=CENTER, border=box())
        put(ws, r, 3, "What it is and where it came from", fill=PHASE,
            font=Font(name="Calibri", size=8, bold=True, color=INK), align=CENTER, border=box())
        put(ws, r, 4, "Classification", fill=PHASE,
            font=Font(name="Calibri", size=8, bold=True, color=INK), align=CENTER, border=box())
        r += 1
        for item, detail, kind in items:
            put(ws, r, 2, item, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=9, bold=True, color=INK), align=LEFT)
            put(ws, r, 3, detail, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=8, color="404040"), align=LEFT)
            urgent = kind.startswith("NEEDS") or kind == "Client-Led"
            put(ws, r, 4, kind, fill=WHITE, border=box(),
                font=Font(name="Calibri", size=8, bold=True,
                          color=RED if urgent else "404040"), align=CENTER)
            ws.row_dimensions[r].height = 30
            r += 1
        r += 1

    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return r


# --------------------------------------------------------- phase 2 backlog
# (item, clickup due, board %, verified status, evidence, blocker / who owes it)
BACKLOG = [
 ("Investigate Awards Tracking to Include Certificates and Participation", D(2026, 8, 12), 0,
  "Not built",
  "lib/compute/awards.ts exists but is the Bronze/Silver/Gold computation - a different feature.",
  "Ms Chandana / Ms Tin have sent files; the requirement is not yet specified."),
 ("Add Student Disciplinary Records Section", D(2026, 8, 21), 0,
  "LIVE IN PRODUCTION",
  "Migrations 120, 121, 122. Browser-checked 24 Aug 2026.",
  "None - delivered."),
 ("Add House Color to Enable House-Points Tracking", D(2026, 8, 3), 0,
  "LIVE IN PRODUCTION",
  "Migrations 110, 111 and lib/sis/houses.ts.",
  "Confirm the 402-student import ran in production."),
 ("Check MC & Travel Declaration Upload for Attendance", D(2026, 8, 17), 0,
  "LIVE IN PRODUCTION",
  "Migrations 125-131 and 134. Parent filing, approval ladder, register write and staff upload, "
  "end to end on both sides.",
  "None - delivered 31 Aug 2026."),
 ("Expand P-Files Files to Store", D(2026, 8, 17), 0,
  "LIVE IN PRODUCTION",
  "Migrations 135, 136.",
  "None - delivered."),
 ("Supplies Book Tracking", D(2026, 8, 13), 0,
  "Not built",
  "No code.",
  "Awaiting the per-level supplies and books list from the school."),
 ("Implementation of Relief Teacher Covers", D(2026, 8, 12), 0,
  "LIVE IN PRODUCTION",
  "Migration 123. Start and end date relief coverage. Browser-verified 25 Aug 2026.",
  "None - delivered."),
 ("Implementation of SOW (Scheme of Work)", D(2026, 8, 21), 0,
  "Not built",
  "No code.",
  "Reopened 21 Aug by Ms Christina. Needs the teacher-dashboard scope agreed."),
 ("Implementation of TOR (Transcript of Records)", D(2026, 8, 21), 0,
  "Not built",
  "No code.",
  "Awaiting Ms Wynne's sample documents (temporary and permanent)."),
 ("Implement AEB Grade Change Request Flow", D(2026, 8, 27), 0,
  "Not built",
  "No code.",
  "Awaiting Ms Chandana's AEB form and membership list."),
 ("Parent Portal - Event Registration Tracking", D(2026, 8, 13), 0,
  "Not built",
  "No code.",
  "Requested by Ms Apple. Parents to view events they have previously registered for."),
]


def build_backlog(ws):
    widths = {2: 50, 3: 12, 4: 10, 5: 20, 6: 62, 7: 52}
    for c, w in widths.items():
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.column_dimensions["A"].width = 3

    ws.merge_cells("B2:G2")
    put(ws, 2, 2, "PHASE 2 CANDIDATE FEATURES - BOARD STATUS vs WHAT IS ACTUALLY IN PRODUCTION",
        fill=NAVY, font=Font(name="Calibri", size=14, bold=True, color=CYAN), align=CENTER)
    for c in range(3, 8):
        ws.cell(row=2, column=c).fill = solid(NAVY)
    ws.row_dimensions[2].height = 26

    ws.merge_cells("B3:G3")
    put(ws, 3, 2,
        "These are candidates for the Phase 2 build, which begins after the full transition. Five of "
        "them were built early, ahead of Phase 2, and are live now. The ClickUp board shows 0% on all "
        "eleven; the migration numbers below are the evidence that it is out of date.",
        font=Font(name="Calibri", size=9, italic=True, color="404040"), align=LEFT)
    ws.row_dimensions[3].height = 28

    heads = ["Feature", "Board due", "Board %", "Verified status",
             "Evidence", "Blocker / who owes the input"]
    for i, h in enumerate(heads):
        put(ws, 5, 2 + i, h, fill=NAVY,
            font=Font(name="Calibri", size=9, bold=True, color=WHITE),
            align=CENTER, border=box(WHITE))
    ws.row_dimensions[5].height = 20

    r = 6
    for item, due, board, verified, evidence, blocker in BACKLOG:
        live = verified == "LIVE IN PRODUCTION"
        put(ws, r, 2, item, fill=WHITE, border=box(),
            font=Font(name="Calibri", size=9, color=INK), align=LEFT)
        put(ws, r, 3, due, fill=WHITE, border=box(), fmt=DATE_FMT,
            font=Font(name="Calibri", size=8), align=CENTER)
        put(ws, r, 4, board, fill=WHITE, border=box(), fmt='0"%"',
            font=Font(name="Calibri", size=8), align=CENTER)
        put(ws, r, 5, verified, fill=GREEN if live else WHITE, border=box(),
            font=Font(name="Calibri", size=8, bold=True,
                      color=WHITE if live else "404040"), align=CENTER)
        put(ws, r, 6, evidence, fill=WHITE, border=box(),
            font=Font(name="Calibri", size=8, color="404040"), align=LEFT)
        put(ws, r, 7, blocker, fill=WHITE, border=box(),
            font=Font(name="Calibri", size=8, color="404040"), align=LEFT)
        ws.row_dimensions[r].height = 30
        r += 1

    last = r - 1
    put(ws, r + 1, 2, "Live in production", fill=PHASE,
        font=Font(name="Calibri", size=9, bold=True, color=INK), align=LEFT)
    put(ws, r + 1, 5,
        f'=COUNTIF(E6:E{last},"LIVE IN PRODUCTION")&" of {len(BACKLOG)}"',
        fill=PHASE, font=Font(name="Calibri", size=9, bold=True, color=INK), align=CENTER)
    put(ws, r + 1, 6,
        f'="Board average: "&ROUND(AVERAGE(D6:D{last}),0)&"%  |  Verified: "'
        f'&ROUND(COUNTIF(E6:E{last},"LIVE IN PRODUCTION")/{len(BACKLOG)}*100,0)&"%"',
        fill=PHASE, font=Font(name="Calibri", size=9, bold=True, color=RED), align=LEFT)

    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return r + 1


def main():
    out = Path(__file__).resolve().parent.parent / OUT
    wb = Workbook()
    gantt = wb.active
    gantt.title = "Gantt Chart"
    assumptions = wb.create_sheet("Assumptions")
    backlog = wb.create_sheet("Phase 2 Backlog")

    task_rows, phase_rows, last_row, legend_row = build_gantt(gantt)
    a_rows = build_assumptions(assumptions)
    b_rows = build_backlog(backlog)

    wb.calculation.fullCalcOnLoad = True

    try:
        wb.save(out)
    except PermissionError:
        sys.stderr.write(f"{out.name} is open in Excel. Close it and re-run.\n")
        return 1

    print(f"Wrote {out}")
    print(f"  Gantt Chart:     {len(task_rows)} activities in {len(phase_rows)} phases, "
          f"rows {ROW_FIRST}-{last_row}")
    print(f"                   {len(WEEKS)} weekly columns "
          f"({GRID_START:%d %b %Y} - {GRID_END:%d %b %Y}), legend at row {legend_row}")
    print(f"  Assumptions:     {sum(len(i) for _, i in ASSUMPTIONS)} entries "
          f"in {len(ASSUMPTIONS)} sections, to row {a_rows}")
    print(f"  Phase 2 Backlog: {len(BACKLOG)} features, to row {b_rows}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
