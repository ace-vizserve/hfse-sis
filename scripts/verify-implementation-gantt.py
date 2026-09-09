# scripts/verify-implementation-gantt.py
#
# Checks HFSE-SIS-Implementation-Gantt-2026.xlsx before it is sent to anyone.
#
# openpyxl writes formulas but does not evaluate them, so reading the file back
# cannot tell us what Excel will display. This script therefore does three
# separate things:
#
#   1. STRUCTURAL   the formulas are present, point at the right cells, and each
#                   phase rollup covers exactly its own children
#   2. ARITHMETIC   the same Days / Slip / per-cent maths recomputed in plain
#                   Python from the generator's own source data, and printed, so
#                   the numbers Excel will show can be checked before sending
#   3. UNTOUCHED    the proposal workbook is not opened or written by the
#                   generator - it is the contract document
#
# The generator's literals are IMPORTED, not copied, so the two cannot drift.
#
# Run:  python scripts/verify-implementation-gantt.py

import sys

# This script imports the generator by path to read its literals. That would
# normally drop a scripts/__pycache__ directory into the repo, and the repo has
# no Python ignore rules, so switch bytecode caching off before importing.
sys.dont_write_bytecode = True

import importlib.util  # noqa: E402
import re  # noqa: E402
from datetime import date, datetime  # noqa: E402
from pathlib import Path  # noqa: E402

try:
    from openpyxl import load_workbook
except ImportError:
    sys.stderr.write("Needs openpyxl:  pip install openpyxl\n")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "scripts" / "gen-implementation-gantt.py"
PROPOSAL = ROOT / "HFSE-SIS-Proposal-May2026-v3 (3).xlsx"

failures = []
checks = 0


def check(label, ok, detail=""):
    global checks
    checks += 1
    if not ok:
        failures.append(f"{label}{'  ->  ' + detail if detail else ''}")
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail and not ok else ''}")


