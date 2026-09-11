# Dashboard & Insights CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every module dashboard and every Insights page gets one "Export CSV" button that downloads everything the page shows — key figures, every chart's numbers, every list — as one sectioned CSV file.

**Architecture:** The page's server component already loads all the data. A pure, per-page builder (`lib/<module>/<page>-export.ts`) turns that loaded data into a serialisable `DashboardExport` object; the page hands it to one shared client button that turns it into CSV and downloads it. No new API route, no new permission check — the file is built from exactly the data (and role gating) the page rendered. Where a page streams part of its data behind `<Suspense>`, the page creates that promise once and passes it to both the streamed section and a suspended export button, so there is still only one scan.

**Tech Stack:** Next.js 16 App Router (RSC), React 19, TypeScript, Vitest (jsdom, `@testing-library/react`), shadcn `Button`, lucide `Download`.

**Spec:** The design approved in chat on 2026-09-11 (Mr Ace: _"do the full version"_) is restated in full under **Design** below — this file is both spec and plan.

## Design

- **Pages in scope (10), admin/oversight views only:**
  - Dashboards: `/attendance`, `/markbook`, `/admissions`, `/records`, `/p-files`, `/evaluation`
  - Insights: `/attendance/insights`, `/markbook/insights`, `/admissions/insights`, `/records/insights`
