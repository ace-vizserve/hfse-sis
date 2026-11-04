# Builds the HFSE SIS weekly progress update (Excel Gantt) from a rows JSON file.
#
#   python .claude/skills/weekly-update/gen_weekly.py <rows.json> <out.xlsx>
#
# rows.json:
#   {
#     "week_start": "2026-10-19",            # the Monday; the grid runs Mon-Fri
#     "groups": [
#       {"name": "MEETINGS WITH MS JOANN", "rows": [
#         {"feature": "...", "module": "...", "start": "2026-10-19", "end": "2026-10-19",
#          "status": "Meeting", "time": "Mon 2:00 - 3:00 PM", "desc": "..."}]},
#       {"name": "ATTENDANCE", "rows": [
#         {"feature": "...", "module": "...", "start": "...", "end": "...",
#          "status": "Shipped", "desc": "..."}]}
#     ]
#   }
#
# status is one of: Shipped, Shipped - for checking, Revised, In progress, Upcoming, Meeting.
# Needs openpyxl.

import json
import sys
from datetime import date, datetime, timedelta

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L

SRC, OUT = sys.argv[1], sys.argv[2]
data = json.load(open(SRC, encoding="utf-8"))

NAVY, CYAN, BLUE = "FF12284C", "FF00B0F0", "FF2E75B6"
PALE, BAND, INK = "FFEEF3FA", "FFD9E2F3", "FF1F3864"
GRID, CELL_LINE, ORANGE = "FFE8E8E8", "FFBFBFBF", "FFED7D31"
STATUS = {
    "Shipped": ("FF00B050", "FFFFFFFF"),
    "Shipped - for checking": ("FFFFC000", "FF000000"),
    "Revised": ("FF7030A0", "FFFFFFFF"),
    "In progress": (BLUE, "FFFFFFFF"),
    "Upcoming": ("FFBDD7EE", "FF000000"),
    "Meeting": (NAVY, "FFFFFFFF"),
}
LEGEND = {
    "Shipped": "Shipped - live in production. Bar runs from start day to release day.",
    "Shipped - for checking": "Shipped - for checking. Live in production, being checked with the school.",
    "Revised": "Revised - an existing feature, improved and live in production.",
    "In progress": "In progress - still being worked on.",
    "Upcoming": "Upcoming - planned, not started.",
    "Meeting": "Meeting with the school - status shows the day and time.",
}
OPEN = ("In progress", "Upcoming")   # no Finished date, no Days

d = lambda s: date.fromisoformat(s)
MON = d(data["week_start"])
DAYS = [MON + timedelta(days=i) for i in range(5)]
FRI = DAYS[-1]
STATUS_DATE = FRI
fmt = lambda x: f"{x.day} {x.strftime('%b')}"
WEEK = f"{MON.day} - {FRI.day} {FRI.strftime('%b')}" if MON.month == FRI.month else f"{fmt(MON)} - {fmt(FRI)}"

GROUPS = [(g["name"], [(r["feature"], r["module"], d(r["start"]), d(r["end"]), r["status"],
                        r.get("time", ""), r["desc"]) for r in g["rows"]]) for g in data["groups"]]
ROWS = [r for _, items in GROUPS for r in items]
for r in ROWS:
    if r[4] not in STATUS:
        sys.exit(f"Unknown status {r[4]!r} on {r[0]!r} - use one of {list(STATUS)}")

D0 = 10                      # J: first day column
DN = D0 + len(DAYS) - 1
SP = DN + 1
DESC = DN + 2
LAST = L(DESC)

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Weekly Gantt"
ws.sheet_view.showGridLines = False

fill = lambda c: PatternFill("solid", fgColor=c)
font = lambda sz, bold=False, color="FF000000": Font(name="Calibri", size=sz, bold=bold, color=color)
side = lambda color, style="thin": Side(style=style, color=color)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
cell_border = Border(*(side(CELL_LINE),) * 4)
head_border = Border(*(side("FFFFFFFF"),) * 4)
xl = lambda v: datetime(v.year, v.month, v.day)

