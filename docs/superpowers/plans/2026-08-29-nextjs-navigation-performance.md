# Next.js Navigation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade to Next.js 16.3 and give every non-exempt route immediate click feedback, so a teacher clicking a link never sees a dead screen.

**Architecture:** Two independent phases. Phase 1 is a version bump with no code changes. Phase 2 adds a `loading.tsx` to each of 36 routes that lack one, locked in by a coverage test in which every exemption carries a written reason — the same idiom as `__tests__/cache/write-route-invalidation.test.ts`, so the list cannot rot. Phase 3 is preparation for a deferred Cache Components migration and is **gated on an explicit decision** (see spec §7).

**Tech Stack:** Next.js 16.3 (App Router), React 19.2.4, TypeScript, Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-nextjs-navigation-performance-findings.md`

## Global Constraints

- **Design system is binding** (`hard-rules.md` #7). Tokens come only from `app/globals.css`. **No** raw `#rrggbb`, `oklch(...)`, `slate-*`, `zinc-*`, `gray-*`, `bg-white`, `bg-black` anywhere in `app/` or `components/`.
- **Skeletons use the two existing primitives only:** `PageShell` from `@/components/ui/page-shell` and `Skeleton` from `@/components/ui/skeleton`. Do not introduce a new skeleton component.
- **Never edit files via PowerShell round-trips or scripts.** PS 5.1 `Get-Content` reads as ANSI and corrupts every em-dash; a Python `open(...,'w')` truncated a 1546-line committed doc to zero. Use the Edit/Write tools for every source change.
- **Always `git pull --rebase origin <branch>` before any push**, manual pushes included.
- Branch: `perf/app-wide-query-pass` is the current branch. Phase 1 should branch fresh from `main` as `perf/next-16-3-upgrade` to keep the version bump reviewable on its own.
- Test command is `npm test` (`vitest run`). A single file: `npx vitest run <path>`.
- ⚠ **~4 test files flake under full-suite load** (`role-permissions-guardrails`, `student-lookup-sheet`, `grading-workbook-secondary-t2`, `data-table-export-sheet`). This is pre-existing. Diagnose with `--testTimeout=30000` first; if it passes with more time it is transform cost, not your change.

---

## Phase 1 — Upgrade to Next.js 16.3

**Gate before Phase 2:** `npm run build` succeeds and `npm test` is green (modulo the four known flakes).

### Task 1: Bump Next.js to 16.3.x

**Files:**

- Modify: `package.json` (the `next` dependency)
- Modify: `package-lock.json` (generated)

**Interfaces:**

- Consumes: nothing.
- Produces: a tree on `next@16.3.x`, where `partialPrefetching` exists as a config option and `experimental.viewTransition` is no longer required for `<ViewTransition>`. Phase 2 does not depend on this, but Phase 3 and the deferred Phase 4 do.

- [ ] **Step 1: Record the current state so the upgrade is reversible**

```bash
git checkout main
git pull --rebase origin main
git checkout -b perf/next-16-3-upgrade
node -p "require('next/package.json').version"
```

Expected: prints `16.2.10`.

- [ ] **Step 2: Confirm the target version exists**

```bash
npm view next@16 version
```

Expected: prints a `16.3.x` version. Use whatever it prints as the target below.

- [ ] **Step 3: Install**

```bash
npm install next@16
```

- [ ] **Step 4: Verify the two config options that motivated the upgrade**

```bash
node -p "require('next/package.json').version"
grep -c "partialPrefetching" node_modules/next/dist/server/config-shared.d.ts
```

Expected: version is `16.3.x`, and the grep count is **greater than 0**. On 16.2.10 that grep returns 0 — that difference is the whole point of this task.

- [ ] **Step 5: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed. If `tsc` reports errors in files you did not touch, check file mtimes — concurrent Claude sessions share this tree.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: green apart from the four known flakes listed in Global Constraints.