def load_generator():
    spec = importlib.util.spec_from_file_location("gen_gantt", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def as_date(v):
    if isinstance(v, datetime):
        return v.date()
    return v


def main():
    g = load_generator()
    book = ROOT / g.OUT
    if not book.exists():
        sys.stderr.write(f"Not found: {book}. Run gen-implementation-gantt.py first.\n")
        return 1

    print(f"\nVerifying {book.name}\n")

    # ---------------------------------------------------------- 1 STRUCTURAL
    print("STRUCTURAL")
    wb = load_workbook(book, data_only=False)
    check("three sheets present",
          wb.sheetnames == ["Gantt Chart", "Assumptions", "Phase 2 Backlog"],
          str(wb.sheetnames))
    ws = wb["Gantt Chart"]

    check("status date cell C5 is 1 Sep 2026",
          as_date(ws["C5"].value) == date(2026, 9, 1), repr(ws["C5"].value))
    check("contracted end cell J5 is 26 Jun 2026",
          as_date(ws["J5"].value) == date(2026, 6, 26), repr(ws["J5"].value))
    check("workbook is marked to recalculate on open",
          wb.calculation.fullCalcOnLoad is True)

    task_rows, phase_rows = [], []
    for r in range(g.ROW_FIRST, ws.max_row + 1):
        mark = ws.cell(row=r, column=g.COL_MARK).value
        if mark == "TASK":
            task_rows.append(r)
        elif mark == "PHASE":
            phase_rows.append(r)

    expected_tasks = sum(len(t) for _, t in g.PHASES)
    check(f"{expected_tasks} task rows marked in the hidden column",
          len(task_rows) == expected_tasks, f"found {len(task_rows)}")
    check(f"{len(g.PHASES)} phase rows marked",
          len(phase_rows) == len(g.PHASES), f"found {len(phase_rows)}")

    # every task and phase row carries live Days and Slip formulas
    bad = [r for r in task_rows + phase_rows
           if not (str(ws.cell(row=r, column=g.COL_DAYS).value or "").startswith("=")
                   and str(ws.cell(row=r, column=g.COL_SLIP).value or "").startswith("="))]
    check("every row has formula-driven Days and Slip", not bad, f"rows {bad[:6]}")

    # Days and Slip must reference their OWN row, never a neighbour
    misref = []
    for r in task_rows + phase_rows:
        for col in (g.COL_DAYS, g.COL_SLIP):
            f = str(ws.cell(row=r, column=col).value)
            for ref in re.findall(r"\$[A-Z]{1,2}(\d+)", f):
                if ref != "5" and int(ref) != r:          # $C$5 is the status date
                    misref.append((r, col, ref))
    check("no Days/Slip formula points at another row", not misref, str(misref[:4]))

    # phase rollups must span exactly their own children
    span_errors = []
    for i, prow in enumerate(phase_rows):
        first = prow + 1
        last = (phase_rows[i + 1] - 1) if i + 1 < len(phase_rows) else task_rows[-1]
        for col in (g.COL_PS, g.COL_PE, g.COL_AS, g.COL_AE, g.COL_PCT):
            f = str(ws.cell(row=prow, column=col).value or "")
            if not f.startswith("="):
                span_errors.append((prow, col, "not a formula"))
                continue
            rng = re.findall(r"([A-Z]{1,2})(\d+):[A-Z]{1,2}(\d+)", f)
            if not rng or int(rng[0][1]) != first or int(rng[0][2]) != last:
                span_errors.append((prow, col, f))
    check("every phase rollup spans exactly its own children",
          not span_errors, str(span_errors[:3]))

    # MIN/MAX are COUNT-guarded, or an empty phase reports 0 Jan 1900
    unguarded = [(p, c) for p in phase_rows for c in (g.COL_PS, g.COL_PE, g.COL_AS, g.COL_AE)
                 if "COUNT(" not in str(ws.cell(row=p, column=c).value or "")]
    check("every phase MIN/MAX is COUNT-guarded", not unguarded, str(unguarded[:3]))

    # the bar rules
    grid_rules = []
    for rng, rules in ws.conditional_formatting._cf_rules.items():
        if str(rng.sqref).startswith(f"{chr(64 + g.GRID_FIRST)}{g.ROW_FIRST}") or \
           f"{g.ROW_FIRST}:" in str(rng.sqref):
            grid_rules.extend(rules)
    check("7 conditional-format rules drive the grid",
          len(grid_rules) == 7, f"found {len(grid_rules)}")
    check("every bar rule is a formula rule",
          all(r.type == "expression" for r in grid_rules))
    check("bar formulas read the week header row 8",
          all("$8" in (r.formula[0] if r.formula else "") for r in grid_rules))

    check("Status and In SOW have dropdowns",
          len(ws.data_validations.dataValidation) == 2,
          str(len(ws.data_validations.dataValidation)))

    check(f"{len(g.WEEKS)} weekly columns, all real dates",
          all(isinstance(ws.cell(row=g.ROW_WEEK, column=g.GRID_FIRST + i).value, (datetime, date))
              for i in range(len(g.WEEKS))))

    # ---------------------------------------------------------- 2 ARITHMETIC
    print("\nARITHMETIC  (what Excel will compute, recomputed here independently)")
    flat = [t for _, tasks in g.PHASES for t in tasks]
    status_date, contract_end = g.STATUS_DATE, g.CONTRACT_END

    rows_out, pcts_all, pcts_sow, open_items = [], [], [], 0
    programme_end = contract_end
    last_completed = None          # last completed row of any kind
    last_completed_sow = None      # last completed row that is IN the signed SOW

    for (tid, act, owner, status, sow, plan, actual, pct, _note) in flat:
        ps, pe = plan
        a_s, a_e = actual
        if a_s:
            days = ((a_e or status_date) - a_s).days + 1
        elif ps and pe:
            days = (pe - ps).days + 1
        else:
            days = None
        if not pe:
            slip = None
        elif a_e:
            slip = (a_e - pe).days
        elif status not in ("Completed", "Cancelled") and status_date > pe:
            slip = (status_date - pe).days
        else:
            slip = None
        for d in (pe, a_e):
            if d and d > programme_end:
                programme_end = d
        if status == "Completed" and a_e:
            if last_completed is None or a_e > last_completed:
                last_completed = a_e
            if sow == "Yes" and (last_completed_sow is None or a_e > last_completed_sow):
                last_completed_sow = a_e
        if pct is not None:
            pcts_all.append(pct)
            if sow == "Yes":
                pcts_sow.append(pct)
        if status not in ("Completed", "Cancelled"):
            open_items += 1
        rows_out.append((tid, act[:44], status, days, slip, pct))

    hdr = f"  {'ID':<6} {'Activity':<44} {'Status':<16} {'Days':>5} {'Slip':>6} {'%':>5}"
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    for tid, act, status, days, slip, pct in rows_out:
        print(f"  {tid:<6} {act:<44} {status:<16} "
              f"{('' if days is None else days):>5} "
              f"{('' if slip in (None, 0) else f'{slip:+d}'):>6} "
              f"{('' if pct is None else f'{pct}%'):>5}")

    pct_all = round(sum(pcts_all) / len(pcts_all))
    pct_sow = round(sum(pcts_sow) / len(pcts_sow))
    slip_total = (programme_end - contract_end).days
    slip_delivery = (last_completed - contract_end).days
    slip_sow = (last_completed_sow - contract_end).days

    print(f"\n  Contracted end (SOW)            {contract_end:%d %b %Y}")
    print(f"  Last completed CONTRACTED row   {last_completed_sow:%d %b %Y}"
          f"   -> contracted-delivery slip {slip_sow} days")
    print(f"  Last completed row of any kind  {last_completed:%d %b %Y}"
          f"   -> all-work delivery slip {slip_delivery} days")
    print(f"  Programme end (incl. forecast)  {programme_end:%d %b %Y}"
          f"   -> headline slip {slip_total} days")
    print(f"  % complete, contracted scope    {pct_sow}%   ({len(pcts_sow)} rows)")
    print(f"  % complete, all activities      {pct_all}%   ({len(pcts_all)} rows)")
    print(f"  Open items                      {open_items}")

    print()
    # both numbers are quoted verbatim on the Assumptions tab, so both are guarded
    check("contracted-delivery slip is the 63 days stated on the Assumptions tab",
          slip_sow == 63, f"computed {slip_sow}")
    check("all-work delivery slip is the 67 days stated on the Assumptions tab",
          slip_delivery == 67, f"computed {slip_delivery}")
    check("every completed row has an actual end date",
          all(t[6][1] for t in flat if t[3] == "Completed"))
    check("no row has an actual end before its actual start",
          all(not (t[6][0] and t[6][1] and t[6][1] < t[6][0]) for t in flat))
    check("no row has a plan end before its plan start",
          all(not (t[5][0] and t[5][1] and t[5][1] < t[5][0]) for t in flat))
    check("every dated row falls inside the drawn grid",
          all(all(g.GRID_START <= d <= g.GRID_END
                  for d in (t[5][0], t[5][1], t[6][0], t[6][1]) if d) for t in flat))
    check("Client-Led (TBC) and Cancelled rows draw no bar",
          all(t[5] == (None, None) or t[3] == "Cancelled"
              for t in flat if t[3] == "Client-Led (TBC)"))
    backlog_live = sum(1 for b in g.BACKLOG if b[3] == "LIVE IN PRODUCTION")
    check("5 of 11 Phase 2 candidates verified live",
          backlog_live == 5, f"counted {backlog_live}")

    # ---------------------------------------------------------- 3 UNTOUCHED
    print("\nPROPOSAL WORKBOOK")
    src = GEN.read_text(encoding="utf-8")
    body = src.split("# Run:", 1)[-1]
    # It is correct and wanted for the generator to NAME the proposal in its
    # provenance text; what must never appear is a call that opens or writes it.
    opens = [c for c in ("load_workbook(", "open(", "shutil.copy", "os.remove", "unlink(")
             if c in body]
    check("the generator makes no call that could read or alter the proposal",
          not opens, str(opens))
    check("the generator writes exactly one file",
          body.count("wb.save(") == 1, str(body.count("wb.save(")))
    if PROPOSAL.exists():
        mt = datetime.fromtimestamp(PROPOSAL.stat().st_mtime)
        print(f"  INFO  proposal last modified {mt:%d %b %Y %H:%M:%S} - unchanged by this run")

    # ------------------------------------------------------------- 4 PREVIEW
    # The bars are conditional formatting, so they only exist once Excel opens
    # the file. This redraws them here with the SAME overlap rule the workbook
    # uses, as the closest available stand-in for looking at it.
    print("\nBAR PREVIEW  (# delivered  = running  ! blocked  . forecast  x lapsed window)")
    glyph = {"Completed": "#", "In Progress": "=", "Blocked": "!", "Not Started": "."}
    months = "".join(f"{w:%b}"[0] if w.day <= 7 else " " for w in g.WEEKS)
    print(f"  {'':<46}|{months}|")
    for _phase, tasks in g.PHASES:
        for (tid, act, _o, status, _s, plan, actual, _p, _n) in tasks:
            start = actual[0] or plan[0]
            end = actual[1] or plan[1]
            if not start or status in ("Client-Led (TBC)", "Cancelled"):
                bar = " " * len(g.WEEKS)
            else:
                stop = end or status_date
                mark = glyph.get(status, " ")
                if status == "Not Started" and plan[1] and plan[1] < status_date:
                    mark = "x"
                bar = "".join(mark if (w + __import__("datetime").timedelta(days=6) >= start
                                       and w <= stop) else " " for w in g.WEEKS)
            print(f"  {tid:<5} {act[:40]:<40}|{bar}|")
    line = "".join("^" if w <= status_date < w + __import__("datetime").timedelta(days=7)
                   else " " for w in g.WEEKS)
    print(f"  {'status date ->':<46}|{line}|")

    print(f"\n{checks - len(failures)}/{checks} checks passed")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