widths = {"A": 2, "B": 5, "C": 50, "D": 20, "E": 9, "F": 9, "G": 6, "H": 22, "I": 1.43, L(SP): 1.43, LAST: 95}
for col in range(D0, DN + 1):
    widths[L(col)] = 6
for k, v in widths.items():
    ws.column_dimensions[k].width = v

# Title
has_meetings = any(r[4] == "Meeting" for r in ROWS)
sub = (f"Features delivered{' and meetings' if has_meetings else ''}  |  Week of {WEEK} {FRI.year}  |  "
       f"Status as of {FRI.strftime('%a')} {FRI.day} {FRI.strftime('%b %Y')}")
for r, text, f, h in ((2, "HFSE INTERNATIONAL SCHOOL  |  SIS - WEEKLY PROGRESS UPDATE", font(16, True, CYAN), 30),
                      (3, sub, font(10, True, "FFFFFFFF"), 20.1)):
    ws.merge_cells(f"B{r}:{LAST}{r}")
    c = ws[f"B{r}"]
    c.value, c.font, c.fill, c.alignment = text, f, fill(NAVY), CENTER
    ws.row_dimensions[r].height = h

# Summary tiles - only the statuses this week uses
count = lambda s: sum(1 for x in ROWS if x[4] == s)
used = [s for s in ("Shipped", "Shipped - for checking", "Revised", "In progress", "Upcoming") if count(s)]
slots = [("C", "C"), ("D", "D"), ("E", "G")][:3]
tiles = [(a, b, s, count(s)) for (a, b), s in zip(slots, used)] + [("H", "H", "Status date", f"{FRI.day} {FRI.strftime('%b %Y')}")]
for a, b, lbl, val in tiles:
    for r, v, f in ((4, lbl, font(8, True, INK)), (5, val, font(13, True, NAVY))):
        if a != b:
            ws.merge_cells(f"{a}{r}:{b}{r}")
        c = ws[f"{a}{r}"]
        c.value, c.font, c.fill, c.alignment = v, f, fill(PALE), CENTER
ws.row_dimensions[4].height = 14.1
ws.row_dimensions[5].height = 21.95
ws.row_dimensions[6].height = 6

# Header
for col, lbl in (("B", "No."), ("C", "Feature"), ("D", "Module"), ("E", "Start"),
                 ("F", "Finished"), ("G", "Days"), ("H", "Status"), (LAST, "What was delivered")):
    ws.merge_cells(f"{col}7:{col}9")
    c = ws[f"{col}7"]
    c.value, c.font, c.fill, c.alignment = lbl, font(9, True, "FFFFFFFF"), fill(NAVY), CENTER
    for r in (7, 8, 9):
        ws[f"{col}{r}"].fill = fill(NAVY)
        ws[f"{col}{r}"].border = head_border

ws.merge_cells(f"{L(D0)}7:{L(DN)}7")
c = ws[f"{L(D0)}7"]
c.value, c.font, c.fill, c.alignment = f"WEEK  |  {WEEK}", font(8, True, "FFFFFFFF"), fill(BLUE), CENTER
for i, day in enumerate(DAYS):
    col = D0 + i
    ws.cell(7, col).border = head_border
    c = ws.cell(8, col, xl(day))
    c.number_format, c.font, c.fill, c.alignment, c.border = "d", font(8, True, "FFFFFFFF"), fill(NAVY), CENTER, head_border
    c = ws.cell(9, col, "MTWTF"[day.weekday()])
    c.font, c.fill, c.alignment, c.border = font(7, False, "FFFFFFFF"), fill(NAVY), CENTER, head_border
for r in (7, 8, 9):
    ws.row_dimensions[r].height = 15