- **Out of scope:** teacher views of `/markbook`, `/evaluation`, `/attendance` (the adviser dashboard) — no button there. Also out: `/sis`, `/sis/audit-log/overview`, `/records/academic-summary`, `/markbook/awards`, `/attendance/summary`, `/evaluation/comments`, `/admissions/feedback`.
- **Focused views** (`/admissions?status=…`, `/p-files?status=…|expiring=…`) already have a DataTable CSV and are NOT given this button. Only the main view is.
- **File contents, in page order:**
  1. Scope lines: `Page`, `Academic year`, `Date range` (dashboards) / `Compared with` (range or AY), `Exported` (added at click time, Singapore time).
  2. One section per widget the page renders for that viewer: KPI strip → one "Key figures" section (`Figure, This period, Previous period, Change`); each chart → a table of its plotted numbers; each list/table card → its rows as rendered on the card (all tabs of a tabbed card; NOT the drill-sheet's full dataset).
- **Mirror the page exactly.** A widget the page does not render (role-gated, or hidden because it has no data) has no section. A widget that renders an empty state gets a section with its headers and zero rows.
- **Left out on purpose:** the narrative `InsightsPanel` sentences, `RecommendationCallout` text, `PriorityPanel` headline, hero lede, quick links, "recent activity" feeds of audit events (these are navigation/prose, not figures). Student-level drill data stays in the existing drill-sheet downloads.
- **Values:** raw numbers, rounded to the precision the card displays; unit in the header (`Rate (%)`, `Days`), never in the cell. Dates `YYYY-MM-DD`. Missing value = empty cell. Labels in plain English as shown on screen (no table/column/enum names).
- **Filename:** `<module>-<page>-<ayCode>[-<from>_to_<to>].csv` for dashboards, `<module>-insights-<ayCode>[-vs-<compareAy>].csv` for Insights. Lower-case module/page slugs.
- **Button:** `<Button variant="outline" size="sm">` + `Download` icon + text `Export CSV`, placed in `DashboardHero`'s `actions` slot, AFTER any existing primary action (one primary per view — the export is never the primary). Insights pages that don't use `DashboardHero` put it at the right end of their existing hero/header action row.

## Global Constraints

- Hard Rule #7: no raw colours, no `slate-*`/`zinc-*`/`gray-*`; tokens only. The button uses shadcn `Button` defaults — no custom classes beyond icon sizing `size-3.5`.
- Builders live in plain `lib/**` files (no `'use client'`), are pure (no DB, no `Date.now()`), and are called from the page server component. `__tests__/auth/server-calls-client-function.test.ts` must stay green.
- Never add a second call to a loader the page already calls. Reuse the loaded values. For `<Suspense>`-streamed data, share one promise (Task 2 shows how).
- If a chart component computes its plotted data client-side (e.g. "top 5 movers"), move that computation to a pure exported function in `lib/` and have BOTH the chart and the builder call it. The CSV must never re-implement a selection rule.
- Every test file imports vitest globals explicitly: `import { describe, expect, it, vi } from 'vitest'`.
- Run tests with `npx vitest run <paths> --pool=threads --testTimeout=30000`.
- Type check: `npx tsc --noEmit`. If output is suspiciously empty or mentions `.next/dev/types`, `rm -rf .next/dev/types .next/types` and re-run.
- User-visible copy is plain English for school admins (no "payload", "rollup", "RPC", table names).
- Commits: `git add <explicit pathspecs> && git commit -m "…"` as ONE command (other agents share the index). Never bare `git add -A`/`git add .`. End messages with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Don't touch the untracked files in `scripts/backfill/` or `.gitignore`.

---

## Phase 1 — shared core + Attendance (the pattern)

### Task 1: Sectioned CSV builder + shared button

**Files:**

- Modify: `lib/csv.ts`
- Create: `lib/export/dashboard-export.ts`
- Create: `components/dashboard/export-csv-button.tsx`
- Test: `__tests__/export/dashboard-export.test.ts`
- Test: `__tests__/dashboard/export-csv-button.test.tsx`

**Interfaces:**

- Produces:
  - `lib/csv.ts`: `export function toCsvValue(v: unknown): string` (now exported) and `export function buildSectionedCsv(scope: ExportScopeLine[], sections: ExportSection[]): string`
  - `lib/export/dashboard-export.ts`: types `ExportCell`, `ExportScopeLine`, `ExportSection`, `DashboardExport`; helpers `kpiSection`, `dashboardFilename`, `insightsFilename`, `roundTo`
  - `components/dashboard/export-csv-button.tsx`: `ExportCsvButton({ data }: { data: DashboardExport })` and `ExportCsvButtonPending()`

- [ ] **Step 1: Write the failing builder test**

`__tests__/export/dashboard-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildSectionedCsv } from '@/lib/csv';
import {
  dashboardFilename,
  insightsFilename,
  kpiSection,
  roundTo,
} from '@/lib/export/dashboard-export';

const BOM = '﻿';

describe('buildSectionedCsv', () => {
  it('writes scope lines, then each section as title, header, rows, separated by blank lines', () => {
    const csv = buildSectionedCsv(
      [
        ['Page', 'Attendance dashboard'],
        ['Academic year', 'AY2026'],
      ],
      [
        {
          title: 'Key figures',
          headers: ['Figure', 'This period'],
          rows: [['Late incidents', 12]],
        },
        {
          title: 'Daily attendance',
          headers: ['Date', 'Rate (%)'],
          rows: [['2026-08-03', 94.2]],
        },
      ]
    );
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Page,Attendance dashboard',
      'Academic year,AY2026',
      '',
      'Key figures',
      'Figure,This period',
      'Late incidents,12',
      '',
      'Daily attendance',
      'Date,Rate (%)',
      '2026-08-03,94.2',
    ]);
  });

  it('escapes commas, quotes and newlines and leaves null cells empty', () => {
    const csv = buildSectionedCsv(
      [],
      [
        {
          title: 'Sections, all',
          headers: ['Name', 'Note'],
          rows: [
            ['P1 "Joy"', null],
            ['a\nb', 3],
          ],
        },
      ]
    );
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Sections, all"',
      'Name,Note',
      '"P1 ""Joy""",',
      '"a\nb",3',
    ]);
  });

  it('keeps an empty section as title + header so the reader sees it had no rows', () => {
    const csv = buildSectionedCsv(
      [],
      [{ title: 'Over quota', headers: ['Student'], rows: [] }]
    );
    expect(csv.slice(1).split('\r\n')).toEqual(['Over quota', 'Student']);
  });
});

describe('kpiSection', () => {
  it('builds the Key figures section with blank cells for a missing comparison', () => {
    expect(
      kpiSection([
        {
          label: 'Attendance rate (%)',
          current: 94.2,
          previous: 93.1,
          change: 1.1,
        },
        { label: 'Absences', current: 40 },
      ])
    ).toEqual({
      title: 'Key figures',
      headers: ['Figure', 'This period', 'Previous period', 'Change'],
      rows: [
        ['Attendance rate (%)', 94.2, 93.1, 1.1],
        ['Absences', 40, null, null],
      ],
    });
  });
});

describe('filenames', () => {
  it('names dashboard files by module, page, AY and range', () => {
    expect(
      dashboardFilename({
        module: 'attendance',
        ayCode: 'AY2026',
        from: '2026-08-01',
        to: '2026-08-31',
      })
    ).toBe('attendance-dashboard-AY2026-2026-08-01_to_2026-08-31.csv');
    expect(dashboardFilename({ module: 'p-files', ayCode: 'AY2026' })).toBe(
      'p-files-dashboard-AY2026.csv'
    );
  });

  it('names insights files by module, AY and comparison AY', () => {
    expect(
      insightsFilename({
        module: 'records',
        ayCode: 'AY2026',
        compareAy: 'AY2025',
      })
    ).toBe('records-insights-AY2026-vs-AY2025.csv');
    expect(insightsFilename({ module: 'records', ayCode: 'AY2026' })).toBe(
      'records-insights-AY2026.csv'
    );
  });
});

describe('roundTo', () => {
  it('rounds to the given decimals and passes null through', () => {
    expect(roundTo(94.2345, 1)).toBe(94.2);
    expect(roundTo(null, 1)).toBeNull();
    expect(roundTo(undefined, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/export/dashboard-export.test.ts --pool=threads --testTimeout=30000`
Expected: FAIL — `buildSectionedCsv` is not exported / module `@/lib/export/dashboard-export` not found.

- [ ] **Step 3: Implement**

`lib/csv.ts` — export `toCsvValue` (change `function toCsvValue` to `export function toCsvValue`) and append:

```ts
import type {
  ExportScopeLine,
  ExportSection,
} from '@/lib/export/dashboard-export';

/**
 * Several tables in one CSV file: scope lines first, then each section as
 * title row, header row and data rows, with a blank line before each section.
 * CRLF line endings and a UTF-8 BOM so Excel on Windows opens it cleanly.
 */
export function buildSectionedCsv(
  scope: ExportScopeLine[],
  sections: ExportSection[]
): string {
  const lines: string[] = scope.map((pair) => pair.map(toCsvValue).join(','));
  sections.forEach((section, i) => {
    if (lines.length > 0 || i > 0) lines.push('');
    lines.push(toCsvValue(section.title));
    lines.push(section.headers.map(toCsvValue).join(','));
    for (const row of section.rows) lines.push(row.map(toCsvValue).join(','));
  });
  return UTF8_BOM + lines.join('\r\n');
}
```

(Put the `import type` at the top of the file with the other code, not mid-file.)

`lib/export/dashboard-export.ts`:

```ts
// The serialisable shape a dashboard or Insights page hands to
// <ExportCsvButton>. Built on the server by a pure per-page builder from the
// data the page already loaded, so the file always matches the screen.

export type ExportCell = string | number | null;

/** One `label, value` line at the top of the file. */
export type ExportScopeLine = [string, string];

export type ExportSection = {
  title: string;
  headers: string[];
  rows: ExportCell[][];
};

export type DashboardExport = {
  filename: string;
  scope: ExportScopeLine[];
  sections: ExportSection[];
};

export type KpiRow = {
  label: string;
  current: ExportCell;
  previous?: ExportCell;
  change?: ExportCell;
};

export function kpiSection(rows: KpiRow[]): ExportSection {
  return {
    title: 'Key figures',
    headers: ['Figure', 'This period', 'Previous period', 'Change'],
    rows: rows.map((r) => [
      r.label,
      r.current,
      r.previous ?? null,
      r.change ?? null,
    ]),
  };
}

export function roundTo(
  value: number | null | undefined,
  decimals: number
): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function dashboardFilename(input: {
  module: string;
  ayCode: string;
  from?: string | null;
  to?: string | null;
}): string {
  const range = input.from && input.to ? `-${input.from}_to_${input.to}` : '';
  return `${input.module}-dashboard-${input.ayCode}${range}.csv`;
}

export function insightsFilename(input: {
  module: string;
  ayCode: string;
  compareAy?: string | null;
}): string {
  const vs = input.compareAy ? `-vs-${input.compareAy}` : '';
  return `${input.module}-insights-${input.ayCode}${vs}.csv`;
}
```

- [ ] **Step 4: Run the builder test — expect PASS**

Run: `npx vitest run __tests__/export/dashboard-export.test.ts --pool=threads --testTimeout=30000`

- [ ] **Step 5: Write the failing button test**

`__tests__/dashboard/export-csv-button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExportCsvButton,
  ExportCsvButtonPending,
} from '@/components/dashboard/export-csv-button';

afterEach(() => vi.restoreAllMocks());

// jsdom's Blob may not implement .text(); FileReader works everywhere.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('ExportCsvButton', () => {
  it('downloads the sectioned CSV under the given filename, with an Exported line added', async () => {
    const blobs: Blob[] = [];
    const createUrl = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    Object.assign(URL, {
      createObjectURL: createUrl,
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    render(
      <ExportCsvButton
        data={{
          filename: 'attendance-dashboard-AY2026.csv',
          scope: [['Page', 'Attendance dashboard']],
          sections: [
            { title: 'Key figures', headers: ['Figure'], rows: [['Absences']] },
          ],
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('attendance-dashboard-AY2026.csv');
    expect(blobs).toHaveLength(1);
    const text = await readBlob(blobs[0]);
    expect(text).toContain('Page,Attendance dashboard');
    expect(text).toMatch(/Exported,\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(text).toContain('Key figures');
  });

  it('renders a disabled button while the page is still loading', () => {
    render(<ExportCsvButtonPending />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});
```

- [ ] **Step 6: Run it — expect FAIL (module not found)**

Run: `npx vitest run __tests__/dashboard/export-csv-button.test.tsx --pool=threads --testTimeout=30000`

- [ ] **Step 7: Implement the button**

`components/dashboard/export-csv-button.tsx`:

```tsx
'use client';

import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildSectionedCsv } from '@/lib/csv';
import type { DashboardExport } from '@/lib/export/dashboard-export';

// "YYYY-MM-DD HH:mm" in Singapore time, stamped when the file is made rather
// than when the page rendered (a cached page can be minutes old).
function exportedAt(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * Downloads everything a dashboard or Insights page shows as one CSV file.
 * `data` is built on the server by the page's own export builder.
 */
export function ExportCsvButton({ data }: { data: DashboardExport }) {
  function handleExport() {
    const csv = buildSectionedCsv(
      [...data.scope, ['Exported', exportedAt()]],
      data.sections
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}

/** Shown while a page's streamed data is still loading. */
export function ExportCsvButtonPending() {
  return (
    <Button variant="outline" size="sm" disabled>
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}
```

`lib/csv.ts` has no server-only imports, so it is safe to import from a client component. Confirm it stays that way.

- [ ] **Step 8: Run both tests — expect PASS; run tsc**

Run: `npx vitest run __tests__/export/dashboard-export.test.ts __tests__/dashboard/export-csv-button.test.tsx --pool=threads --testTimeout=30000`
Run: `npx tsc --noEmit`

- [ ] **Step 9: Commit**

```bash
git add lib/csv.ts lib/export/dashboard-export.ts components/dashboard/export-csv-button.tsx __tests__/export/dashboard-export.test.ts __tests__/dashboard/export-csv-button.test.tsx && git commit -m "feat(dashboard): sectioned CSV builder and shared Export CSV button"
```

---

### Task 2: Attendance dashboard export

**Files:**

- Create: `lib/attendance/dashboard-export.ts`
- Modify: `app/(attendance)/attendance/page.tsx` (registrar branch only — NOT the `view === 'teacher'` branch)
- Modify: `components/attendance/drills/attendance-drill-section.tsx` (accept a promise)
- Test: `__tests__/attendance/dashboard-export.test.ts`

**Interfaces:**

- Consumes: Task 1's `DashboardExport`, `kpiSection`, `dashboardFilename`, `roundTo`, `ExportCsvButton`, `ExportCsvButtonPending`.
- Produces: `buildAttendanceDashboardExport(input): DashboardExport` in `lib/attendance/dashboard-export.ts`.

**What to enumerate.** Read `app/(attendance)/attendance/page.tsx` and `components/attendance/drills/attendance-drill-section.tsx` top to bottom, plus every card component they render (`components/attendance/drills/*`). Every widget the registrar branch renders gets a section, in render order, subject to the Design rules (skip InsightsPanel, callouts, PriorityPanel, DeclarationsWaitingPanel, trust strip). Today that is: the 4 MetricCards → Key figures; Daily attendance trend (current AND comparison series — include a `Comparison rate (%)` column aligned by position/date exactly as the chart aligns them; read `DailyAttendanceDrillCard` to see how); Excused reasons donut; Day types donut; Attendance by section; Compassionate leave quota list; Vacation leave quota list (only when the page renders it: `vacationTermId && currentTermLabel`); Top absent card (BOTH its tabs — read `TopAbsentDrillCard` for what each tab shows and how many rows). The list above is a starting point, not the authority — the source is. For each card, export exactly the numbers the card renders (after any slicing/sorting the card does); if the card slices/sorts client-side, move that into a pure exported function in `lib/attendance/` used by both card and builder.

- [ ] **Step 1: Write the failing builder test.** Build fixture inputs typed with the real loader return types (`Awaited<ReturnType<typeof getAttendanceKpisRange>>` etc. — import the types, don't redeclare shapes). Assert:
  - `filename === 'attendance-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'`
  - scope contains `['Page', 'Attendance dashboard']`, `['Academic year', 'AY2026']`, `['Date range', '2026-08-01 to 2026-08-31']`, and `['Compared with', '2026-07-01 to 2026-07-31']` when a comparison exists (absent when it doesn't)
  - `sections.map(s => s.title)` equals the exact ordered list of titles you chose, one per widget
  - Key figures row values match the fixture (attendance rate rounded as the card shows it)
  - the vacation-leave section is ABSENT when `vacationTermId` is null
  - the daily trend section is ABSENT when the series has ≤ 1 point (the page hides the card then — `dailySeries.current.length > 1`)
  - one list section's rows equal the fixture rows in the card's display order

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run __tests__/attendance/dashboard-export.test.ts --pool=threads --testTimeout=30000`

- [ ] **Step 3: Implement `buildAttendanceDashboardExport`.** Signature takes one object with: `ayCode`, `rangeInput` (from/to/cmpFrom/cmpTo), `kpis`, `dailySeries`, `exMix`, `dayTypes`, `rowSets` (the `buildAllRowSets` result), `vacationTermId`, `currentTermLabel`, plus anything else a card needs. Pure — no loaders, no dates from the clock.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Wire the page with ONE scan.** In the registrar branch:
  1. Create the promise once, not awaited: `const rowSetsPromise = buildAllRowSets({ ayCode: selectedAy, from: rangeInput.from, to: rangeInput.to, vacationTermId: currentTermId, defaultVlAllowance: schoolConfig.defaultVlAllowancePerTerm });`
  2. Change `AttendanceDrillSection` to take `rowSetsPromise: ReturnType<typeof buildAllRowSets>` instead of the four inputs it used to build it from (keep `ayCode`, `rangeFrom`, `rangeTo`, `vacationTermId`, `currentTermLabel`, `exMix`, `dayTypes` — the cards still need them) and `await rowSetsPromise` where it previously called `buildAllRowSets`. Update its header comment to say the page owns the promise so the export shares the scan.
  3. Add a small async server component in the page file:

```tsx
async function AttendanceExportButton(
  props: Omit<
    Parameters<typeof buildAttendanceDashboardExport>[0],
    'rowSets'
  > & {
    rowSetsPromise: ReturnType<typeof buildAllRowSets>;
  }
) {
  const { rowSetsPromise, ...rest } = props;
  const rowSets = await rowSetsPromise;
  return (
    <ExportCsvButton
      data={buildAttendanceDashboardExport({ ...rest, rowSets })}
    />
  );
}
```

4. In `DashboardHero` `actions`, keep "Mark attendance" first, then:

```tsx
<Suspense fallback={<ExportCsvButtonPending />}>
  <AttendanceExportButton
    rowSetsPromise={rowSetsPromise} /* …the rest of the inputs */
  />
</Suspense>
```

An un-awaited promise that later rejects is still awaited by both consumers, so there is no unhandled rejection; do not add `.catch` that swallows errors.

- [ ] **Step 6: Verify.** `npx tsc --noEmit`; `npx vitest run __tests__/attendance __tests__/auth __tests__/perf __tests__/export __tests__/dashboard --pool=threads --testTimeout=30000`. All green.

- [ ] **Step 7: Commit** — `git add lib/attendance/dashboard-export.ts "app/(attendance)/attendance/page.tsx" components/attendance/drills/attendance-drill-section.tsx __tests__/attendance/dashboard-export.test.ts && git commit -m "feat(attendance): export the dashboard as CSV"` (plus any `lib/attendance/` helper you extracted and the card you pointed at it).

---

### Task 3: Attendance Insights export

**Files:**

- Create: `lib/attendance/insights-export.ts`
- Modify: `app/(attendance)/attendance/insights/page.tsx`
- Test: `__tests__/attendance/insights-export.test.ts`

**Interfaces:**

- Consumes: Task 1 exports.
- Produces: `buildAttendanceInsightsExport(input): DashboardExport`.

**What to enumerate.** Read the page and every component it renders. One section per widget in render order: the MetricCards → Key figures (`Previous period` = the comparison AY's value, `Change` = the delta the card shows, in the card's unit — pp for rates); attendance mix pie; rate per term (one column per AY, headers like `AY2026 rate (%)`, `AY2025 rate (%)`); composition per term; each per-term top-5 absence card (one section per term, titled with the term label); compassionate over-quota list; vacation over/approaching list. Source is the authority over this list. Scope lines: `Page = Attendance insights`, `Academic year`, `Compared with = <compareAy>` when set. No `Date range` line unless the page shows one. Filename via `insightsFilename({ module: 'attendance', ayCode, compareAy })`.

Place the button at the right end of the page's hero/header action row (the page is not required to use `DashboardHero`; if it does, use `actions`). No `<Suspense>` needed unless the page streams data — if it does, follow Task 2's shared-promise pattern.

- [ ] **Step 1: Failing test** — fixture typed from real loader return types; assert filename, scope lines (with and without compareAy), ordered section titles, Key figures values, one per-term section's rows, and that a conditionally-rendered widget's section is absent when the page would hide it.
- [ ] **Step 2: Run — FAIL.** `npx vitest run __tests__/attendance/insights-export.test.ts --pool=threads --testTimeout=30000`
- [ ] **Step 3: Implement the builder** (pure; extract any client-side selection into `lib/attendance/` shared with the chart).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Wire the page;** `npx tsc --noEmit`; `npx vitest run __tests__/attendance __tests__/auth --pool=threads --testTimeout=30000`.
- [ ] **Step 6: Commit** with explicit pathspecs: `feat(attendance): export Insights as CSV`.

### Phase 1 gate

- [ ] Code-reviewer pass over Tasks 1–3 (`superpowers:requesting-code-review`): checks every widget has a section, no second loader call, builders pure, no copied selection logic, copy is plain English.
- [ ] `npx tsc --noEmit` clean; `npx vitest run __tests__/export __tests__/dashboard __tests__/attendance __tests__/auth __tests__/perf __tests__/ui --pool=threads --testTimeout=30000` green.
- [ ] Fix review findings before Phase 2.

---

## Phase 2 — Markbook, Admissions, Records

Each task below follows **exactly** the Task 2 (dashboard) / Task 3 (Insights) recipe: failing builder test with fixtures typed from real loader return types → pure builder → page wiring → tsc + module tests → commit with explicit pathspecs. The enumeration rule is the same: **read the page and every component it renders; one section per rendered widget, in render order, for that viewer's role; the source is the authority over the starting lists given here.**

### Task 4: Markbook dashboard export

**Files:** Create `lib/markbook/dashboard-export.ts`; Modify `app/(markbook)/markbook/page.tsx` (admin branch only, `canSeeAdmin`); Test `__tests__/markbook/dashboard-export.test.ts`.
**Produces:** `buildMarkbookDashboardExport(input): DashboardExport`.
**Starting list:** Key figures (Grades entered, Sheets locked, Change requests pending — with prior values/deltas where the cards show them); Grade entries per day trend; Grade distribution; Publication coverage per term; Change request summary (`ChangeRequestPanel` counts by status + avg decision hours); Sheet readiness per section; Teacher entry velocity. Skip `RecentMarkbookActivity` and quick links. **Teacher view: no button.** Test asserts the builder is only called from the admin branch by asserting section titles; add a test that the page file contains `ExportCsvButton` exactly once.
**Filename:** `markbook-dashboard-<ay>-<from>_to_<to>.csv`.

### Task 5: Markbook Insights export

**Files:** Create `lib/markbook/insights-export.ts`; Modify `app/(markbook)/markbook/insights/page.tsx`; Test `__tests__/markbook/insights-export.test.ts`.
**Produces:** `buildMarkbookInsightsExport(input): DashboardExport`.
**Starting list:** Subject performance per term (the SAME top-5 movers the chart shows); Subjects to watch (lowest 6); Average grade per level + school average; First vs latest term per subject × level (top 6 drops); % sheets locked per term; Change-request Key figures. **These cards select rows inside page-local components** — move each selection rule (top 5 movers, lowest 6, top 6 drops) into pure exported functions in `lib/markbook/insights-compare.ts` / `lib/markbook/insights-level.ts` (whichever already owns the shaping), point the cards at them, and call the same functions from the builder. Add a unit test per extracted function.

### Task 6: Admissions dashboard export

**Files:** Create `lib/admissions/dashboard-export.ts`; Modify `app/(admissions)/admissions/page.tsx` (main view only — not the `?status=` focused view); Test `__tests__/admissions/dashboard-export.test.ts`.
**Produces:** `buildAdmissionsDashboardExport(input): DashboardExport`.
**Starting list:** Key figures (Applications, Enrolled, Conversion, Avg time to enrol); Applications per day; Pipeline by stage; Time to enrol histogram; Assessment outcomes; Applications by level; Document completion by level; Referral sources; the two summary stats (pre-course, feedback rating). **Operational-only widgets** (`isOperational`): `DocumentChaseQueueStrip` tile counts → a "Documents to chase" section; chase `PriorityPanel` excluded (Design rule). The builder takes `isOperational` and the test asserts the chase section is present for `true` and absent for `false`. `UpcomingAyCard`: include its figures if it renders numbers, otherwise skip — decide from source and say which in the commit message.

### Task 7: Admissions Insights export

**Files:** Create `lib/admissions/insights-export.ts`; Modify `app/(admissions)/admissions/insights/page.tsx`; Test `__tests__/admissions/insights-export.test.ts`.
**Produces:** `buildAdmissionsInsightsExport(input): DashboardExport`.
**Starting list:** Key figures (Applications received, Conversion rate, Avg days to enrol — only when the card renders); Applications per month (both AYs); Ratings 1–5; Withdrawn by level; Conversion by assessment outcome; Cancellation reasons + top reason per level; Referral volume; Category mix; Nationality mix; Nationality by level.

### Task 8: Records dashboard export

**Files:** Create `lib/sis/records-dashboard-export.ts`; Modify `app/(records)/records/page.tsx`; Test `__tests__/sis/records-dashboard-export.test.ts`.
**Produces:** `buildRecordsDashboardExport(input): DashboardExport`.
**Starting list:** Key figures (New enrolments, Withdrawals, Active enrolled, Docs expiring ≤60 days); Enrolments per day; Withdrawals per day; Document backlog by document type; Students by level; Expiring documents list (the rows the card shows); **operational only** (`isOperational`, coordinator): Documents to chase tiles, Class assignment readiness. Skip `RecentActivityFeed` and the unsynced-students alert. Test both `isOperational` values.
**Filename module slug:** `records`.

### Task 9: Records Insights export

**Files:** Create `lib/sis/records-insights-export.ts`; Modify `app/(records)/records/insights/page.tsx`; Test `__tests__/sis/records-insights-export.test.ts`.
**Produces:** `buildRecordsInsightsExport(input): DashboardExport`.
**Starting list:** Key figures (Enrolled, Retention rate, Late enrollees); Population by level (only with a comparison AY); Category mix (only with a comparison AY); Nationality mix; Nationality by level; Monthly moves in/out; Retention (or Building history — whichever renders); Late joins by level; Late joins by term; Withdrawal reasons; Attrition. Test asserts the two comparison-only sections are absent with no `compareAy`.

### Phase 2 gate

- [ ] Code-reviewer pass over Tasks 4–9 (same checklist as Phase 1, plus: extracted Markbook selection functions have unit tests and the cards now call them).
- [ ] `npx tsc --noEmit` clean; `npx vitest run __tests__/markbook __tests__/admissions __tests__/sis __tests__/auth __tests__/perf __tests__/export __tests__/dashboard --pool=threads --testTimeout=30000` green.

---

## Phase 3 — P-Files, Evaluation, coverage

### Task 10: P-Files dashboard export

**Files:** Create `lib/p-files/dashboard-export.ts`; Modify `app/(p-files)/p-files/page.tsx` (main view only — not `?status=`/`?expiring=`); Test `__tests__/p-files/dashboard-export.test.ts`.
**Produces:** `buildPFilesDashboardExport(input): DashboardExport`.
**Starting list:** Key figures (Revisions, Expiring ≤30 days, Expiring ≤60 days, Total documents); Summary cards figures; Revisions over time (12 weeks); Completion by level; Document status mix; Expiring documents list (rows the panel shows). **Officer only** (`isOfficer`): Documents to chase tiles. Test both `isOfficer` values. Scope `Date range` line: the range only affects the Revisions figure — say so in the scope as `['Date range (revisions only)', '…']`.

### Task 11: Evaluation dashboard export

**Files:** Create `lib/evaluation/dashboard-export.ts`; Modify `app/(evaluation)/evaluation/page.tsx` (oversight branch only, `canToggle`); Test `__tests__/evaluation/dashboard-export.test.ts`.
**Produces:** `buildEvaluationDashboardExport(input): DashboardExport`.
**Starting list:** Key figures (Submission %, Submitted, Outstanding write-ups, Advisers behind); Submissions per day; Write-ups by section. Skip the 3 hub cards. **Teacher view: no button.**

### Task 12: Coverage guard + docs

**Files:**

- Create: `__tests__/dashboard/export-csv-coverage.test.ts`
- Modify: `docs/context/20-dashboards.md` (new "CSV export" section)
- Modify: `docs/context/16-attendance-module.md`, `15-markbook-module.md`, `12-p-files-module.md`, `13-sis-module.md`, `19-evaluation-module.md`, `08-admission-dashboard.md` — one line each pointing at 20-dashboards.md's section (only where the module doc has a dashboard/insights section)

- [ ] **Step 1: Write the coverage test** (source scan, so a future dashboard page can't ship without the button):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Every module dashboard and Insights page offers "Export CSV" (2026-09-11).
// Adding a page here is how a new dashboard joins the rule.
const PAGES = [
  'app/(attendance)/attendance/page.tsx',
  'app/(attendance)/attendance/insights/page.tsx',
  'app/(markbook)/markbook/page.tsx',
  'app/(markbook)/markbook/insights/page.tsx',
  'app/(admissions)/admissions/page.tsx',
  'app/(admissions)/admissions/insights/page.tsx',
  'app/(records)/records/page.tsx',
  'app/(records)/records/insights/page.tsx',
  'app/(p-files)/p-files/page.tsx',
  'app/(evaluation)/evaluation/page.tsx',
];

describe('dashboard and Insights pages offer CSV export', () => {
  it.each(PAGES)('%s renders ExportCsvButton', (page) => {
    const source = readFileSync(join(process.cwd(), page), 'utf8');
    expect(source).toMatch(/<ExportCsvButton\b|<\w+ExportButton\b/);
  });
});
```

- [ ] **Step 2: Run — PASS** (all tasks done). If any page fails, that task is incomplete — go back.
- [ ] **Step 3: Docs.** In `20-dashboards.md` add a `## CSV export` section: what the file contains, the mirror-the-page rule, the builder location convention (`lib/<module>/<page>-export.ts`), the shared-promise pattern for Suspense, the coverage test, and what is deliberately left out. Plain, short.
- [ ] **Step 4: Commit** with explicit pathspecs: `feat(dashboard): coverage guard and docs for CSV export`.

### Phase 3 gate (final)

- [ ] Final code-reviewer pass over the whole feature diff (`git diff <phase-1-base>..HEAD`).
- [ ] Hand sweep: for each of the 10 pages, open the page source next to its builder and tick every rendered widget off against a section title. Report any widget without a section, with its reason if deliberately excluded.
- [ ] `rm -rf .next/dev/types .next/types && npx tsc --noEmit` clean.
- [ ] Full relevant suites: `npx vitest run __tests__/export __tests__/dashboard __tests__/attendance __tests__/markbook __tests__/admissions __tests__/sis __tests__/p-files __tests__/evaluation __tests__/auth __tests__/perf __tests__/ui --pool=threads --testTimeout=30000` green.