- [ ] **Step 7: Smoke-test the app in a browser**

```bash
npm run dev
```

Open `/`, sign in, and visit one page per module: `/markbook`, `/attendance`, `/records`, `/sis/admin`, `/classroom`, `/p-files`, `/admissions`, `/evaluation`. Confirm each renders and the module switcher works.

⚠ **Also test one parent-portal endpoint**, because the proxy is the most fragile thing a Next upgrade can disturb (see `5381bb95`):

```bash
curl -i -X OPTIONS http://localhost:3000/api/parent/v2/declarations \
  -H "Origin: https://portal.hfse.edu.sg" \
  -H "Access-Control-Request-Method: POST"
```

Expected: a `2xx` with CORS headers, **not** a `307`. A 307 here means the matcher lost its `api` exclusion and the portal is broken.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): upgrade Next.js to 16.3

Unlocks partialPrefetching (absent in 16.2.10) and drops the
experimental.viewTransition flag requirement. No code changes."
```

---

## Phase 2 — `loading.tsx` coverage

**Why this phase exists:** 54 of 112 routes have no `loading.tsx`. On those, clicking a link produces **no feedback at all** until the page swaps in. 18 are legitimately exempt (they only redirect, or are the login/print targets), leaving **36 routes** that need one.

**Gate before Phase 3:** the coverage test passes and a browser pass confirms three of the new skeletons appear on click.

### Task 2: The coverage test and its exemption list

Write the test **first**. It fails listing all 36 routes; each later task shrinks that list to zero.

**Files:**

- Create: `__tests__/ui/loading-coverage.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `NO_LOADING_NEEDED`, a `Record<string, string>` keyed by route directory path relative to the repo root (e.g. `'app/(auth)/login'`), whose value is the reason. Tasks 3–10 do not modify this map — they add `loading.tsx` files until the test passes.

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

// EVERY ROUTE EITHER SHOWS SOMETHING ON CLICK OR SAYS WHY IT DOES NOT.
//
// A route with no `loading.tsx` gives the user NOTHING between the click and
// the page arriving — no skeleton, no spinner, no state change at all. Every
// page here is dynamic (KD #35, every page reads the session cookie), so this
// is not a rare cold-start path: it is what a teacher sees every time they
// open a page they have not visited in the last 30 seconds.
//
// ── why a test and not a document ────────────────────────────────────────
//
// A hand-written audit on 2026-07-29 counted "43 of 100 pages, ~14 exempt".
// By 2026-08-29 the app had 112 pages and 54 gaps, and nobody had noticed the
// list had drifted. So the list lives here, where re-running it is free and
// drifting fails the build.
//
// Each exemption carries a REASON, because "renders nothing, so a skeleton
// would be a lie" and "nobody has got to it yet" look identical in a bare
// allowlist — which is exactly how the last list rotted.

const APP_DIR = 'app';

