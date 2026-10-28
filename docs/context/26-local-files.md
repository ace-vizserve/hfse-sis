# Local files — where the school's files live

Every file the school sends (workbooks, exports, forms, calendars) and every
report made for the school lives under **`files/`** at the repo root. The whole
folder is git-ignored: it holds real student data and exists only on this
machine. Never commit anything from it, and never drop a new file at the repo
root — put it in the matching folder below.

Scripts and tests refer to these files by their path from the repo root
(`files/AY2026/T2/...`). A test that reads one skips itself when the file is
missing, so a clean checkout still passes.

| Folder                    | What goes there                                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files/AY2025/`           | AY2025 sources: `Grades/` and `Attendance/` (the term workbooks), the Final Report Books (Primary / Secondary), the admissions metadata export, `AY2025 Reconciliation.csv`, `ay2025_calendar.sql`                                                                            |
| `files/AY2026/`           | AY2026 sources: `T1/` – `T4/` (each term's grading folders, attendance register and consolidated form), plus the year's loose files — the published calendar PNG, `AY2026 Term 3 Attendance Latest.xlsx`, Sec 4 Term 4 grading sheets, the Science SOW, house points tracking |
| `files/AY2027/`           | AY2027 sources (the book list)                                                                                                                                                                                                                                                |
| `files/school-lists/`     | Lists that span years: `List of Students.xlsx` (the office master list), the Teachers Deployment workbook                                                                                                                                                                     |
| `files/house/`            | House-colour assignment workbook + CSV, and the scratch checks written against them                                                                                                                                                                                           |
| `files/quickbooks/`       | QuickBooks exports: Products & Services list, Invoice List by Date, Sales by Product/Service Detail, `Customers.xls`                                                                                                                                                          |
| `files/forms/`            | School forms and templates (approval form, warning letter, sample certificate) and school records sent for reference (incident reports)                                                                                                                                       |
| `files/progress-reports/` | What we send the school: the weekly-update Gantts (`HFSE-SIS-Weekly-Update-*.xlsx`), the implementation Gantt, the proposal                                                                                                                                                   |
| `files/training/`         | Training material: `presentations/` (decks, course outline), `handouts/` (per-role guides, quick-reference PDFs), `sis-walkthrough.md`                                                                                                                                        |

A new academic year gets its own `files/AY{YYYY}/` folder. Generated script
output does NOT go here — it stays beside its script (`scripts/backfill/*-apply/`,
`scripts/provision-output/`), already git-ignored.