def day_cells(r, start, end, on, off):
    for i, day in enumerate(DAYS):
        c = ws.cell(r, D0 + i)
        c.fill = fill(on) if start <= day <= end else fill(off)
        right = side(ORANGE, "medium") if day == STATUS_DATE else side(GRID)
        c.border = Border(left=side(GRID), right=right, top=side(GRID), bottom=side(GRID))


# Body
r = 10
for g, (group, items) in enumerate(GROUPS, 1):
    for col in range(2, DESC + 1):
        ws.cell(r, col).fill = fill(BAND)
    first, last = r + 1, r + len(items)
    closed = all(x[4] not in OPEN for x in items)
    for col, v in ((3, group), (5, f"=MIN(E{first}:E{last})"),
                   (6, f"=MAX(F{first}:F{last})" if closed else "-"),
                   (7, f"=F{r}-E{r}+1" if closed else "-")):
        c = ws.cell(r, col, v)
        c.font, c.alignment = font(9 if col == 3 else 8, True, INK), LEFT if col == 3 else CENTER
        if col in (5, 6):
            c.number_format = "d-mmm"
    statuses = [x[4] for x in items]
    gstatus = next(s for s in ("In progress", "Upcoming", "Shipped - for checking", "Revised", "Shipped", "Meeting") if s in statuses)
    gfill, gfont = STATUS[gstatus]
    n_meet = statuses.count("Meeting")
    glabel = (f"{n_meet} meeting{'s' if n_meet > 1 else ''}") if gstatus == "Meeting" else gstatus
    c = ws.cell(r, 8, glabel)
    c.font, c.fill, c.alignment, c.border = font(8, True, gfont), fill(gfill), CENTER, cell_border
    day_cells(r, min(x[2] for x in items), max(x[3] for x in items), gfill, BAND)
    ws.row_dimensions[r].height = 17.1
    r += 1
    for n, (name, module, start, end, status, time, desc) in enumerate(items, 1):
        sfill, sfont = STATUS[status]
        is_open = status in OPEN
        vals = [(2, f"{g}.{n}", font(8, False, "FF808080")), (3, name, font(9, True, INK)), (4, module, font(8)),
                (5, start, font(8)),
                (6, "-" if is_open else end, font(8, True)),
                (7, "-" if is_open else f"=F{r}-E{r}+1", font(8)),
                (8, time if status == "Meeting" and time else status, font(8, True, sfont))]
        for col, v, f in vals:
            c = ws.cell(r, col, xl(v) if isinstance(v, date) else v)
            c.font, c.alignment, c.border = f, LEFT if col == 3 else CENTER, cell_border
            c.fill = fill(sfill) if col == 8 else fill("FFFFFFFF")
            if isinstance(v, date):
                c.number_format = "d-mmm"
        day_cells(r, start, end, sfill, "FFFFFFFF")
        c = ws.cell(r, DESC, desc)
        c.font, c.alignment = font(8, False, "FF404040"), LEFT
        ws.row_dimensions[r].height = 44.1
        r += 1

# Legend - only the statuses used
r += 1
present = [s for s in STATUS if any(x[4] == s for x in ROWS)]
legend = [(s, LEGEND[s]) for s in present] + [(None, f"Orange line - status date, {FRI.strftime('%a')} {FRI.day} {FRI.strftime('%b %Y')}.")]
for key, text in legend:
    if key:
        ws.cell(r, 2).fill = fill(STATUS[key][0])
        ws.cell(r, 2).border = cell_border
    c = ws.cell(r, 3, text)
    c.font, c.alignment = font(8, True), LEFT
    ws.row_dimensions[r].height = 22.5
    r += 1

ws.freeze_panes = f"{L(D0)}10"
ws.page_setup.orientation = "landscape"
ws.sheet_properties.pageSetUpPr.fitToPage = True
ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
wb.save(OUT)
print("saved", OUT, "rows", len(ROWS))