/** A route that legitimately has no loading.tsx, and why. */
const NO_LOADING_NEEDED: Record<string, string> = {
  // ── pure redirects: they render no UI at all, so there is nothing to
  //    skeleton. A loading state here would flash and then bounce. ────────
  'app/(attendance)/attendance/calendar':
    'redirects to the calendar sub-route.',
  'app/(attendance)/attendance/compare': 'redirects to Attendance Insights.',
  'app/(dashboard)/admin': 'redirects to the admin landing.',
  'app/(dashboard)/admin/admissions': 'redirects to the admissions dashboard.',
  'app/(evaluation)/evaluation/compare': 'redirects to Evaluation Insights.',
  'app/(markbook)/markbook/grading/advisory/[id]/comments':
    'redirects to the advisory comments surface.',
  'app/(markbook)/markbook/masterfile':
    'legacy stub — forwards level/class/ay to /records/academic-summary, ' +
    'which is where the Masterfile surface moved.',
  'app/(markbook)/markbook/sections/[id]/attendance':
    'retired surface — redirects to the Classroom attendance tab. It was an ' +
    'unguarded page under the /markbook prefix and was deleted rather than fixed.',
  'app/(markbook)/markbook/sections/[id]/comments':
    'redirects to the Classroom write-ups tab.',
  'app/(p-files)/p-files/compare': 'redirects to P-Files Insights.',
  'app/(records)/records/academic-summary/attendance':
    'redirect stub into the Academic Summary hub.',
  'app/(records)/records/academic-summary/awards':
    'redirect stub into the Academic Summary hub.',
  'app/(records)/records/academic-summary/comments':
    'redirect stub into the Academic Summary hub.',
  'app/(records)/records/students/by-enrolee/[enroleeNumber]':
    'legacy enrolee-number redirect — every path through it ends in a ' +
    'redirect(), either to Records or to Admissions.',
  'app/(sis)/sis/admin/users': 'redirects to the staff directory.',

  // ── not ordinary in-app navigations ──────────────────────────────────────
  'app/(auth)/login':
    'the unauthenticated entry point. There is no session to wait on and no ' +
    'app chrome to skeleton into.',
  'app/(action)/change-requests/act':
    'the logged-out one-click email approve/reject landing (KD #123). It is ' +
    'reached from an email link, not from in-app navigation.',
  'app/(markbook)/markbook/report-cards/section/[sectionId]/print':
    'a print target. A skeleton would land in the printed output.',
};

/** Every directory under app/ that contains a page.tsx. */
function findRouteDirs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(join(full, 'page.tsx'))) found.push(full);
    found.push(...findRouteDirs(full));
  }
  return found;
}

/** Normalise to forward slashes so the keys above are platform-independent. */
function toKey(dir: string): string {
  return relative(process.cwd(), dir).split(sep).join('/');
}

