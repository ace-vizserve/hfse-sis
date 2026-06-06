# Academic Summary dashboard — high-value drill sheets

## Context
The Academic Summary dashboard (`/records/academic-summary`, the relocated masterfile — KD #127/#122) is a monitoring surface, but most of its aggregates are dead-ends: only the "Standing out" watchlist links anywhere. A registrar verifying the masterfile sees "Grades recorded 280/312" or a donut "Gold 40" and can't get to *which* students. This adds drill sheets to the high-value aggregates so a click reveals the names behind the number.

**Key architectural fact:** this dashboard is computed **entirely client-side** from the full `MasterfilePayload` already in the browser (`computeMasterfileDashboard(payload, filters)` in `components/markbook/masterfile-dashboard.tsx`). So drills here are **not** the KD #56 API/lazy-fetch framework — every student row is already loaded; a drill just surfaces a subset. No API route, no cache, no server round-trip.

## Drillable aggregates (high-value only)
Six aggregates, two halves. Each opens a sheet listing the matching students.

**Completeness:**
- **Grades recorded** → students with missing grades (stat: subjects/cells short)
- **Comments in** → students with no submitted+non-empty FCA comment (stat: status)
- **Full results** → students lacking complete results (the not-yet-ready list; stat: what's short)
- **"Still coming in" groups** → each `needsData` group row opens the students/sheets behind that count (today it's only a number)

**Outcomes:**
- **Award tiers** → students in Gold / Silver / Bronze / Not eligible (stat: GA + tier)
- **GA bands** → students in each General Average band (stat: GA)

**Skipped (deferred, lower value):** Sheets locked (sheet-centric, not students), Attendance logged + Attendance health, Subject performance bars. "Standing out" already links to Records — unchanged.

## Design
**Pure derivation lib — `lib/markbook/masterfile-drill.ts`** (new, unit-tested):
- `type MasterfileDrillTarget` — discriminated union: `{kind:'missing-grades'}` · `{kind:'missing-comments'}` · `{kind:'incomplete-results'}` · `{kind:'award', tier:'gold'|'silver'|'bronze'|'notEligible'}` · `{kind:'ga-band', tier:string}` · `{kind:'needs-data', groupKey:string}`.
- `type MasterfileDrillRow = { studentNumber: string | null; studentName: string; sectionName: string; status: 'Active'|'Late enrollee'|'Withdrawn'; stat: string }` (+ a `statLabel` returned alongside for the column header).
- `buildMasterfileDrillRows(payload, filters, target): { rows: MasterfileDrillRow[]; title: string; statLabel: string }` — derives rows from the **same filtered dataset and the same predicates** `computeMasterfileDashboard` uses (share helpers so **count == drill**, the KD #124 lesson). Sorted by section then name.

**Sheet — `components/markbook/masterfile-drill-sheet.tsx`** (new, client): shadcn `Sheet` + a plain scrollable `Table` (lists are bounded — per-class ≤50, per-level a few hundred; no virtualization needed). Columns: **student name** (→ `/records/students/[studentNumber]` via `<IdentifierLink>`, KD #81; falls back to plain text when `studentNumber` is null), section, status (`<StatusBadge>`/enrollment wrapper), and the one drill stat. Header shows the drill title + row count; empty state when none. Controlled `open`/`onOpenChange` from the dashboard.

**Wiring (`masterfile-dashboard.tsx`):** the dashboard holds one piece of drill state (`activeTarget: MasterfileDrillTarget | null`). The six aggregates become **buttons** (proper touch target + focus ring + `aria-label`, design-system §1/§2):
- ReadinessCard (Grades recorded, Comments in) + GradableCard (Full results) → whole card clickable.
- Award + GA → **clickable legend/band chips** (the donut footnote + `BandFootnote`) rather than chart-segment clicks — more accessible + avoids modifying the shared chart components.
- NeedsData (`<ActionList>` "Still coming in") items → clickable to open the group's members (add an `onClick` affordance to those items; "Standing out" keeps its `href`).
Drills respect the active Term/Subject/Status dashboard filters (same set the dashboard computes from).

## Out of scope
No API route / cache / CSV (the XLSX export already covers full extraction; these drills are on-screen verification). No changes to the data layer, the export, or the Table view. No new role gates (page is already registrar/school_admin/superadmin).

## Testing
- Unit-test `buildMasterfileDrillRows`: for a fixture payload, each target's row count **equals** the matching aggregate from `computeMasterfileDashboard` (parity guard per KD #124); null-`studentNumber` rows still render (fall back to plain name); filters narrow the set.
- `npx tsc --noEmit` + `npx vitest run` + `npx next build` clean.
- Manual: each of the 6 aggregates opens a sheet whose count matches the card/segment; names link to Records; Term/Subject/Status filters narrow the drill; empty states read sensibly.

## Build
Subagent-driven + a `feature-dev:code-reviewer` pass. Files: new `lib/markbook/masterfile-drill.ts` + `components/markbook/masterfile-drill-sheet.tsx`; edit `components/markbook/masterfile-dashboard.tsx` (wire clickability + sheet state); reuse `<Sheet>`, `<Table>`, `<IdentifierLink>`, the enrollment `<StatusBadge>`. No migration.