describe('loading.tsx coverage', () => {
  const routeDirs = findRouteDirs(APP_DIR).map(toKey).sort();

  it('finds the app routes at all (guards against a broken walker)', () => {
    expect(routeDirs.length).toBeGreaterThan(100);
  });

  it('every route has a loading.tsx or a written exemption', () => {
    const missing = routeDirs.filter(
      (dir) =>
        !existsSync(join(dir, 'loading.tsx')) && !(dir in NO_LOADING_NEEDED)
    );

    expect(
      missing,
      `These routes give the user no feedback on click. Add a loading.tsx, ` +
        `or add an entry to NO_LOADING_NEEDED explaining why one would be wrong:\n` +
        missing.map((m) => `  - ${m}`).join('\n')
    ).toEqual([]);
  });

  it('has no stale exemptions', () => {
    const stale = Object.keys(NO_LOADING_NEEDED).filter(
      (dir) => !routeDirs.includes(dir)
    );

    expect(
      stale,
      `These exemptions name routes that no longer exist. Delete them:\n` +
        stale.map((s) => `  - ${s}`).join('\n')
    ).toEqual([]);
  });

  it('exempts nothing that also has a loading.tsx', () => {
    const contradictory = Object.keys(NO_LOADING_NEEDED).filter((dir) =>
      existsSync(join(dir, 'loading.tsx'))
    );

    expect(
      contradictory,
      `These routes have a loading.tsx AND an exemption saying they need none. ` +
        `Remove the exemption:\n` +
        contradictory.map((c) => `  - ${c}`).join('\n')
    ).toEqual([]);
  });

  it('gives every exemption a non-trivial reason', () => {
    for (const [dir, reason] of Object.entries(NO_LOADING_NEEDED)) {
      expect(reason.length, `${dir} needs a real reason`).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails with exactly 36 routes**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: FAIL on "every route has a loading.tsx or a written exemption", listing **36** routes. The other four assertions pass. If the count is not 36, the app has changed since this plan was written — reconcile before continuing.

- [ ] **Step 3: Commit the failing test**

```bash
git add __tests__/ui/loading-coverage.test.ts
git commit -m "test(ui): pin loading.tsx coverage, 36 routes currently missing

Every exemption carries a reason so the list cannot rot the way the
2026-07-29 hand audit did."
```

### Task 3: The three skeleton archetypes

Every one of the 36 routes matches one of three shapes. Build them once as copy-sources; there is **no shared component** — `loading.tsx` must default-export a component, and Next requires one file per route.

**Files:**

- Create: `app/(classroom)/classroom/loading.tsx` (the _index_ archetype — a list of cards)
- Create: `app/(sis)/sis/admin/staff/loading.tsx` (the _table_ archetype)
- Create: `app/(classroom)/classroom/[sectionId]/loading.tsx` (the _detail_ archetype — header + tabs + panels)

**Interfaces:**

- Consumes: `PageShell` from `@/components/ui/page-shell`, `Skeleton` from `@/components/ui/skeleton`.
- Produces: three reference files that Tasks 4–10 copy and adjust. No exported symbols beyond each file's `default`.

- [ ] **Step 1: Create the index archetype**

`app/(classroom)/classroom/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Create the table archetype**

`app/(sis)/sis/admin/staff/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="flex flex-wrap gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-md" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>

      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 3: Create the detail archetype**

`app/(classroom)/classroom/[sectionId]/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-32" />

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-12 w-96 max-w-full" />
          <Skeleton className="h-4 w-[26rem] max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-md" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 4: Confirm three routes dropped off the failing list**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **33** routes. `app/(classroom)/classroom`, `app/(classroom)/classroom/[sectionId]` and `app/(sis)/sis/admin/staff` are gone from it.

- [ ] **Step 5: Verify one in a browser**

```bash
npm run dev
```

Sign in, then click into `/classroom` from another page. Confirm a card-grid skeleton appears immediately rather than a blank pause. ⚠ **Automatic prefetching only runs in production**, so in dev the skeleton is easy to see — that is expected, not a bug.

- [ ] **Step 6: Commit**

```bash
git add "app/(classroom)/classroom/loading.tsx" "app/(classroom)/classroom/[sectionId]/loading.tsx" "app/(sis)/sis/admin/staff/loading.tsx"
git commit -m "feat(ui): loading skeletons for the three route archetypes

Index (card grid), table, and detail (header + tabs + panels). The
remaining 33 routes copy one of these."
```

### Task 4: Classroom module — the remaining 7 routes

The whole Classroom module had no `loading.tsx` at all, which made it the largest single cluster.

**Files:**

- Create: `app/(classroom)/classroom/[sectionId]/attendance/loading.tsx` — _table_
- Create: `app/(classroom)/classroom/[sectionId]/discipline/loading.tsx` — _table_
- Create: `app/(classroom)/classroom/[sectionId]/grades/loading.tsx` — _table_
- Create: `app/(classroom)/classroom/[sectionId]/settings/loading.tsx` — _detail_
- Create: `app/(classroom)/classroom/[sectionId]/students/loading.tsx` — _table_
- Create: `app/(classroom)/classroom/[sectionId]/timeline/loading.tsx` — _index_
- Create: `app/(classroom)/classroom/[sectionId]/write-ups/loading.tsx` — _table_

**Interfaces:**

- Consumes: the three archetypes from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create each file by copying its archetype**

For each of the seven, copy the archetype named above verbatim. These sit **inside** the `[sectionId]` layout, which already renders the section header and tab strip, so **delete the `<header>` block and the tab-strip block** from the copied archetype — the layout supplies both, and duplicating them makes the page jump when content arrives.

For example, `app/(classroom)/classroom/[sectionId]/students/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="ml-auto h-9 w-28" />
      </div>

      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
```

Use that exact shape for `attendance`, `discipline`, `grades`, `students` and `write-ups`. For `timeline`, replace the row list with the card grid from the index archetype. For `settings`, use a two-field form shape:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl border border-hairline bg-card p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}
```

⚠ **`PageShell` is not imported in these** — the parent layout already provides the page frame. Importing it again double-pads the content.

- [ ] **Step 2: Confirm the failing list shrank by 7**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **26** routes.

- [ ] **Step 3: Browser-check one nested route**

```bash
npm run dev
```

Open a classroom, then click between the Students and Attendance tabs. Confirm the section header and tab strip **stay put** while only the panel below shows a skeleton. If the header flickers or duplicates, the `<header>` block was not removed from that file.

- [ ] **Step 4: Commit**

```bash
git add "app/(classroom)/classroom/[sectionId]"
git commit -m "feat(ui): loading skeletons for the seven Classroom tabs

Panel-only skeletons — the [sectionId] layout already renders the header
and tab strip, so repeating them made the page jump on arrival."
```

### Task 5: SIS Admin — 8 routes

**Files:**

- Create: `app/(sis)/sis/admin/cover/loading.tsx` — _table_
- Create: `app/(sis)/sis/admin/discount-codes/loading.tsx` — _table_
- Create: `app/(sis)/sis/admin/roles/loading.tsx` — _table_
- Create: `app/(sis)/sis/admin/school-config/loading.tsx` — _detail_
- Create: `app/(sis)/sis/admin/staff/[teacherId]/loading.tsx` — _detail_
- Create: `app/(sis)/sis/admin/staff/accounts/loading.tsx` — _table_
- Create: `app/(sis)/sis/admin/subjects/loading.tsx` — _table_
- Create: `app/(sis)/sis/admin/subjects/secondary/loading.tsx` — _table_

**Interfaces:**

- Consumes: the three archetypes from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create each file from its archetype**

Copy the _table_ archetype verbatim for `cover`, `discount-codes`, `roles`, `staff/accounts`, `subjects` and `subjects/secondary`. Copy the _detail_ archetype verbatim for `school-config` and `staff/[teacherId]`.

⚠ **`subjects` and `subjects/secondary` are two halves of one screen** (primary and secondary), so give them the identical file — a user toggling between them should not see the skeleton change shape.

⚠ **These are top-level SIS Admin pages and DO need `PageShell`** — unlike the Classroom tabs in Task 4, there is no intermediate layout supplying the header here.

- [ ] **Step 2: Confirm the failing list shrank by 8**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **18** routes.

- [ ] **Step 3: Commit**

```bash
git add "app/(sis)/sis/admin"
git commit -m "feat(ui): loading skeletons for eight SIS Admin routes"
```

### Task 6: Remaining SIS routes — 2 routes

**Files:**

- Create: `app/(sis)/sis/audit-log/overview/loading.tsx` — _table_
- Create: `app/(sis)/sis/ay-setup/manage/loading.tsx` — _detail_

**Interfaces:**

- Consumes: the archetypes from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create both files from their archetypes, verbatim, with `PageShell`.**

- [ ] **Step 2: Confirm the list shrank by 2**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, listing **16** routes.

- [ ] **Step 3: Commit**

```bash
git add "app/(sis)/sis/audit-log" "app/(sis)/sis/ay-setup"
git commit -m "feat(ui): loading skeletons for audit-log overview and AY setup"
```

### Task 7: Admissions — 4 routes

**Files:**

- Create: `app/(admissions)/admissions/applications/closed/loading.tsx` — _table_
- Create: `app/(admissions)/admissions/cohorts/pre-course/loading.tsx` — _table_
- Create: `app/(admissions)/admissions/feedback/loading.tsx` — _table_
- Create: `app/(admissions)/admissions/upcoming/applications/loading.tsx` — _table_

**Interfaces:**

- Consumes: the _table_ archetype from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Copy the table archetype verbatim into all four, with `PageShell`.**

- [ ] **Step 2: Confirm the list shrank by 4**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, listing **12** routes.

- [ ] **Step 3: Commit**

```bash
git add "app/(admissions)/admissions"
git commit -m "feat(ui): loading skeletons for four Admissions routes"
```

### Task 8: Attendance and Evaluation — 5 routes

**Files:**

- Create: `app/(attendance)/attendance/[sectionId]/summary/loading.tsx` — _table_
- Create: `app/(attendance)/attendance/import/loading.tsx` — _detail_
- Create: `app/(attendance)/attendance/summary/loading.tsx` — _table_
- Create: `app/(evaluation)/evaluation/comments/loading.tsx` — _table_
- Create: `app/(evaluation)/evaluation/virtue-themes/loading.tsx` — _table_

**Interfaces:**

- Consumes: the archetypes from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Copy each archetype verbatim, with `PageShell`.**

⚠ `attendance/import` is a wizard-shaped upload screen, so use the _detail_ archetype rather than a row list — a twelve-row table skeleton resolving into a file picker is worse than no skeleton.

- [ ] **Step 2: Confirm the list shrank by 5**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, listing **7** routes.

- [ ] **Step 3: Commit**

```bash
git add "app/(attendance)/attendance" "app/(evaluation)/evaluation"
git commit -m "feat(ui): loading skeletons for Attendance and Evaluation routes"
```

### Task 9: Markbook, P-Files, Records — 6 routes

**Files:**

- Create: `app/(markbook)/markbook/awards/loading.tsx` — _table_
- Create: `app/(markbook)/markbook/grading/new/loading.tsx` — _detail_
- Create: `app/(p-files)/p-files/document-validation/applicants/loading.tsx` — _table_
- Create: `app/(p-files)/p-files/document-validation/expiring/loading.tsx` — _table_
- Create: `app/(records)/records/discipline/loading.tsx` — _table_
- Create: `app/(records)/records/level-mismatches/loading.tsx` — _table_

**Interfaces:**

- Consumes: the archetypes from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Copy each archetype verbatim.**

⚠ The two `document-validation` routes sit under a layout that renders the shared tab strip, so **omit `PageShell` and the tab-strip block** in those two, exactly as in Task 4. The other four are top-level and need `PageShell`.

⚠ `markbook/grading/new` is a create form, so use the _detail_ archetype.

- [ ] **Step 2: Confirm the list shrank by 6**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, listing **1** route — `app/(dashboard)/account`.

- [ ] **Step 3: Commit**

```bash
git add "app/(markbook)/markbook" "app/(p-files)/p-files" "app/(records)/records"
git commit -m "feat(ui): loading skeletons for Markbook, P-Files and Records routes"
```

### Task 10: Account, and the test goes green

**Files:**

- Create: `app/(dashboard)/account/loading.tsx` — _detail_

**Interfaces:**

- Consumes: the _detail_ archetype from Task 3.
- Produces: a passing `loading-coverage` test — the deliverable of Phase 2.

- [ ] **Step 1: Create the file from the detail archetype, with `PageShell`.**

- [ ] **Step 2: Run the coverage test and confirm it PASSES**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: **PASS**, all five assertions.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: green apart from the four known flakes.

- [ ] **Step 4: Production build and browser pass**

```bash
npm run build && npm start
```

⚠ **Test in the production build, not dev** — prefetching only runs in production, and the whole point is what a real user sees. Click into five routes that previously had no skeleton, from a different page each time: `/classroom`, `/sis/admin/staff`, `/records/discipline`, `/admissions/feedback`, `/account`. Confirm each shows a skeleton on click rather than a dead screen.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/account/loading.tsx"
git commit -m "feat(ui): loading skeleton for Account, completing coverage

All 112 routes now either show a skeleton on click or carry a written
reason why they should not. __tests__/ui/loading-coverage.test.ts fails
the build if that drifts."
```

---

## Phase 3 — Prerender-blocking dates (⚠ GATED, DO NOT START UNPROMPTED)

🔴 **This phase delivers nothing on its own and must not be executed until Mr Ace answers spec §7.**

`new Date()` in a server component is entirely fine today. It only breaks under
Cache Components, where it throws a build error that `instant = false` does
**not** clear. These five files are the un-deferrable entry fee for a Phase 4
that has not been approved. **If Cache Components is never adopted, leave them
alone.**

### Task 11: Move request-time dates behind `connection()`

**Files:**

- Modify: `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`
- Modify: `app/(markbook)/markbook/grading/page.tsx`
- Modify: `app/(markbook)/markbook/report-cards/page.tsx`
- Modify: `app/(p-files)/p-files/page.tsx`
- Modify: `app/(p-files)/p-files/[enroleeNumber]/page.tsx`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: five pages whose date reads sit inside a `<Suspense>` boundary after `await connection()`, which is the precondition for enabling `cacheComponents` in a future Phase 4.

- [ ] **Step 1: Confirm the five files and the exact call sites**

```bash
grep -n "new Date()\|Date.now()" \
  "app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx" \
  "app/(markbook)/markbook/grading/page.tsx" \
  "app/(markbook)/markbook/report-cards/page.tsx" \
  "app/(p-files)/p-files/page.tsx" \
  "app/(p-files)/p-files/[enroleeNumber]/page.tsx"
```

Expected: a small number of hits per file. Read each in full before changing it — several are "today" used to compute an expiry window or a term, and moving one changes what the page shows.

- [ ] **Step 2: For each call site, extract the date-dependent subtree into a child component wrapped in `<Suspense>`, calling `connection()` first**

The shape, applied per file:

```tsx
import { Suspense } from 'react';
import { connection } from 'next/server';

export default function Page() {
  return (
    <PageShell>
      {/* everything not date-dependent stays here, outside the boundary */}
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <ExpiringPanel />
      </Suspense>
    </PageShell>
  );
}

async function ExpiringPanel() {
  await connection();
  const today = new Date();
  // ...the existing date-dependent work, unchanged
}
```

⚠ **`connection()` must be awaited BEFORE the date call**, not after — it is what tells the prerenderer this subtree is request-time work.

- [ ] **Step 3: Type-check and test**

```bash
npx tsc --noEmit && npm test
```

Expected: both green.

- [ ] **Step 4: Browser-verify each of the five pages still shows the same values**

```bash
npm run dev
```

Open all five and confirm the date-derived figures are unchanged — the 90-day expiring window on P-Files, the term resolution on the grading and report-card pages. ⚠ **A wrong term or window here is silent**, so compare against the values before the change rather than just checking the page renders.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "refactor(perf): push request-time dates behind connection()

Preparation for a possible Cache Components adoption, where a synchronous
new Date() during prerender is a build error that instant=false cannot
defer. No behaviour change."
```

---

## Deferred — not in this plan

> **In one line:** not in the plan are Cache Components (genuinely multi-week,
> and the risky part is 68 dialogs that would start staying open when you
> navigate back), view transitions, and the Server Actions conversation.

- **Phase 4: Cache Components + Partial Prefetching.** 18 layouts restructured, 68 dialog/sheet files audited for the `<Activity>` state-preservation change, route-by-route conversion behind the `cache-components-instant-false` codemod. Multi-week, quiet regression surface. Needs its own plan and its own branch. Vercel ships `next-cache-components-adoption` and `next-partial-prefetching-adoption` skills that work route-by-route.
- **View transitions (`Crossfade` on Suspense reveals).** Worth more _after_ Phase 2, since it animates the handoff into skeletons that must exist first. Needs `::view-transition { pointer-events: none }` or clicks during the animation are lost, and all 9 module layouts have sticky headers that would need anchoring.
- **Server Actions for some WRITE actions.** Raised by Mr Ace on 2026-08-29. His position: traditional API routes are fine as the general architecture — the interest is that **specific write actions** could be Server Actions instead, for **speed**. ⚠ **There is no recorded decision behind the current architecture** — "server action" appears **zero times** across every key-decision file, every context doc and CLAUDE.md, so it was never weighed and rejected; it was defaulted into.

  **The speed argument is real and mechanical.** An API-route write is **two round trips**: `fetch` writes and returns JSON, then the client calls `router.refresh()` before the user sees the change — which is what `useWriteAction` (KD #186) does across all 80 write components. A Server Action is **one**: the mutation and the re-rendered RSC payload come back in the same response. Both trips also pass the claim check in `proxy.ts`, so it is two auth resolutions, not just two network hops.

  **MEASURED 2026-08-30 by an exhaustive sweep of all 88 write endpoints** (detail: two reports written to the session scratchpad; the counts below are the durable part).

  **Almost everything CAN convert — that is not the constraint.** Of 88 write endpoints, only **6** can never be Server Actions: **2 external** (the parent portal's `declarations` and its `/evidence` upload — CORS + Bearer), **3 cron** (`grading-sheets/lock-overdue`, `sis/students/auto-sync`, both `Bearer CRON_SECRET`), and **1 email link** (`change-requests/act`, HMAC-token-only with no session check at all). The remaining **82 are internal**. ⚠ **An earlier draft of this entry said "the parent AND ADMISSIONS portals" — that was wrong. There is no `app/api/admissions-portal/` directory**; only the parent portal has API routes here.

  🔴 **The real constraint is that converting is only WORTH it where the second round trip is felt — and that is four components, not a module.** ⚠ **The two surfaces this entry originally named — attendance marking and mark entry — were asserted without checking, and both are already solved:** `components/attendance/wide-grid.tsx` and `components/grading/score-entry-grid.tsx` are already optimistic with a debounced/coalesced refresh, and `components/attendance/daily-entry.tsx` already bulk-batches to one write per class per day. **Do not scope those.** The genuine candidates:
  1. **Document validation queues** — `components/admissions/document-validation/validation-queue.tsx`, `components/sis/document-validation-actions.tsx`, `components/p-files/document-validation/{awaiting,expiring}-queue.tsx`. 20–30 approve/reject pairs per session and, unlike the grids, **the refresh is NOT debounced** — every decision pays the full second round trip.
  2. **Evaluation write-up roster** — `components/evaluation/writeup-roster-client.tsx`. 20–30 explicit Save/Submit clicks per session, only partial optimistic UI, the user waits per row.

  The sweep found **no** repetitive checklist, reorder or index-assignment surface — those are all once-a-term or once-a-year. Stacks with `useOptimistic`, which would make these feel instant before the round trip lands.

  ⚠ **A convention layer has grown on top of route handlers** — `requireRole()`, `lib/audit/log-action.ts`, `revalidateTag`/`invalidateDrillTags`, JSON errors with machine codes, `410 Gone` tombstones — and a Server Action equivalent would have to rebuild all five. ⚠ **3 routes do real file I/O** (`attendance/import` xlsx, `p-files/[enroleeNumber]/upload` multipart + pdf-merge, `parent/v2/declarations/evidence`) and are poor Server Action fits; two are already cross-origin, so they stay HTTP regardless.

  **Honest scale: a targeted change to ~6 components, not an architecture migration** — and correspondingly smaller payoff than "every write gets faster." Separate project; not scoped, not costed.

- **Unrelated findings from the same sweep, worth their own look.** Not performance work, recorded so they are not lost: **4 write routes have no discoverable client call site** — `compute/quarterly` is a documented script-only escape hatch (KD #154), but `sis/admin/subjects/[configId]/resync`, `sis/admin/subjects/level-offerings` and `students/sync` look dead or never-wired, and one carries a header comment describing a drag-and-drop gesture that exists nowhere in `components/`. Separately, **2 POST routes write nothing** — `grading-sheets/bulk-create/preview` and `sis/students/raw-columns` use POST only to carry a request body.
