# Next.js Navigation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade to Next.js 16.3 and give every non-exempt route immediate click feedback, so a teacher clicking a link never sees a dead screen.

**Architecture:** Four phases; the first three are sequential preparation, the fourth is independent of all of them. Phase 1 is a version bump with no code changes. Phase 2 adds a `loading.tsx` to each of 36 routes that lack one, locked in by a coverage test in which every exemption carries a written reason — the same idiom as `__tests__/cache/write-route-invalidation.test.ts`, so the list cannot rot. Phase 3 is preparation for a deferred Cache Components migration and is **gated on an explicit decision** (see spec §7). Phase 4 converts the two write surfaces where a second network round trip is actually felt — document validation and the evaluation write-up roster, five call sites total — from route handlers to Server Actions, keeping each route handler alive as a thin wrapper over the same shared function the action calls. It has no dependency on Phases 1–3 and is not gated.

**Tech Stack:** Next.js 16.3 (App Router), React 19.2.4, TypeScript, Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-nextjs-navigation-performance-findings.md`

## Global Constraints

- **Design system is binding** (`hard-rules.md` #7). Tokens come only from `app/globals.css`. **No** raw `#rrggbb`, `oklch(...)`, `slate-*`, `zinc-*`, `gray-*`, `bg-white`, `bg-black` anywhere in `app/` or `components/`.
- **Skeletons use the two existing primitives only:** `PageShell` from `@/components/ui/page-shell` and `Skeleton` from `@/components/ui/skeleton`. Do not introduce a new skeleton component.
- **Never edit files via PowerShell round-trips or scripts.** PS 5.1 `Get-Content` reads as ANSI and corrupts every em-dash; a Python `open(...,'w')` truncated a 1546-line committed doc to zero. Use the Edit/Write tools for every source change.
- **Always `git pull --rebase origin <branch>` before any push**, manual pushes included.
- Branch: `perf/app-wide-query-pass` is the current branch. Phase 1 should branch fresh from `main` as `perf/next-16-3-upgrade` to keep the version bump reviewable on its own.
- Test command is `npm test` (`vitest run`). A single file: `npx vitest run <path>`.
- ⚠ **~6 test files flake under full-suite load** (`role-permissions-guardrails`, `student-lookup-sheet`, `grading-workbook-secondary-t2`, `data-table-export-sheet`, and — added 2026-08-30 from the Phase 1 spike — `at-risk-lookup`, `grade-lookup-dialog`). This is pre-existing and **not** upgrade damage: all three lookup-shaped tests passed 44/44 in 9s when run in isolation on 16.3.3. Diagnose with `--testTimeout=30000` first; if it passes with more time it is transform cost, not your change.

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

✅ **THIS TASK WAS RUN AS A SPIKE ON 2026-08-30 AND VERIFIED END TO END** on branch `spike/next-16-3-verify`. `16.3.3` installs, `tsc` reports **zero errors in our own source**, and `npm run build` **exits 0** with the Proxy (Middleware) still compiling. The steps below carry what the spike learned, including three things the original draft of this task did not have. Do not treat the outcome as unknown — treat it as reproducible.

- [ ] **Step 2: Confirm the target version exists**

```bash
npm view next@16 version
```

Expected: prints `16.3.3` (verified 2026-08-30). If npm reports something newer, use that.

- [ ] **Step 3: Install — bump `eslint-config-next` in lockstep**

⚠ **The original draft installed only `next` and staged only `package.json` + `package-lock.json`.** `eslint-config-next` is pinned at `^16.2.10` and must move too, or lint rules drift a minor behind. It will not break the app if left behind, but there is no reason to leave it.

```bash
npm install next@16.3.3 eslint-config-next@16.3.3
```

Expected: installs cleanly. The spike saw `added 105 packages, removed 1, changed 13`, no peer conflicts. **React needs no change** — `19.2.4` already satisfies 16.3.

⚠ **No lockstep bump is needed for anything else.** There are no `@next/*` packages in this repo, and `@types/react`/`@types/react-dom` at `^19` are already compatible.

- [ ] **Step 4: Verify the two config options that motivated the upgrade**

```bash
node -p "require('next/package.json').version"
grep -c "partialPrefetching" node_modules/next/dist/server/config-shared.d.ts
```

Expected: version is `16.3.x`, and the grep count is **greater than 0**. On 16.2.10 that grep returns 0 — that difference is the whole point of this task.

- [ ] **Step 5: DELETE `.next` BEFORE type-checking — this step is not optional**

🔴 **The spike hit this and it looks exactly like the upgrade broke.** A stale `.next/dev/cache/turbopack/v16.2.10` sitting beside freshly generated 16.3.3 types produces six `TS2344` errors in `.next/types/validator.ts` (`Type '"/sis/admin/staff"' is not assignable to type 'LayoutRoutes'`). **They are generated-artifact errors, not source errors.**

```bash
rm -rf .next
npx tsc --noEmit
```

Expected: **zero errors.** ⚠ If `rm -rf .next` reports `Directory not empty`, a dev server is holding files open — **stop it first, and do not kill a process you did not start** (concurrent sessions share this tree). To confirm any surviving errors are artifacts rather than real, filter them:

```bash
npx tsc --noEmit 2>&1 | grep -v "^\.next/" | grep "error"
```

Expected: **no output.** The spike confirmed zero errors in our own source on 16.3.3.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: **exit 0**, and the route table ends with a `ƒ Proxy (Middleware)` line — that line is the cheap proof the proxy still compiles, which is the highest-risk surface in this upgrade.

- [ ] **Step 7: Run the tests, and fix the one real break**

```bash
npm test
```

🔴 **Two perf tests WILL fail, and this is a genuine required change that the 16.3 release post does not name:**

```
TypeError: incrementalCache.generateSimpleCacheKey is not a function
  ❯ node_modules/next/src/server/web/spec-extension/unstable-cache.ts:139
```

Affects `__tests__/perf/unstable-cache-composition.test.ts` and `__tests__/perf/school-config-request-cache.test.ts`. **`unstable_cache` is NOT broken in production** — the tests hand-roll a fake `globalThis.__incrementalCache` (see `unstable-cache-composition.test.ts:68`) and 16.3 now calls a `generateSimpleCacheKey` method the fake does not implement. **Fix: add that method to the mock in both files.** Read Next's `unstable-cache.ts:139` for the expected signature before writing it.

⚠ **Three UI tests may also fail under full-suite load** — `at-risk-lookup`, `grade-lookup-dialog`, `student-lookup-sheet`. These are **pre-existing load flakes, not upgrade damage**: the spike ran all three in isolation and got **44/44 passing in 9s**. Confirm the same way before investigating:

```bash
npx vitest run __tests__/classroom/at-risk-lookup.test.tsx __tests__/grading/grade-lookup-dialog.test.tsx __tests__/attendance/student-lookup-sheet.test.tsx --testTimeout=30000
```

⚠ **`at-risk-lookup` and `grade-lookup-dialog` were NOT on the known-flake list in Global Constraints.** Add them.

- [ ] **Step 8: Smoke-test the app in a browser**

```bash
npm run dev
```

Open `/`, sign in, and visit one page per module: `/markbook`, `/attendance`, `/records`, `/sis/admin`, `/classroom`, `/p-files`, `/admissions`, `/evaluation`. Confirm each renders and the module switcher works.

⚠ **Also test one parent-portal endpoint**, because the proxy is the most fragile thing a Next upgrade can disturb (see `5381bb95`). ✅ **Both checks below were RUN on 16.3.3 during the 2026-08-30 spike and passed.**

🔴 **THE ORIGIN MUST BE ONE THE ALLOWLIST ACTUALLY CONTAINS.** `lib/cors.ts:44` only emits `Access-Control-Allow-Origin` when the origin is in `allowedOrigins` — which is `ADMISSIONS_PORTAL_ORIGIN` (from env) plus `http://localhost:5173`. **An earlier draft of this step used a made-up `https://portal.hfse.edu.sg` and produced a 204 with NO `Access-Control-Allow-Origin` header, which reads exactly like a broken proxy and is not.** Use `http://localhost:5173`.

⚠ **Check the port.** `next dev` falls back to 3001 (or higher) if another dev server holds 3000, and the spike hit exactly that. Read the port off the dev-server output rather than assuming 3000.

```bash
curl -i -X OPTIONS http://localhost:3000/api/parent/v2/declarations \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

Expected — all four of these, exactly as the spike observed:

```
HTTP/1.1 204 No Content
access-control-allow-credentials: true
access-control-allow-headers: Authorization, Content-Type
access-control-allow-methods: GET, POST, OPTIONS
access-control-allow-origin: http://localhost:5173
```

A `307` here means the matcher lost its `api` exclusion and the portal is broken. A `204` **without** `access-control-allow-origin` means your origin is not on the allowlist — check the origin before suspecting the proxy.

Then confirm the page-side gate still redirects:

```bash
curl -s -o /dev/null -w "status=%{http_code} location=%{redirect_url}\n" \
  http://localhost:3000/markbook
```

Expected: `status=307 location=http://localhost:3000/login` (spike-verified).

- [ ] **Step 9: Commit**

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

### Task 3: One reference `loading.tsx` per mode

🔴 **The three-archetype model this task used to describe was wrong.** A verification pass on 2026-08-30 checked all 36 routes against their nearest ancestor layout and found the real split is not "has `PageShell` or doesn't" — it is **three MODES**, and the archetype (what shape the content is: table, detail form, card grid, or something bespoke) is an **independent axis** on top of the mode. Getting the mode wrong makes the page jump the instant real content arrives, which is worse than the blank pause Phase 2 exists to fix.

**The three modes, and the rule for each:**

- **FULL (19 routes)** — the nearest layout renders sidebar/topbar only; the page itself builds everything else. `loading.tsx` needs its own `PageShell` + header skeleton + content skeleton, in full.
- **PANEL_ONLY (11 routes)** — the nearest layout already renders `PageShell` **and** the page header **and** the tab strip. `loading.tsx` must render **only the inner content** — no `PageShell`, no header, no tab strip. Duplicating any of them is what makes the page jump.
- **HYBRID (6 routes)** — the layout renders `<PageShell>{children}</PageShell>` and **nothing else**, deliberately: the header/tabs are pushed down into the page because a layout cannot see `?ay=` or a route param the header needs. So `loading.tsx` must **skip the outer `PageShell`** (the layout still wraps it) but **still build its own header + tab-strip skeleton**, because nothing above the page will.

There is **no shared skeleton component** across any of this — `loading.tsx` must default-export a component, and Next requires one file per route. Every file below is written out in full, even where two files are byte-identical, because a reader who lands on one task without reading another still needs working code.

**Files:**

- Create: `app/(records)/records/discipline/loading.tsx` — **FULL** reference (table archetype: header + 3 stat cards + table, all built by the page itself)
- Create: `app/(classroom)/classroom/[sectionId]/students/loading.tsx` — **PANEL_ONLY** reference (table archetype: only the toolbar + rows, because `app/(classroom)/classroom/[sectionId]/layout.tsx` already renders `PageShell`, the section header and `ClassroomSubnav`)
- Create: `app/(sis)/sis/admin/staff/loading.tsx` — **HYBRID** reference (table archetype: header + tab strip + rows, but no `PageShell`, because `app/(sis)/sis/admin/staff/layout.tsx` renders exactly `<PageShell>{children}</PageShell>` and the page itself renders `StaffDirectoryChrome` = `SisPageHeader` + `PageTabNav`)

All three use the same archetype (table) on purpose — the only variable being demonstrated here is the mode, not the content shape. Tasks 4–10 vary the archetype.

**Interfaces:**

- Consumes: `PageShell` from `@/components/ui/page-shell`, `Skeleton` from `@/components/ui/skeleton`.
- Produces: three reference files. Tasks 4–10 write the remaining 33 files by picking whichever of these three matches a route's mode, then swapping in that route's archetype content.

- [ ] **Step 1: Create the FULL reference**

`app/(records)/records/discipline/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

// FULL mode reference. app/(records)/layout.tsx renders only the sidebar
// and topbar — this page builds its own PageShell, header and content, so
// this file has to build all three too. Copy this shape whenever the
// coverage table in the Phase 2 plan marks a route FULL.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
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

- [ ] **Step 2: Create the PANEL_ONLY reference**

`app/(classroom)/classroom/[sectionId]/students/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

// PANEL_ONLY mode reference. app/(classroom)/classroom/[sectionId]/layout.tsx
// already renders PageShell, the section header (back link, class name,
// badges) and ClassroomSubnav (the tab strip) around {children}. This file
// renders ONLY the inner content — no PageShell, no header, no tab strip.
// Duplicating any of them is what makes the page jump when the real
// content arrives.
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

- [ ] **Step 3: Create the HYBRID reference**

`app/(sis)/sis/admin/staff/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

// HYBRID mode reference. app/(sis)/sis/admin/staff/layout.tsx renders
// exactly `<PageShell>{children}</PageShell>` and nothing else — the header
// and tab strip live in the PAGE (StaffDirectoryChrome = SisPageHeader +
// PageTabNav), because a layout cannot see `?ay=` or the route's own
// params. So this file SKIPS the outer PageShell (the layout still
// supplies it) but STILL builds its own header + tab-strip skeleton, or
// the page jumps from "no header at all" to "header + tabs" on arrival.
export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="flex flex-wrap gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 2 }).map((_, i) => (
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
    </div>
  );
}
```

- [ ] **Step 4: Confirm three routes dropped off the failing list**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **33** routes. `app/(records)/records/discipline`, `app/(classroom)/classroom/[sectionId]/students` and `app/(sis)/sis/admin/staff` are gone from it.

- [ ] **Step 5: Verify all three modes in a browser**

```bash
npm run dev
```

Sign in, then: (1) click into `/records/discipline` from another page — a full header + stat cards + table skeleton should appear immediately; (2) open a classroom and click into Students — the section header and tab strip must **stay put**, only the row list should skeleton; (3) open `/sis/admin/staff` — the page's own header and tab strip should skeleton in, not just rows. ⚠ **Automatic prefetching only runs in production**, so in dev the skeleton is easy to see — that is expected, not a bug.

- [ ] **Step 6: Commit**

```bash
git add "app/(records)/records/discipline/loading.tsx" "app/(classroom)/classroom/[sectionId]/students/loading.tsx" "app/(sis)/sis/admin/staff/loading.tsx"
git commit -m "feat(ui): loading skeletons for the three route modes

FULL, PANEL_ONLY, HYBRID — the axis that actually varies is what the
nearest layout already renders, not the content shape. The remaining 33
routes pick one of these three and swap in their own archetype."
```

### Task 4: Classroom module — the remaining 8 routes

The whole Classroom module had no `loading.tsx` at all, which made it the largest single cluster. It mixes modes: the module index is FULL, every tab under `[sectionId]` is PANEL_ONLY.

**Files:**

- Create: `app/(classroom)/classroom/loading.tsx` — **FULL**, table (list table + 2 stat cards + cover panel)
- Create: `app/(classroom)/classroom/[sectionId]/loading.tsx` — **PANEL_ONLY**, cards (overview stat cards + health panel)
- Create: `app/(classroom)/classroom/[sectionId]/attendance/loading.tsx` — **PANEL_ONLY**, detail (one summary card)
- Create: `app/(classroom)/classroom/[sectionId]/discipline/loading.tsx` — **PANEL_ONLY**, table
- Create: `app/(classroom)/classroom/[sectionId]/grades/loading.tsx` — **PANEL_ONLY**, table
- Create: `app/(classroom)/classroom/[sectionId]/settings/loading.tsx` — **PANEL_ONLY**, detail (one form card)
- Create: `app/(classroom)/classroom/[sectionId]/timeline/loading.tsx` — **PANEL_ONLY**, other (activity feed, not a table)
- Create: `app/(classroom)/classroom/[sectionId]/write-ups/loading.tsx` — **PANEL_ONLY**, table

**Interfaces:**

- Consumes: the FULL and PANEL_ONLY references from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create the module index (FULL, table)**

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-40 w-full rounded-xl" />
    </PageShell>
  );
}
```

- [ ] **Step 2: Create the seven PANEL_ONLY tabs**

⚠ **None of these import `PageShell`** — `app/(classroom)/classroom/[sectionId]/layout.tsx` already renders it, the section header, and `ClassroomSubnav` (the tab strip) around `{children}`. Importing any of that again double-pads the page and makes the header/tabs flicker on arrival.

`app/(classroom)/classroom/[sectionId]/loading.tsx` (the Overview tab — stat cards + health panel):

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
```

`app/(classroom)/classroom/[sectionId]/attendance/loading.tsx` (one summary card):

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-[380px] rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
```

`app/(classroom)/classroom/[sectionId]/discipline/loading.tsx`:

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

`app/(classroom)/classroom/[sectionId]/grades/loading.tsx` (identical shape to `discipline`, written out in full since it is its own file):

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

`app/(classroom)/classroom/[sectionId]/settings/loading.tsx` (one form card):

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

`app/(classroom)/classroom/[sectionId]/timeline/loading.tsx` (activity feed — not a table, so no header row and no aligned columns):

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border border-hairline bg-card p-4"
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}
```

`app/(classroom)/classroom/[sectionId]/write-ups/loading.tsx` (same table shape as `discipline`/`grades`, plus its own file since a Term-4 branch on the real page renders a message instead — the loading state doesn't need to anticipate that, it only covers the normal case):

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

- [ ] **Step 3: Confirm the failing list shrank by 8**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **25** routes.

- [ ] **Step 4: Browser-check one nested route**

```bash
npm run dev
```

Open a classroom, then click between the Students and Attendance tabs. Confirm the section header and tab strip **stay put** while only the panel below shows a skeleton. If the header flickers or duplicates, `PageShell` or the header markup was not removed from that file.

- [ ] **Step 5: Commit**

```bash
git add "app/(classroom)/classroom/loading.tsx" "app/(classroom)/classroom/[sectionId]"
git commit -m "feat(ui): loading skeletons for the eight remaining Classroom routes

The module index is FULL; every [sectionId] tab is PANEL_ONLY — the
layout already renders the header and tab strip, so repeating them
would make the page jump on arrival."
```

### Task 5: SIS Admin — the remaining 4 HYBRID routes

**Files:**

- Create: `app/(sis)/sis/admin/staff/[teacherId]/loading.tsx` — **HYBRID**, table (renders `SisPageHeader` directly, no tabs; the page's own root is a plain `<div className="space-y-4">`)
- Create: `app/(sis)/sis/admin/staff/accounts/loading.tsx` — **HYBRID**, table (same `StaffDirectoryChrome` as the Task 3 reference)
- Create: `app/(sis)/sis/admin/subjects/loading.tsx` — **HYBRID**, table (`SubjectSetupView` renders `SisPageHeader` + `PageTabNav` itself)
- Create: `app/(sis)/sis/admin/subjects/secondary/loading.tsx` — **HYBRID**, table (the same shared `SubjectSetupView`)

**Interfaces:**

- Consumes: the HYBRID reference from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create the teacher detail page (no tab strip)**

`app/(sis)/sis/admin/staff/[teacherId]/loading.tsx` — this one differs from the Task 3 reference: the real page has no tab strip, just `SisPageHeader` over a plain `<div className="space-y-4">`, so the skeleton must not invent tabs that will never render:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

// HYBRID, no tab strip — app/(sis)/sis/admin/staff/layout.tsx supplies only
// PageShell; this page renders SisPageHeader directly over a plain
// `space-y-4` div, unlike its siblings which also render PageTabNav.
export default function Loading() {
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
      </header>

      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the three routes that share the Task 3 reference shape verbatim**

`app/(sis)/sis/admin/staff/accounts/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="flex flex-wrap gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 2 }).map((_, i) => (
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
    </div>
  );
}
```

⚠ **`subjects` and `subjects/secondary` are two halves of one screen** (primary and secondary levels sharing `SubjectSetupView`), so give them the byte-identical file — a user toggling between them must not see the skeleton change shape.

`app/(sis)/sis/admin/subjects/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="flex flex-wrap gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 2 }).map((_, i) => (
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
    </div>
  );
}
```

`app/(sis)/sis/admin/subjects/secondary/loading.tsx` (byte-identical to the file above):

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="flex flex-wrap gap-2 border-b border-hairline pb-2">
        {Array.from({ length: 2 }).map((_, i) => (
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
    </div>
  );
}
```

- [ ] **Step 3: Confirm the failing list shrank by 4**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **21** routes.

- [ ] **Step 4: Commit**

```bash
git add "app/(sis)/sis/admin/staff/[teacherId]" "app/(sis)/sis/admin/staff/accounts" "app/(sis)/sis/admin/subjects"
git commit -m "feat(ui): loading skeletons for four HYBRID SIS Admin routes

All four skip the outer PageShell (their layout already supplies it) and
build their own header — three share PageTabNav, the teacher detail page
does not."
```

### Task 6: The rest of SIS — 6 routes

The remaining SIS routes split three ways: four top-level FULL pages under Admin, one HYBRID page under AY setup, and one PANEL_ONLY page under the audit log.

**Files:**

- Create: `app/(sis)/sis/admin/cover/loading.tsx` — **FULL**, other (`CoverBoardView` — a board grouped by absent teacher, not a table)
- Create: `app/(sis)/sis/admin/discount-codes/loading.tsx` — **FULL**, table (5 stat tiles above)
- Create: `app/(sis)/sis/admin/roles/loading.tsx` — **FULL**, other (role × capability matrix)
- Create: `app/(sis)/sis/admin/school-config/loading.tsx` — **FULL**, detail (form + risk banner)
- Create: `app/(sis)/sis/ay-setup/manage/loading.tsx` — **HYBRID**, table (page renders `AySetupHeader` itself; the existing parent `loading.tsx` at `app/(sis)/sis/ay-setup/loading.tsx` is wrong-shaped for this route and must not be relied on)
- Create: `app/(sis)/sis/audit-log/overview/loading.tsx` — **PANEL_ONLY**, cards

**Interfaces:**

- Consumes: the FULL, HYBRID and PANEL_ONLY references from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create the cover board skeleton**

⚠ **Read `components/relief/cover-board-view.tsx` before committing this file.** It groups by the absent teacher, not by class (see the "Relief cover carries START and END dates" note in CLAUDE.md) — this is a best-guess board shape; adjust the row/card counts to match what actually renders before treating this step as done.

`app/(sis)/sis/admin/cover/loading.tsx`:

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
        <Skeleton className="h-9 w-40" />
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>

      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-xl border border-hairline bg-card p-4"
          >
            <Skeleton className="h-4 w-48" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, j) => (
                <Skeleton key={j} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Create the discount codes skeleton (5 stat tiles above the table)**

`app/(sis)/sis/admin/discount-codes/loading.tsx`:

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
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

- [ ] **Step 3: Create the role × capability matrix skeleton**

⚠ **Read `components/sis/role-permissions-editor.tsx` before committing** — this skeleton hardcodes 6 role columns as a best guess; match it to the actual `ROLES` count.

`app/(sis)/sis/admin/roles/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <Skeleton className="h-20 w-full rounded-xl" />

      <div className="overflow-hidden rounded-xl border border-hairline">
        <div className="flex items-center gap-3 border-b border-hairline bg-muted/40 px-4 py-3">
          <Skeleton className="h-4 w-32" />
          <div className="ml-auto flex gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-16" />
            ))}
          </div>
        </div>
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-40" />
            <div className="ml-auto flex gap-6">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-4 rounded-sm" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 4: Create the school config skeleton (form + risk banner)**

`app/(sis)/sis/admin/school-config/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <Skeleton className="h-16 w-full rounded-xl" />

      <div className="space-y-4 rounded-xl border border-hairline bg-card p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-32" />
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 5: Create the AY setup manage skeleton (HYBRID — do not reuse the existing parent `loading.tsx`)**

`app/(sis)/sis/ay-setup/layout.tsx` renders exactly `<PageShell>{children}</PageShell>`, same as staff's layout. The file at `app/(sis)/sis/ay-setup/loading.tsx` already exists for the sibling index page and is two large skeleton blocks with no header or table shape — it is the wrong fallback for `/manage`, which renders its own `AySetupHeader` over a data table. `manage/loading.tsx` overrides it for this route specifically.

`app/(sis)/sis/ay-setup/manage/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create the audit log overview skeleton (PANEL_ONLY, cards)**

`app/(sis)/sis/audit-log/overview/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Confirm the failing list shrank by 6**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **15** routes.

- [ ] **Step 8: Commit**

```bash
git add "app/(sis)/sis/admin/cover" "app/(sis)/sis/admin/discount-codes" "app/(sis)/sis/admin/roles" "app/(sis)/sis/admin/school-config" "app/(sis)/sis/ay-setup/manage" "app/(sis)/sis/audit-log/overview"
git commit -m "feat(ui): loading skeletons for the rest of SIS

Four FULL admin pages, one HYBRID (ay-setup/manage, which does NOT
inherit its parent's mismatched loading.tsx), one PANEL_ONLY (audit-log
overview)."
```

### Task 7: Admissions — 4 routes

All four are FULL and all four are table-shaped.

**Files:**

- Create: `app/(admissions)/admissions/applications/closed/loading.tsx` — **FULL**, table (AY switcher + reason chips above)
- Create: `app/(admissions)/admissions/cohorts/pre-course/loading.tsx` — **FULL**, table (the real page delegates its shell to `CohortPageShell`, which itself renders `PageShell` + header — this file still imports `PageShell` directly, since that's the only shell primitive `loading.tsx` is allowed to use)
- Create: `app/(admissions)/admissions/feedback/loading.tsx` — **FULL**, table (3 stat cards above)
- Create: `app/(admissions)/admissions/upcoming/applications/loading.tsx` — **FULL**, table (the real page has a "no upcoming AY" empty-state branch; the loading state only needs to cover the normal case)

**Interfaces:**

- Consumes: the FULL reference from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create the closed applications skeleton (AY switcher + reason chips)**

`app/(admissions)/admissions/applications/closed/loading.tsx`:

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

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-full" />
        ))}
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

- [ ] **Step 2: Create the pre-course cohort skeleton**

`app/(admissions)/admissions/cohorts/pre-course/loading.tsx`:

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

- [ ] **Step 3: Create the feedback skeleton (3 stat cards above)**

`app/(admissions)/admissions/feedback/loading.tsx`:

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
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

- [ ] **Step 4: Create the upcoming applications skeleton**

`app/(admissions)/admissions/upcoming/applications/loading.tsx`:

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

- [ ] **Step 5: Confirm the failing list shrank by 4**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **11** routes.

- [ ] **Step 6: Commit**

```bash
git add "app/(admissions)/admissions/applications/closed" "app/(admissions)/admissions/cohorts/pre-course" "app/(admissions)/admissions/feedback" "app/(admissions)/admissions/upcoming/applications"
git commit -m "feat(ui): loading skeletons for four Admissions routes"
```

### Task 8: Attendance and Evaluation — 5 routes

All five are FULL. Two — `attendance/summary` and `evaluation/comments` — are the exception the mode table flags explicitly: their own page root is a bare `<div className="space-y-6">`, not `PageShell`, and the skeleton must mirror that rather than introduce padding the real page never has.

**Files:**

- Create: `app/(attendance)/attendance/[sectionId]/summary/loading.tsx` — **FULL**, table ("no calendar configured" empty branch on the real page; the loading state only covers the normal case)
- Create: `app/(attendance)/attendance/import/loading.tsx` — **FULL**, detail (single form in a card)
- Create: `app/(attendance)/attendance/summary/loading.tsx` — **FULL**, table, ⚠ bare `<div>` root, not `PageShell`
- Create: `app/(evaluation)/evaluation/comments/loading.tsx` — **FULL**, table, ⚠ bare `<div>` root, not `PageShell`
- Create: `app/(evaluation)/evaluation/virtue-themes/loading.tsx` — **FULL**, detail (editor, T1–T3)

**Interfaces:**

- Consumes: the FULL reference from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create the section attendance summary skeleton**

`app/(attendance)/attendance/[sectionId]/summary/loading.tsx`:

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

- [ ] **Step 2: Create the import wizard skeleton**

⚠ This is a wizard-shaped upload screen, so use the detail archetype rather than a row list — a twelve-row table skeleton resolving into a file picker is worse than no skeleton.

`app/(attendance)/attendance/import/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <div className="space-y-4 rounded-xl border border-hairline bg-card p-6">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-40 w-full rounded-lg border border-dashed border-hairline" />
        <Skeleton className="h-9 w-32" />
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 3: Create the attendance summary skeleton — bare `<div>` root, no `PageShell`**

`app/(attendance)/attendance/summary/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

// ⚠ This page's own root is a bare `<div className="space-y-6">`, not
// PageShell (it deliberately mirrors markbook/awards's shape rather than
// adopting PageShell — see the header comment in page.tsx). Mirror that
// here; wrapping in PageShell would double the outer padding.
export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

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

- [ ] **Step 4: Create the evaluation comments skeleton — bare `<div>` root, no `PageShell`**

`app/(evaluation)/evaluation/comments/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';

// ⚠ Same shape family as app/(markbook)/markbook/awards/page.tsx and
// app/(attendance)/attendance/summary/page.tsx (see that file's own header
// comment) — a bare `<div className="space-y-6">` root, not PageShell.
export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </header>

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

- [ ] **Step 5: Create the virtue themes editor skeleton (T1–T3)**

`app/(evaluation)/evaluation/virtue-themes/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-hairline bg-card p-6"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 6: Confirm the failing list shrank by 5**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **6** routes.

- [ ] **Step 7: Commit**

```bash
git add "app/(attendance)/attendance/[sectionId]/summary" "app/(attendance)/attendance/import" "app/(attendance)/attendance/summary" "app/(evaluation)/evaluation/comments" "app/(evaluation)/evaluation/virtue-themes"
git commit -m "feat(ui): loading skeletons for Attendance and Evaluation routes

Two of the five mirror their page's bare div root instead of PageShell —
copying PageShell in blind would have added padding the real page
never has."
```

### Task 9: Markbook and P-Files — 4 routes

**Files:**

- Create: `app/(markbook)/markbook/awards/loading.tsx` — **FULL**, other (filter bar + level-breakdown dashboard, not a table)
- Create: `app/(markbook)/markbook/grading/new/loading.tsx` — **FULL**, detail (multi-field create form)
- Create: `app/(p-files)/p-files/document-validation/applicants/loading.tsx` — **PANEL_ONLY**, table
- Create: `app/(p-files)/p-files/document-validation/expiring/loading.tsx` — **PANEL_ONLY**, table

**Interfaces:**

- Consumes: the FULL and PANEL_ONLY references from Task 3.
- Produces: nothing other than the files.

- [ ] **Step 1: Create the awards dashboard skeleton**

`app/(markbook)/markbook/awards/loading.tsx`:

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
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-36" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Create the grading create-form skeleton**

`app/(markbook)/markbook/grading/new/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <Skeleton className="h-4 w-32" />

      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <div className="space-y-4 rounded-xl border border-hairline bg-card p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-32" />
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 3: Create the two document-validation queue skeletons**

⚠ **These sit under a layout that already renders the shared tab strip** — same rule as the Classroom tabs in Task 4: no `PageShell`, no header, no tab strip in either file.

`app/(p-files)/p-files/document-validation/applicants/loading.tsx`:

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

`app/(p-files)/p-files/document-validation/expiring/loading.tsx` (same shape, its own file):

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

- [ ] **Step 4: Confirm the failing list shrank by 4**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: still FAIL, now listing **2** routes — `app/(records)/records/level-mismatches` and `app/(dashboard)/account`.

- [ ] **Step 5: Commit**

```bash
git add "app/(markbook)/markbook/awards" "app/(markbook)/markbook/grading/new" "app/(p-files)/p-files/document-validation"
git commit -m "feat(ui): loading skeletons for Markbook and P-Files routes"
```

### Task 10: Records and Account — the test goes green

**Files:**

- Create: `app/(records)/records/level-mismatches/loading.tsx` — **FULL**, table (1 card above)
- Create: `app/(dashboard)/account/loading.tsx` — **FULL**, cards (asymmetric 300px/1fr card grid)

**Interfaces:**

- Consumes: the FULL reference from Task 3.
- Produces: a passing `loading-coverage` test — the deliverable of Phase 2.

- [ ] **Step 1: Create the level mismatches skeleton (1 card above the table)**

`app/(records)/records/level-mismatches/loading.tsx`:

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

      <Skeleton className="h-24 w-full rounded-xl" />

      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Create the account skeleton (asymmetric 300px/1fr card grid)**

`app/(dashboard)/account/loading.tsx`:

```tsx
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <header className="space-y-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 3: Run the coverage test and confirm it PASSES**

```bash
npx vitest run __tests__/ui/loading-coverage.test.ts
```

Expected: **PASS**, all five assertions. This is the last of the 36 routes — the count should be **0**.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: green apart from the four known flakes.

- [ ] **Step 5: Production build and browser pass**

```bash
npm run build && npm start
```

⚠ **Test in the production build, not dev** — prefetching only runs in production, and the whole point is what a real user sees. Click into six routes covering all three modes, from a different page each time: `/records/discipline` (FULL), `/classroom/[a real sectionId]/students` (PANEL_ONLY), `/sis/admin/staff` (HYBRID), `/sis/admin/cover` (FULL, other), `/admissions/feedback` (FULL, table), `/account` (FULL, cards). Confirm each shows a skeleton on click rather than a dead screen, and that the PANEL_ONLY and HYBRID routes do **not** show the header/tabs jump described in Task 3.

- [ ] **Step 6: Commit**

```bash
git add "app/(records)/records/level-mismatches" "app/(dashboard)/account/loading.tsx"
git commit -m "feat(ui): loading skeletons for Records and Account, completing coverage

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

## Phase 4 — Server Actions for the high-frequency write surfaces

**This is a targeted change to five call sites across two routes, not an architecture migration.** The other ~80 internal write routes (`requireRole`/`requireAnyCapability` + zod + `logAction` + `revalidateTag`/`invalidateDrillTags`, the convention documented in `docs/context/07-api-routes.md`) stay exactly as they are — route handlers, called via `apiFetch`/`useMutation`, wrapped in `useWriteAction` (KD #186). Nothing here proposes moving them.

**Why these two surfaces and not others.** A sweep of all 88 write endpoints (2026-08-30, recorded in the now-updated Deferred entry below) found the second round trip is only _felt_ where a user does 20–30 writes in one sitting **and** the refresh is not debounced or batched — so every decision pays the full cost. Two surfaces match: the document-validation queues (approve/reject, 20–30 pairs per session) and the evaluation write-up roster (Save/Submit, 20–30 clicks per session). ⚠ **Explicitly out of scope, and must not be converted in this phase:** `components/attendance/wide-grid.tsx` and `components/grading/score-entry-grid.tsx` are already optimistic with a debounced/coalesced refresh, and `components/attendance/daily-entry.tsx` already bulk-batches to one write per class per day — none of the three would gain anything, and score-entry-grid.tsx is Tier-3 autosave (a pending toast per keystroke would be a regression, per `__tests__/ui/write-feedback-coverage.test.ts`'s own exemption for it).

**The five call sites, verified by reading every one of them rather than trusting the earlier grep that first raised this** (that grep undercounted by one and overcounted by one — see the corrected Deferred entry at the bottom of this file):

1. `components/admissions/document-validation/validation-queue.tsx`
2. `components/sis/document-validation-actions.tsx`
3. `components/p-files/document-validation/awaiting-queue.tsx`
4. `components/p-files/document-card.tsx` (the P-Files single-student detail card — has its own approve/reject pair, independent of the three queue components above)
5. `components/evaluation/writeup-roster-client.tsx`

All five against exactly two routes: `PATCH /api/sis/students/[enroleeNumber]/document/[slotKey]` (call sites 1–4) and `PATCH /api/evaluation/writeups` (call site 5). ⚠ **`components/p-files/document-validation/expiring-queue.tsx` does NOT call the document route and must not be touched** — its only write is `NotifyButton` → `POST /api/p-files/[enroleeNumber]/notify`, a reminder email on a different route entirely. It renders a "Notify" button and a "View profile" link, no Approve/Reject. If a future pass reaches for it expecting symmetry with `awaiting-queue.tsx`, that symmetry does not exist in the code.

**What ports unchanged, what needs new work.** Four of five route conventions work inside a Server Action with zero code change: `requireRole`/`requireAnyCapability` read the session via `cookies()` from `next/headers`, which works identically in a Server Action; zod's `.safeParse()` has no HTTP dependency; `logAction` takes a service client plus plain data; `revalidateTag`/`invalidateDrillTags` are _better_-supported in a Server Action than in a route handler — it is Next's own documented "mutate then invalidate" pattern. **The one real seam is the error shape.** A route handler answers `NextResponse.json({error, code}, {status})` at every branch; a Server Action has no status code and no `Response` object — it returns a JS value or throws, and Next strips thrown error messages in production builds by default. So every error branch in both routes becomes a value in a new `ActionResult<T>` union (Task 12) instead of a thrown exception, which is also what keeps the route-specific `code` discriminants (`enrolled_documents_pfiles_only`, `expired_document`) intact instead of collapsing to one generic message — the exact thing KD #24 forbids.

**The proxy has one real edge case, and the mitigation is two independent, additive changes — Tasks 13 and 12's `withAuthAction` wrapper are the two halves.** `proxy.ts`'s matcher excludes `api` but **not pages**, and a Server Action from a Client Component POSTs to the _current page's own URL_ — there is no separate action endpoint. So every `/sis/*`, `/evaluation/*`, `/admissions/*`, `/p-files/*` page load already runs through `updateSession()` on every request, **including a Server Action POST**, because it is the same HTTP request to the same pathname the proxy already matches. For a signed-in staff member with the wrong capability this changes nothing — the route's own capability check still runs and answers cleanly (a normal `ActionResult{ok:false}`, handled in Task 12). The one genuine gap is a session that expires (or a role that changes) _between page load and the action firing_: `updateSession()` answers with `NextResponse.redirect()` — a plain 307 with a `Location` header and no body — and the browser's `fetch()` (which `fetchServerAction()` calls with the WHATWG default `redirect:'follow'`) automatically re-POSTs the redirect target carrying the _same_ `next-action` header and body, because 307/308 preserve method and body. That second request lands on `/login` (or `/`), which has no Server Action matching that id, and Next's own action-handler answers 404 with `x-nextjs-action-not-found: 1` — the client throws `UnrecognizedActionError` ("Server Action … was not found on the server"), the URL bar never changes, and the user is left looking at a stale form with a confusing error instead of being sent to `/login`. Task 13 fixes this at the proxy: detect a `POST` carrying a `next-action` header and answer with a plain-text 4xx instead of a redirect — which lands exactly on the one graceful path `fetchServerAction()` already implements (a `status >= 400` response with `content-type: text/plain` becomes the thrown `Error`'s message, no second round trip, no matcher change). Task 12's `withAuthAction` is the _other_, independent half Next's own docs call for regardless of the proxy ("A page-level authentication check does not extend to the Server Actions defined within it. Always re-verify inside the action.") — it covers a direct POST that bypasses the UI entirely, a future matcher change, and resource-level authorization the coarse page-level gate can't see. Neither change alone is the whole story; both are additive and neither touches an existing GET/navigation code path.

**No `next.config.ts` change is needed.** Server Actions have been a stable, non-experimental feature since Next 14 — `next.config.ts`'s `experimental` block today only sets `staleTimes`, and this phase adds nothing there.

**A new, explicit `lib/` convention.** This is the first Server Actions work in the repo (`grep -rn "'use server'" lib/ app/ components/` currently returns zero hits outside a report-card PDF library string and a spec doc). Task 14 and Task 16 each add a `lib/<module>/actions/<name>.ts` file holding only the thin `'use server'` export — the actual logic lives in a sibling non-`'use server'` file (`lib/sis/document-validate.ts`, `lib/evaluation/upsert-writeup.ts`) so the route handler and the action call the exact same function. Future Server Action work should follow the same split.

### Task 12: Server Action plumbing — `ActionResult`, `ActionError`, `callAction`, `withAuthAction`

**Files:**

- Create: `lib/query/action-result.ts`
- Create: `lib/query/action-error.ts`
- Create: `lib/auth/with-auth-action.ts`
- Create: `__tests__/query/call-action.test.ts`
- Create: `__tests__/auth/with-auth-action.test.ts`

**Interfaces:**

- Consumes: `requireRole` (`lib/auth/require-role.ts`), `requireAnyCapability` (`lib/auth/require-capability.ts`), `Role` (`lib/auth/roles.ts`), `Capability` (`lib/auth/capabilities.ts`).
- Produces: `ActionResult<T>` — the return type every Server Action in Tasks 14 and 16 uses in place of `NextResponse.json(...)`; `callAction()` — the adapter every converted `mutationFn` in Tasks 15 and 17 wraps its action call in, so `useWriteAction` (`lib/hooks/use-write-action.ts`) needs zero changes; `withAuthAction()` — the wrapper Tasks 14 and 16 use to re-verify the caller inside the action body.

- [ ] **Step 1: Write the failing test for `callAction` / `ActionError`**

`__tests__/query/call-action.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ActionError, callAction } from '@/lib/query/action-error';
import type { ActionResult } from '@/lib/query/action-result';

// callAction is the ONLY thing that changes at a converted call site. Every
// existing `mutationFn: () => apiFetch(url, jsonInit(...))` becomes
// `mutationFn: () => callAction(() => someAction(...))`, and useWriteAction
// (lib/hooks/use-write-action.ts) keeps working unchanged because it has
// never cared about anything beyond "the promise resolves with T or rejects
// with something .message can be read off of" — apiFetch throws ApiError
// today, callAction throws ActionError, and both are Error subclasses.
describe('callAction', () => {
  it('resolves with the unwrapped data when the action succeeds', async () => {
    const action = async (): Promise<ActionResult<{ id: string }>> => ({
      ok: true,
      data: { id: 'abc' },
    });

    await expect(callAction(action)).resolves.toEqual({ id: 'abc' });
  });

  it('throws an ActionError carrying the code and status when the action reports failure', async () => {
    const action = async (): Promise<ActionResult<never>> => ({
      ok: false,
      error:
        "This applicant hasn't enrolled yet, so their documents belong with the applicants' queue — which you don't have permission to review.",
      code: 'unenrolled_documents_admissions_only',
      status: 403,
    });

    await expect(callAction(action)).rejects.toMatchObject({
      name: 'ActionError',
      message:
        "This applicant hasn't enrolled yet, so their documents belong with the applicants' queue — which you don't have permission to review.",
      code: 'unenrolled_documents_admissions_only',
      status: 403,
    });
  });

  it('produces a real ActionError instance, so instanceof checks at call sites work', async () => {
    const action = async (): Promise<ActionResult<never>> => ({
      ok: false,
      error: 'save failed',
      status: 500,
    });

    try {
      await callAction(action);
      throw new Error('expected callAction to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ActionError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('leaves code undefined when the action did not set one', async () => {
    const action = async (): Promise<ActionResult<never>> => ({
      ok: false,
      error: 'save failed',
      status: 500,
    });

    try {
      await callAction(action);
    } catch (e) {
      expect((e as ActionError).code).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails on the missing modules**

```bash
npx vitest run __tests__/query/call-action.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/query/action-error'` (and `@/lib/query/action-result`, once the first import resolves).

- [ ] **Step 3: Implement `ActionResult` and the `ActionError`/`callAction` adapter**

`lib/query/action-result.ts`:

```ts
// The return shape every converted Server Action uses in place of
// NextResponse.json({error, code}, {status}). A Server Action has no status
// code and no Response object of its own — it returns a JS value or throws —
// and Next strips thrown error messages in production builds by default. So
// every error branch a route handler used to answer with a status code
// becomes a value here instead, and `status` is carried through so the
// caller (callAction, below) can still distinguish "forbidden" from "not
// found" from "server error" the way ApiError.status already let it.
//
// `code` stays optional and untyped (`string`, not a fixed union) because two
// different producers use it for two different things: withAuthAction
// (lib/auth/with-auth-action.ts) emits a small fixed set
// ('UNAUTHENTICATED' | 'FORBIDDEN' | 'ACTION_FAILED'), while
// validateDocument (lib/sis/document-validate.ts) emits route-specific
// business codes ('enrolled_documents_pfiles_only', 'expired_document') that
// client error handlers already switch on today via ApiError.body.code — a
// narrower union here would either reject those or have to enumerate every
// business code from every future action in one shared file.
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status: number };
```

`lib/query/action-error.ts`:

```ts
import type { ActionResult } from '@/lib/query/action-result';

// The Server Action sibling of ApiError (lib/query/fetcher.ts). Deliberately
// shaped the same way — .message, .code, .status — so a call site's existing
// `e instanceof Error ? e.message : fallback` branch (the common case across
// all five converted call sites) needs no change at all, and the rarer
// `e instanceof ApiError` branches gain a parallel `e instanceof ActionError`
// check only where a call site actually reads .code today.
export class ActionError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, code: string | undefined, status: number) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Unwraps an ActionResult, throwing ActionError on failure. This is the ONE
 * line that changes at a converted call site:
 *
 *   mutationFn: () => apiFetch(url, jsonInit('PATCH', body))
 *   mutationFn: () => callAction(() => someAction(arg1, arg2, body))
 *
 * useWriteAction (lib/hooks/use-write-action.ts) never sees the difference —
 * it only cares that `work()` resolves with T or rejects with something
 * `.message` can be read off of, and never inspects HOW that promise was
 * produced.
 */
export async function callAction<T>(
  action: () => Promise<ActionResult<T>>
): Promise<T> {
  const result = await action();
  if (!result.ok) {
    throw new ActionError(result.error, result.code, result.status);
  }
  return result.data;
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run __tests__/query/call-action.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Write the failing test for `withAuthAction`**

`__tests__/auth/with-auth-action.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Server Actions are a separate entry point from the page that renders them
// (Next.js data-security guide: "A page-level authentication check does not
// extend to the Server Actions defined within it. Always re-verify inside
// the action."). withAuthAction makes that re-check a one-line addition,
// reusing this repo's existing requireRole/requireAnyCapability rather than
// inventing a parallel auth path.
vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }));
vi.mock('@/lib/auth/require-capability', () => ({
  requireAnyCapability: vi.fn(),
}));

import { requireRole } from '@/lib/auth/require-role';
import { requireAnyCapability } from '@/lib/auth/require-capability';
import { withAuthAction } from '@/lib/auth/with-auth-action';

describe('withAuthAction', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns UNAUTHENTICATED instead of throwing when the session is gone, and never calls the handler', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    } as any);
    const handler = vi.fn();

    const action = withAuthAction(
      { kind: 'role', roles: ['teacher'] },
      handler
    );
    const result = await action();

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
      status: 401,
      error: 'Your session has expired. Please sign in again.',
    });
  });

  it('returns FORBIDDEN when the role is wrong, and never calls the handler', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    } as any);
    const handler = vi.fn();

    const action = withAuthAction(
      { kind: 'role', roles: ['superadmin'] },
      handler
    );
    const result = await action();

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      status: 403,
      error: 'You do not have permission to do this.',
    });
  });

  it('passes the resolved role auth through to the handler and forwards its ActionResult unchanged', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      user: { id: 'u1', email: 't@x.com' },
      role: 'teacher',
    } as any);

    const action = withAuthAction(
      { kind: 'role', roles: ['teacher'] },
      async (auth, x: number) => {
        expect(auth.kind).toBe('role');
        expect(auth.user.id).toBe('u1');
        expect(auth.role).toBe('teacher');
        return { ok: true as const, data: x * 2 };
      }
    );
    const result = await action(21);

    expect(result).toEqual({ ok: true, data: 42 });
  });

  it('resolves a capability gate via requireAnyCapability and exposes .capabilities on auth', async () => {
    vi.mocked(requireAnyCapability).mockResolvedValue({
      user: { id: 'u2', email: 'c@x.com' },
      role: 'p_file_officer',
      capabilities: ['documents_post_enrolment.validate'],
    } as any);

    const action = withAuthAction(
      {
        kind: 'capability',
        capabilities: ['documents_post_enrolment.validate'],
      },
      async (auth) => {
        expect(auth.kind).toBe('capability');
        expect(auth.capabilities).toContain(
          'documents_post_enrolment.validate'
        );
        return { ok: true as const, data: 'validated' };
      }
    );
    const result = await action();

    expect(result).toEqual({ ok: true, data: 'validated' });
    expect(requireRole).not.toHaveBeenCalled();
  });

  it('forwards a business-error ActionResult from the handler unchanged, never collapsing it to ACTION_FAILED', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      user: { id: 'u1', email: 't@x.com' },
      role: 'teacher',
    } as any);

    const action = withAuthAction(
      { kind: 'role', roles: ['teacher'] },
      async () => ({
        ok: false as const,
        error: 'Cannot approve an expired document.',
        code: 'expired_document',
        status: 422,
      })
    );
    const result = await action();

    expect(result).toEqual({
      ok: false,
      error: 'Cannot approve an expired document.',
      code: 'expired_document',
      status: 422,
    });
  });

  it('turns an unexpected throw inside the handler into ACTION_FAILED, never a rejected promise', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      user: { id: 'u1', email: 't@x.com' },
      role: 'teacher',
    } as any);

    const action = withAuthAction(
      { kind: 'role', roles: ['teacher'] },
      async () => {
        throw new Error('database connection reset');
      }
    );
    const result = await action();

    expect(result).toEqual({
      ok: false,
      code: 'ACTION_FAILED',
      status: 500,
      error: 'Something went wrong. Please try again.',
    });
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
npx vitest run __tests__/auth/with-auth-action.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/auth/with-auth-action'`.

- [ ] **Step 7: Implement `withAuthAction`**

`lib/auth/with-auth-action.ts`:

```ts
import { requireRole, type RequireRoleUser } from '@/lib/auth/require-role';
import {
  requireAnyCapability,
  type RequireCapabilityUser,
} from '@/lib/auth/require-capability';
import type { Role } from '@/lib/auth/roles';
import type { Capability } from '@/lib/auth/capabilities';
import type { ActionResult } from '@/lib/query/action-result';

// Server Actions are a separate entry point from the page that renders them
// (Next.js data-security guide, "Authentication and authorization": "A
// page-level authentication check does not extend to the Server Actions
// defined within it. Always re-verify inside the action."). This wrapper
// makes that re-check a one-line addition, reusing the exact
// requireRole/requireAnyCapability every API route already calls.
//
// NOTE: this alone does not fix a proxy-issued redirect on a Server Action
// POST — proxy.ts's matcher covers pages, and a Server Action POSTs to the
// current page's own URL, so the proxy runs BEFORE this wrapper and can
// short-circuit the request before the action ever executes. See the
// isServerActionRequest branch added to lib/supabase/proxy.ts (Task 13) for
// the companion fix on that path — the two do not overlap: this wrapper
// covers a direct POST that bypasses the UI, a future matcher change, and
// resource-level (IDOR) authorization the page-level gate can't see; Task 13
// covers the specific "session expired mid-action" redirect shape.
//
// The handler's return type is Promise<ActionResult<TResult>>, not
// Promise<TResult> — deliberately. validateDocument (lib/sis/document-validate.ts)
// and upsertWriteup (lib/evaluation/upsert-writeup.ts) already PRODUCE an
// ActionResult with route-specific codes (enrolled_documents_pfiles_only, a
// 422 for an expired document). If this wrapper instead expected a raw
// TResult and relied on throw/catch to signal business errors, every one of
// those codes would collapse into the single generic ACTION_FAILED caught
// below — exactly the flattening KD #24 forbids. So a handler's own
// ActionResult is forwarded UNCHANGED on success; this wrapper only ever
// synthesizes its own ActionResult for the two things it alone is
// responsible for: an auth failure, or a handler that threw instead of
// returning (a bug, a dropped DB connection — not a modelled business error).
export type RoleAuth = { kind: 'role'; user: RequireRoleUser; role: Role };
export type CapabilityAuth = {
  kind: 'capability';
  user: RequireCapabilityUser;
  role: Role;
  capabilities: readonly Capability[];
};

type AuthGate =
  | { kind: 'role'; roles: Role[] }
  | { kind: 'capability'; capabilities: readonly Capability[] };

export function withAuthAction<TArgs extends unknown[], TResult>(
  gate: { kind: 'role'; roles: Role[] },
  handler: (auth: RoleAuth, ...args: TArgs) => Promise<ActionResult<TResult>>
): (...args: TArgs) => Promise<ActionResult<TResult>>;
export function withAuthAction<TArgs extends unknown[], TResult>(
  gate: { kind: 'capability'; capabilities: readonly Capability[] },
  handler: (
    auth: CapabilityAuth,
    ...args: TArgs
  ) => Promise<ActionResult<TResult>>
): (...args: TArgs) => Promise<ActionResult<TResult>>;
export function withAuthAction<TArgs extends unknown[], TResult>(
  gate: AuthGate,
  handler: (
    auth: RoleAuth | CapabilityAuth,
    ...args: TArgs
  ) => Promise<ActionResult<TResult>>
) {
  return async (...args: TArgs): Promise<ActionResult<TResult>> => {
    const authResult =
      gate.kind === 'role'
        ? await requireRole(gate.roles)
        : await requireAnyCapability(gate.capabilities);

    if ('error' in authResult) {
      // requireRole/requireAnyCapability build a NextResponse meant for a
      // route handler to `return` directly. A Server Action can't hand a
      // NextResponse back to the client the same way (the client only
      // understands the ActionResult shape below), so unpack the status and
      // translate it.
      const status = authResult.error.status; // 401 or 403
      return status === 401
        ? {
            ok: false,
            error: 'Your session has expired. Please sign in again.',
            code: 'UNAUTHENTICATED',
            status,
          }
        : {
            ok: false,
            error: 'You do not have permission to do this.',
            code: 'FORBIDDEN',
            status,
          };
    }

    const auth: RoleAuth | CapabilityAuth =
      gate.kind === 'role'
        ? { kind: 'role', user: authResult.user, role: authResult.role }
        : {
            kind: 'capability',
            user: authResult.user,
            role: authResult.role,
            capabilities: authResult.capabilities,
          };

    try {
      return await handler(auth, ...args);
    } catch (err) {
      // Server Action errors thrown past this point are opaque to the
      // client by React's own design (message text is stripped in
      // production unless the app opts in). Returning a typed result here
      // keeps the failure legible without relying on that mechanism.
      console.error('[withAuthAction] action threw:', err);
      return {
        ok: false,
        error: 'Something went wrong. Please try again.',
        code: 'ACTION_FAILED',
        status: 500,
      };
    }
  };
}
```

- [ ] **Step 8: Run it and confirm it passes**

```bash
npx vitest run __tests__/auth/with-auth-action.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 9: Type-check and commit**

```bash
npx tsc --noEmit
git add lib/query/action-result.ts lib/query/action-error.ts lib/auth/with-auth-action.ts __tests__/query/call-action.test.ts __tests__/auth/with-auth-action.test.ts
git commit -m "feat(actions): ActionResult, callAction and withAuthAction — the Server Action plumbing

Four of five route conventions (auth, zod, logAction, cache invalidation)
port into a Server Action unchanged; ActionResult<T> is the one seam that
needs new work, since a Server Action has no status code and Next strips
thrown error messages in production. withAuthAction re-verifies the
caller inside the action body per Next's own docs — Task 13 is the
companion fix for the proxy's own redirect-vs-action interaction."
```

### Task 13: Proxy — answer a Server Action POST with a plain-text 4xx, not a redirect

**Files:**

- Modify: `lib/supabase/proxy.ts`
- Create: `__tests__/auth/proxy-server-action-redirect.test.ts`

**Interfaces:**

- Consumes: nothing from Task 12 — this is the other, independent half of the mitigation described in the phase intro, and does not depend on `withAuthAction` existing.
- Produces: `updateSession()` answering a request carrying a `next-action` header and `POST` method with a plain-text 401 (missing session) or 403 (disallowed route) instead of `NextResponse.redirect()`. Every ordinary GET/navigation redirect is untouched. Tasks 14–17 do not depend on this landing first, but Task 18's browser verification is where it gets proven end to end, so it must land before that task runs.

- [ ] **Step 1: Write the failing test**

`__tests__/auth/proxy-server-action-redirect.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// A session that has expired (or a role that changed) between page load and
// a Server Action firing. Before this fix, updateSession answered every
// unauthenticated request the same way — a 307 redirect — whether it was an
// ordinary navigation or a Server Action POST. That is correct for a
// navigation and silently wrong for an action: fetch()'s default
// redirect:'follow' re-POSTs the redirect target carrying the SAME
// next-action header and body (307/308 preserve method + body per the
// WHATWG fetch spec), lands on a route with no matching action id, and
// Next's own action-handler answers 404 with x-nextjs-action-not-found:1 —
// the client throws UnrecognizedActionError ("Server Action ... was not
// found on the server"), never navigates to /login, and the user is left
// looking at a stale form with a confusing error. See the Phase 4 intro in
// docs/superpowers/plans/2026-08-29-nextjs-navigation-performance.md for the
// full trace through Next's own source.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: vi.fn().mockResolvedValue({ data: { claims: null } }),
    },
  })),
}));

import { updateSession } from '@/lib/supabase/proxy';

describe('updateSession — Server Action requests', () => {
  it('answers a Server Action POST with a plain-text 401, not a redirect, when the session is missing', async () => {
    const req = new NextRequest('https://app.test/evaluation/sections/abc', {
      method: 'POST',
      headers: { 'next-action': 'abc123' },
    });

    const res = await updateSession(req);

    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toMatch(/sign in again/i);
  });

  it('still issues a normal 307 redirect for an ordinary (non-action) navigation', async () => {
    const req = new NextRequest('https://app.test/evaluation/sections/abc', {
      method: 'GET',
    });

    const res = await updateSession(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('does not treat a GET carrying a stray next-action header as a Server Action request', async () => {
    // fetchServerAction() always sends POST — a GET that happens to carry a
    // next-action header (a caching proxy echoing it, say) must still get
    // the ordinary redirect, not the plain-text response meant for a
    // POST-only client contract.
    const req = new NextRequest('https://app.test/evaluation/sections/abc', {
      method: 'GET',
      headers: { 'next-action': 'abc123' },
    });

    const res = await updateSession(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});
```

- [ ] **Step 2: Run it and confirm the first test fails**

```bash
npx vitest run __tests__/auth/proxy-server-action-redirect.test.ts
```

Expected: the first test FAILS — `res.status` is `307`, not `401`. The other two already pass against the current code (they exercise the unchanged path).

- [ ] **Step 3: Add the `isServerActionRequest` branch to `redirectTo`**

In `lib/supabase/proxy.ts`, replace:

```ts
const redirectTo = (to: string) => {
  const url = request.nextUrl.clone();
  url.pathname = to;
  return NextResponse.redirect(url);
};
```

with:

```ts
// Server Actions POST to the current page URL, which this proxy's matcher
// does not exclude (only `api`, `_next/static`, `_next/image` and static
// assets are — see proxy.ts) — so a Server Action request lands in the
// exact same gate as a page navigation. NextResponse.redirect() is
// silently wrong for that case: the browser's fetch() follows the 307
// automatically (POST + body preserved per the WHATWG fetch spec), lands
// on a route with no matching action id, and Next's own action-handler
// answers 404 with x-nextjs-action-not-found:1 — the client throws
// UnrecognizedActionError ("Server Action ... was not found on the
// server"), and no navigation to /login ever happens. Detect the request
// shape and answer it the way Next's own Server Action client already
// knows how to read (node_modules/next/dist/client/components/
// router-reducer/reducers/server-action-reducer.js: a >=400 response with
// content-type: text/plain becomes the thrown Error's message, with no
// second round trip).
const isServerActionRequest =
  request.method === 'POST' && request.headers.has('next-action');

const redirectTo = (to: string) => {
  if (isServerActionRequest) {
    const status = to === '/login' ? 401 : 403;
    const message =
      status === 401
        ? 'Your session has expired. Please sign in again.'
        : 'You do not have permission to do this.';
    return new NextResponse(message, {
      status,
      headers: { 'content-type': 'text/plain' },
    });
  }
  const url = request.nextUrl.clone();
  url.pathname = to;
  return NextResponse.redirect(url);
};
```

- [ ] **Step 4: Run it and confirm all three pass**

```bash
npx vitest run __tests__/auth/proxy-server-action-redirect.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Type-check, run the full auth suite, and commit**

```bash
npx tsc --noEmit
npx vitest run __tests__/auth
```

Expected: both green — nothing else in `__tests__/auth` touches `redirectTo`, so this is a pure addition.

```bash
git add lib/supabase/proxy.ts __tests__/auth/proxy-server-action-redirect.test.ts
git commit -m "fix(proxy): answer a Server Action POST with a plain-text 4xx, not a redirect

updateSession's redirectTo() always issued NextResponse.redirect(), which
a Server Action POST auto-follows (fetch's default redirect:'follow'
preserves method+body on a 307), lands on a route with no matching
action id, and surfaces as a wrong, confusing UnrecognizedActionError
instead of a clean sign-in prompt. Every ordinary navigation is untouched."
```

### Task 14: Document validation — one shared function, a Server Action, and a thinner route handler

⚠ **Deliberate deviation from the design doc's own high-level pseudocode.** The design investigation (`validate-document.ts` sketch) describes the shared function as holding "all of: requireAnyCapability, ... verbatim from the current route body" — i.e. the capability check itself buried inside the shared function. This task keeps `requireAnyCapability` OUTSIDE the shared function instead, called once by each entry point (the route handler directly, the Server Action via `withAuthAction`), for two reasons: (1) it matches how every other route in this codebase is structured — auth resolution is the entry point's job, not business logic's; (2) `withAuthAction` already resolves auth and hands the caller's capabilities to its handler, so burying a second `requireAnyCapability` call inside `validateDocument` would mean the Server Action path decodes and checks the JWT twice per call for no benefit. What genuinely belongs inside the shared function — because it is not an auth _resolution_ question but a business-logic question — is the **enrolment-axis narrowing**: given a capability set the caller already holds, is it the RIGHT one for this specific student's enrolment state. That check stays in `validateDocument`, exactly where the original route body had it.

⚠ **One small, deliberate behavior narrowing, not a bug:** the original route's 400 response for a failed zod parse included `details: parsed.error.flatten()`. No caller reads `.details` — the design investigation confirmed this by reading all five call sites and their error handlers, which only ever read `.error`/`.message`. `ActionResult` carries `error`/`code`/`status` only, so `.details` is dropped. Flag this if a future caller ever needs field-level validation detail; nothing today does.

**Files:**

- Create: `lib/sis/document-validate.ts`
- Create: `lib/sis/actions/validate-document.ts`
- Modify: `app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts`
- Create: `__tests__/sis/document-validate.test.ts`

**Interfaces:**

- Consumes: `requireAnyCapability` (`lib/auth/require-capability.ts`), `withAuthAction`/`ActionResult` (Task 12), `DocumentValidationSchema`/`DocumentValidationInput` (`lib/schemas/sis.ts`), `DOCUMENT_SLOTS` (`lib/sis/queries.ts`), `isStudentEnrolled` (`lib/p-files/queries.ts`), `resolveRecipients`/`sendReminder` (`lib/notifications/email-pfile-reminder.ts`), `logAction`, `invalidateDrillTags`, `createServiceClient`.
- Produces: `validateDocument()` — the one function holding every branch the route body used to (the enrolment-axis narrowing, the optimistic claim, the expired-document guard, the rejection email, the audit write, the cache bust); `validateDocumentAction()` — the Server Action Task 15's four call sites call. The route still answers `PATCH /api/sis/students/[enroleeNumber]/document/[slotKey]` with the same success/error bodies (minus `.details`, above).

- [ ] **Step 1: Write the failing test for the extracted function**

`__tests__/sis/document-validate.test.ts`:

```ts
/**
 * validateDocument() is the whole former body of
 * PATCH /api/sis/students/[enroleeNumber]/document/[slotKey], extracted so
 * the route handler and the Server Action (validateDocumentAction) share ONE
 * implementation instead of drifting. These four cases pin the branches most
 * at risk in an extraction: the enrolment-axis capability narrowing
 * (KD #166), the no-op short-circuit, the optimistic claim + audit + cache
 * bust, and the expired-document guard (KD #60). The rejection-email side
 * effect is copied verbatim from the route and unchanged in shape, so it is
 * not independently re-tested here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/p-files/queries', () => ({
  isStudentEnrolled: vi.fn(),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/notifications/email-pfile-reminder', () => ({
  resolveRecipients: vi.fn(),
  sendReminder: vi.fn(),
}));

function documentsTable(
  before: { data: unknown; error: unknown },
  claimed?: { data: unknown; error: unknown }
) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve(before),
      }),
    }),
    update: () => ({
      eq: () => ({
        is: () => ({ select: () => Promise.resolve(claimed) }),
        eq: () => ({ select: () => Promise.resolve(claimed) }),
      }),
    }),
  };
}

let table: ReturnType<typeof documentsTable>;

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (_name: string) => table,
  })),
}));

import { isStudentEnrolled } from '@/lib/p-files/queries';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { validateDocument } from '@/lib/sis/document-validate';

const BASE = {
  enroleeNumber: 'EN-1',
  ayCode: 'AY2026',
  actor: { id: 'u-1', email: 'officer@hfse.test' },
};

describe('validateDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('narrows on the enrolment axis — a pre-enrolment-only capability cannot touch an enrolled student', async () => {
    vi.mocked(isStudentEnrolled).mockResolvedValue(true);
    table = documentsTable({ data: null, error: null });

    const result = await validateDocument({
      ...BASE,
      slotKey: 'birthCert',
      body: { status: 'Valid' },
      capabilities: ['documents_pre_enrolment.validate'],
    });

    expect(result).toEqual({
      ok: false,
      error:
        "This student has enrolled, so their documents belong with the enrolled students' queue — which you don't have permission to review.",
      code: 'enrolled_documents_pfiles_only',
      status: 403,
    });
  });

  it('short-circuits with changed:false when the status is not actually changing', async () => {
    vi.mocked(isStudentEnrolled).mockResolvedValue(false);
    table = documentsTable({
      data: { birthCertStatus: 'Valid', birthCert: 'https://x.test/f.pdf' },
      error: null,
    });

    const result = await validateDocument({
      ...BASE,
      slotKey: 'birthCert',
      body: { status: 'Valid' },
      capabilities: ['documents_pre_enrolment.validate'],
    });

    expect(result).toEqual({ ok: true, data: { ok: true, changed: false } });
    expect(logAction).not.toHaveBeenCalled();
  });

  it('approves a document, claims the row, audits it, and busts the caches', async () => {
    vi.mocked(isStudentEnrolled).mockResolvedValue(false);
    table = documentsTable(
      {
        data: {
          birthCertStatus: 'Uploaded',
          birthCert: 'https://x.test/f.pdf',
        },
        error: null,
      },
      { data: [{ enroleeNumber: 'EN-1' }], error: null }
    );

    const result = await validateDocument({
      ...BASE,
      slotKey: 'birthCert',
      body: { status: 'Valid' },
      capabilities: ['documents_pre_enrolment.validate'],
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sis.document.approve' })
    );
    expect(invalidateDrillTags).toHaveBeenCalledWith('admissions', 'AY2026');
    expect(invalidateDrillTags).toHaveBeenCalledWith('p-files', 'AY2026');
    expect(invalidateDrillTags).toHaveBeenCalledWith('records', 'AY2026');
  });

  it('refuses to re-approve an expired document (KD #60)', async () => {
    vi.mocked(isStudentEnrolled).mockResolvedValue(false);
    table = documentsTable({
      data: {
        passportStatus: 'Expired',
        passport: 'https://x.test/f.pdf',
        passportExpiry: '2020-01-01',
      },
      error: null,
    });

    const result = await validateDocument({
      ...BASE,
      slotKey: 'passport',
      body: { status: 'Valid' },
      capabilities: ['documents_pre_enrolment.validate'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.code).toBe('expired_document');
    }
    expect(logAction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails on the missing module**

```bash
npx vitest run __tests__/sis/document-validate.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/sis/document-validate'`.

- [ ] **Step 3: Extract `validateDocument` — read the current route in full before writing this**

Read `app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts` in full (it is 334 lines; every branch below is copied from it, not paraphrased). Then create:

`lib/sis/document-validate.ts`:

```ts
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  resolveRecipients,
  sendReminder,
} from '@/lib/notifications/email-pfile-reminder';
import { isStudentEnrolled } from '@/lib/p-files/queries';
import type { ActionResult } from '@/lib/query/action-result';
import { DocumentValidationSchema } from '@/lib/schemas/sis';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { createServiceClient } from '@/lib/supabase/service';
import type { Capability } from '@/lib/auth/capabilities';

const SLOT_KEYS = new Set(DOCUMENT_SLOTS.map((s) => s.key));
const SLOT_META = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));

export type ValidateDocumentParams = {
  enroleeNumber: string;
  slotKey: string;
  ayCode: string;
  body: unknown;
  actor: { id: string; email: string | null };
  /**
   * The capability set the CALLER already holds, resolved once by the entry
   * point (the route handler's own requireAnyCapability call, or
   * withAuthAction inside the Server Action). This function does not
   * re-resolve auth — it only narrows an already-authenticated caller onto
   * the correct side of the enrolment axis (KD #166).
   */
  capabilities: readonly Capability[];
};

export type ValidateDocumentData = { ok: true; changed?: boolean };

// Every branch of the former PATCH /api/sis/students/[enroleeNumber]/document/[slotKey]
// handler, unchanged in behaviour except that every
// `NextResponse.json({error, code}, {status})` became `{ok:false, error,
// code, status}`. Called by BOTH the route handler and the Server Action
// (validateDocumentAction, lib/sis/actions/validate-document.ts) — this is
// the ONE place the enrolment-axis narrowing, the optimistic-claim race, the
// rejection email, the audit write and the cache bust live.
export async function validateDocument(
  params: ValidateDocumentParams
): Promise<ActionResult<ValidateDocumentData>> {
  const { enroleeNumber, slotKey, ayCode, body, actor, capabilities } = params;

  if (!enroleeNumber.trim()) {
    return { ok: false, error: 'Missing enroleeNumber', status: 400 };
  }
  if (!SLOT_KEYS.has(slotKey)) {
    return { ok: false, error: 'Unknown slotKey', status: 400 };
  }
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return {
      ok: false,
      error: 'Invalid or missing ay query param',
      status: 400,
    };
  }

  // Document-axis ownership handoff at enrolment (module-ownership rule) —
  // the document lifecycle is Admissions' before enrolment and P-Files'
  // after. One person can hold both capabilities; this is what stops them
  // acting on the wrong side of a given student's line.
  const enrolled = await isStudentEnrolled(ayCode, enroleeNumber);
  const required = enrolled
    ? 'documents_post_enrolment.validate'
    : 'documents_pre_enrolment.validate';

  if (!capabilities.includes(required)) {
    return enrolled
      ? {
          ok: false,
          error:
            "This student has enrolled, so their documents belong with the enrolled students' queue — which you don't have permission to review.",
          code: 'enrolled_documents_pfiles_only',
          status: 403,
        }
      : {
          ok: false,
          error:
            "This applicant hasn't enrolled yet, so their documents belong with the applicants' queue — which you don't have permission to review.",
          code: 'unenrolled_documents_admissions_only',
          status: 403,
        };
  }

  const parsed = DocumentValidationSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid payload',
      code: 'invalid_payload',
      status: 400,
    };
  }

  const slot = SLOT_META.get(slotKey)!;
  const statusCol = slot.statusCol;
  const urlCol = slot.urlCol;
  const expiryCol = slot.expiryCol;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const table = `${prefix}_enrolment_documents`;
  const supabase = createServiceClient();

  const selectCols = [
    statusCol,
    urlCol,
    ...(expiryCol ? [expiryCol] : []),
  ].join(', ');
  const { data: before, error: beforeErr } = await supabase
    .from(table)
    .select(selectCols)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error('[validateDocument] pre-fetch failed:', beforeErr.message);
    return { ok: false, error: 'Lookup failed', status: 500 };
  }
  if (!before) {
    return {
      ok: false,
      error: 'No document row for this enrolee in this AY',
      status: 404,
    };
  }
  const beforeRow = before as unknown as Record<string, unknown>;
  const priorStatus = (beforeRow[statusCol] as string | null) ?? null;
  const fileUrl = (beforeRow[urlCol] as string | null) ?? null;
  const priorExpiry = expiryCol
    ? ((beforeRow[expiryCol] as string | null) ?? null)
    : null;

  if (!fileUrl) {
    return {
      ok: false,
      error: 'Cannot validate a slot with no uploaded file',
      status: 400,
    };
  }

  // No-op short-circuit — see the original route's comment for why this must
  // stay a normal return, not an error: re-approving an already-'Valid' slot
  // must not re-send the rejection email or write a duplicate audit row.
  if (priorStatus === parsed.data.status) {
    return { ok: true, data: { ok: true, changed: false } };
  }

  // Block manual approval of an expired document (KD #60) — the proper
  // recovery is parent re-upload, which auto-sets status back to 'Valid'
  // with a fresh expiry.
  if (parsed.data.status === 'Valid') {
    const expiryPassed =
      priorExpiry !== null && new Date(priorExpiry).getTime() < Date.now();
    if (priorStatus === 'Expired' || expiryPassed) {
      return {
        ok: false,
        error:
          'Cannot approve an expired document. Parent must re-upload before re-validation.',
        code: 'expired_document',
        status: 422,
      };
    }
  }

  // The status change IS the claim — matching on the prior status means
  // exactly one of two concurrent requests can transition the slot.
  const claim = supabase
    .from(table)
    .update({ [statusCol]: parsed.data.status })
    .eq('enroleeNumber', enroleeNumber);
  const { data: claimed, error: upErr } = await (
    priorStatus === null
      ? claim.is(statusCol, null)
      : claim.eq(statusCol, priorStatus)
  ).select('enroleeNumber');
  if (upErr) {
    console.error('[validateDocument] update failed:', upErr.message);
    return { ok: false, error: upErr.message, status: 500 };
  }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Another request already won the claim — same response as the
    // sequential no-op above.
    return { ok: true, data: { ok: true, changed: false } };
  }

  const rejectedData = parsed.data.status === 'Rejected' ? parsed.data : null;
  const isRejection = rejectedData !== null;
  const rejectionReason = rejectedData?.rejectionReason ?? null;

  let notified = false;
  if (isRejection && rejectionReason) {
    try {
      const appsTable = `${prefix}_enrolment_applications`;
      const statusTable = `${prefix}_enrolment_status`;
      const [{ data: appRow }, { data: statusRow }] = await Promise.all([
        supabase
          .from(appsTable)
          .select(
            'enroleeFullName, motherEmail, fatherEmail, guardianEmail, levelApplied'
          )
          .eq('enroleeNumber', enroleeNumber)
          .maybeSingle(),
        supabase
          .from(statusTable)
          .select('classSection')
          .eq('enroleeNumber', enroleeNumber)
          .maybeSingle(),
      ]);
      if (appRow) {
        const appData = appRow as {
          enroleeFullName: string;
          motherEmail: string | null;
          fatherEmail: string | null;
          guardianEmail: string | null;
          levelApplied: string | null;
        };
        const classSection =
          (statusRow as { classSection: string | null } | null)?.classSection ??
          null;
        const slotMeta = SLOT_META.get(slotKey)!;
        const envelope = resolveRecipients(slotKey, {
          motherEmail: appData.motherEmail,
          fatherEmail: appData.fatherEmail,
          guardianEmail: appData.guardianEmail,
        });
        if (envelope.kind !== 'none') {
          const result = await sendReminder(
            {
              kind: 'rejection',
              studentName: appData.enroleeFullName,
              level: appData.levelApplied,
              section: classSection,
              slotKey,
              slotLabel: slotMeta.label,
              statusKind: 'rejected',
              expiryDateIso: null,
              rejectionReason,
              enroleeNumber,
              ayCode,
            },
            envelope
          );
          notified = result.sent > 0;
        }
      }
    } catch (e) {
      console.error(
        '[validateDocument] rejection email failed (non-fatal):',
        e
      );
    }
  }

  await logAction({
    service: supabase,
    actor,
    action:
      parsed.data.status === 'Valid'
        ? 'sis.document.approve'
        : 'sis.document.reject',
    entityType: 'enrolment_document',
    entityId: `${enroleeNumber}:${slotKey}`,
    context: {
      ay_code: ayCode,
      slot_key: slotKey,
      prior_status: priorStatus,
      new_status: parsed.data.status,
      ...(rejectionReason
        ? { rejection_reason: rejectionReason, notified }
        : {}),
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);
  invalidateDrillTags('p-files', ayCode);
  invalidateDrillTags('records', ayCode);

  return { ok: true, data: { ok: true } };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run __tests__/sis/document-validate.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Add the Server Action**

`lib/sis/actions/validate-document.ts`:

```ts
'use server';

import { withAuthAction } from '@/lib/auth/with-auth-action';
import {
  validateDocument,
  type ValidateDocumentData,
} from '@/lib/sis/document-validate';
import type { DocumentValidationInput } from '@/lib/schemas/sis';
import type { ActionResult } from '@/lib/query/action-result';

// Called directly from the five converted P-Files/Admissions/SIS document
// components (Task 15) via callAction(). Reachable via a direct POST like
// any Server Action (Next's own docs: "you should still treat Server
// Actions as reachable via direct POST requests and verify authentication
// and authorization inside each one") — withAuthAction is that
// verification, independent of whatever the page itself already gated on.
export async function validateDocumentAction(
  enroleeNumber: string,
  slotKey: string,
  ayCode: string,
  body: DocumentValidationInput
): Promise<ActionResult<ValidateDocumentData>> {
  const action = withAuthAction(
    {
      kind: 'capability',
      capabilities: [
        'documents_pre_enrolment.validate',
        'documents_post_enrolment.validate',
      ],
    },
    async (auth) =>
      validateDocument({
        enroleeNumber,
        slotKey,
        ayCode,
        body,
        actor: { id: auth.user.id, email: auth.user.email },
        capabilities: auth.capabilities,
      })
  );
  return action();
}
```

- [ ] **Step 6: Rewire the route handler to call the same function**

In `app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts`, replace the entire file with:

```ts
import { NextResponse } from 'next/server';

import { requireAnyCapability } from '@/lib/auth/require-capability';
import { validateDocument } from '@/lib/sis/document-validate';

// PATCH /api/sis/students/[enroleeNumber]/document/[slotKey]?ay=AY2026
//
// Thin HTTP adapter over validateDocument() (lib/sis/document-validate.ts) —
// the same function the Server Action (lib/sis/actions/validate-document.ts)
// calls. This route has no non-UI caller (confirmed by grepping the whole
// repo before this task started), so it is kept alive as a deliberate
// architectural choice: a stable contract for any future script/webhook
// caller, and a rollback path if the Server Action ever needs one — a
// one-line revert per component, since neither path could have drifted from
// the other.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; slotKey: string }> }
) {
  const auth = await requireAnyCapability([
    'documents_pre_enrolment.validate',
    'documents_post_enrolment.validate',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber, slotKey } = await params;
  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  const body = await request.json().catch(() => null);

  const result = await validateDocument({
    enroleeNumber,
    slotKey,
    ayCode,
    body,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    capabilities: auth.capabilities,
  });

  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json(
        { error: result.error, ...(result.code ? { code: result.code } : {}) },
        { status: result.status }
      );
}
```

- [ ] **Step 7: Type-check and confirm nothing else broke**

```bash
npx tsc --noEmit
npx vitest run __tests__/sis __tests__/auth/capabilities.test.ts
```

Expected: both green. `capabilities.test.ts` walks the route by file path as metadata (not a runtime call), so it is unaffected by the body rewrite.

- [ ] **Step 8: Commit**

```bash
git add lib/sis/document-validate.ts lib/sis/actions/validate-document.ts "app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts" __tests__/sis/document-validate.test.ts
git commit -m "refactor(sis): extract validateDocument, add the Server Action, thin the route

The route handler and the new validateDocumentAction share one
implementation — every branch (enrolment-axis narrowing, optimistic
claim, expired-document guard, rejection email, audit, cache bust) lives
in lib/sis/document-validate.ts, exercised by both callers."
```

### Task 15: Document validation — convert the four call sites

**Files:**

- Modify: `components/admissions/document-validation/validation-queue.tsx`
- Modify: `components/sis/document-validation-actions.tsx`
- Modify: `components/p-files/document-validation/awaiting-queue.tsx`
- Modify: `components/p-files/document-card.tsx`
- Modify: `__tests__/admissions/validation-queue.test.tsx`
- Modify: `__tests__/p-files/awaiting-queue.test.tsx`

**Interfaces:**

- Consumes: `callAction` (Task 12), `validateDocumentAction` (Task 14).
- Produces: all four components call the Server Action instead of `apiFetch`; `useWriteAction` and every existing `onMutate`/`onError`/`onResolved` branch is untouched, because only the `mutationFn` line changes at each site. The two existing component tests that stubbed `fetch` now mock the action module instead, since neither component calls `fetch` anymore.

- [ ] **Step 1: Convert `validation-queue.tsx`**

Replace the import:

```ts
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
```

with:

```ts
import { callAction } from '@/lib/query/action-error';
import { validateDocumentAction } from '@/lib/sis/actions/validate-document';
```

Replace the mutation:

```ts
  const statusMutation = useMutation({
    mutationFn: ({ row, body }: { row: ValidationQueueRow; body: PatchBody }) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(row.enroleeNumber)}/document/${encodeURIComponent(row.slotKey)}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', body)
      ),
```

with:

```ts
  const statusMutation = useMutation({
    mutationFn: ({ row, body }: { row: ValidationQueueRow; body: PatchBody }) =>
      callAction(() =>
        validateDocumentAction(row.enroleeNumber, row.slotKey, ayCode, body)
      ),
```

Nothing else in the file changes — `onMutate`/`onError`/`onSettled` still work against the same `useMutation`, and `patchStatus`'s `error: (e) => e instanceof Error ? e.message : ...` already produces the right message for an `ActionError` (it extends `Error`).

- [ ] **Step 2: Convert `document-validation-actions.tsx`**

Replace the imports:

```ts
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
```

with:

```ts
import { callAction } from '@/lib/query/action-error';
import { validateDocumentAction } from '@/lib/sis/actions/validate-document';
import type { DocumentValidationInput } from '@/lib/schemas/sis';
```

Replace the mutation:

```ts
const validateMutation = useMutation({
  mutationFn: ({ body }: { body: Record<string, unknown> }) =>
    apiFetch(
      `/api/sis/students/${encodeURIComponent(enroleeNumber)}/document/${encodeURIComponent(slotKey)}?ay=${encodeURIComponent(ayCode)}`,
      jsonInit('PATCH', body)
    ),
});
```

with:

```ts
const validateMutation = useMutation({
  mutationFn: ({ body }: { body: DocumentValidationInput }) =>
    callAction(() =>
      validateDocumentAction(enroleeNumber, slotKey, ayCode, body)
    ),
});
```

Simplify `errorMessage()` — the `ApiError`-specific branch is now dead (there is no more `ApiError` in this file), and `ActionError.message` already carries the exact string the route used to put in `body.error`, so the generic branch already reproduces identical output:

```ts
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
```

- [ ] **Step 3: Convert `awaiting-queue.tsx`**

Same pattern as Step 1. Replace the import:

```ts
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
```

with:

```ts
import { callAction } from '@/lib/query/action-error';
import { validateDocumentAction } from '@/lib/sis/actions/validate-document';
```

Replace the mutation:

```ts
  const statusMutation = useMutation({
    mutationFn: ({ row, body }: { row: PFileValidationRow; body: PatchBody }) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(row.enroleeNumber)}/document/${encodeURIComponent(row.slotKey)}?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', body)
      ),
```

with:

```ts
  const statusMutation = useMutation({
    mutationFn: ({ row, body }: { row: PFileValidationRow; body: PatchBody }) =>
      callAction(() =>
        validateDocumentAction(row.enroleeNumber, row.slotKey, ayCode, body)
      ),
```

- [ ] **Step 4: Convert `document-card.tsx`**

Replace the import:

```ts
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
```

with:

```ts
import { callAction } from '@/lib/query/action-error';
import { validateDocumentAction } from '@/lib/sis/actions/validate-document';
```

Replace the `docUrl` constant and the two mutations:

```ts
const docUrl = `/api/sis/students/${encodeURIComponent(enroleeNumber)}/document/${encodeURIComponent(slotKey)}?ay=${encodeURIComponent(ayCode)}`;

// The settled card re-renders from the server (Model A), so there is no
// inline status to flip optimistically — which is exactly why the toast has
// to hold until that re-render lands. The route's bespoke `body.error`
// message is preserved via ApiError.message.
const approveMutation = useMutation({
  mutationFn: () => apiFetch(docUrl, jsonInit('PATCH', { status: 'Valid' })),
});

const rejectMutation = useMutation({
  mutationFn: (reason: string) =>
    apiFetch(
      docUrl,
      jsonInit('PATCH', { status: 'Rejected', rejectionReason: reason })
    ),
});
```

with:

```ts
// The settled card re-renders from the server (Model A), so there is no
// inline status to flip optimistically — which is exactly why the toast has
// to hold until that re-render lands. The route's bespoke error message is
// preserved via ActionError.message.
const approveMutation = useMutation({
  mutationFn: () =>
    callAction(() =>
      validateDocumentAction(enroleeNumber, slotKey, ayCode, {
        status: 'Valid',
      })
    ),
});

const rejectMutation = useMutation({
  mutationFn: (reason: string) =>
    callAction(() =>
      validateDocumentAction(enroleeNumber, slotKey, ayCode, {
        status: 'Rejected',
        rejectionReason: reason,
      })
    ),
});
```

- [ ] **Step 5: Update `__tests__/admissions/validation-queue.test.tsx` — mock the action, not `fetch`**

The component no longer calls `fetch`, so `stubFetch`/`jsonResponse` intercept nothing. Replace the whole file with:

```tsx
/**
 * Behavior test for the Tier-1 OPTIMISTIC mutation reference: the admissions
 * document-validation queue. The list is local state mirrored from RSC props
 * (not a useQuery cache), so the optimistic target is `rows`:
 *  - approve → row removed immediately (optimistic), then refresh, THEN success
 *  - error → row is restored (rollback) and the route-specific message shows.
 *
 * The queue calls the validateDocumentAction Server Action directly (Task 15)
 * rather than fetch(), so this mocks the action module and controls its
 * ActionResult per test instead of stubbing the global fetch.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationQueue } from '@/components/admissions/document-validation/validation-queue';
import type { ValidationQueueRow } from '@/lib/admissions/document-validation';
import { renderWithClient } from '../_utils/render-with-client';

const { refreshMock, toastSuccess, toastError, validateDocumentActionMock } =
  vi.hoisted(() => ({
    refreshMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    validateDocumentActionMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admissions/document-validation',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: toastSuccess,
    error: toastError,
  },
}));
vi.mock('@/lib/sis/actions/validate-document', () => ({
  validateDocumentAction: validateDocumentActionMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

const ROW: ValidationQueueRow = {
  enroleeNumber: 'EN-1',
  studentNumber: null,
  fullName: 'Ada Lovelace',
  applicationStatus: 'Submitted',
  levelApplied: 'P1',
  slotKey: 'birthCert',
  slotLabel: 'Birth certificate',
  fileUrl: 'https://example.test/file.pdf',
  isExpirable: false,
  owner: 'Student',
  category: 'general',
};

function approveButton() {
  return screen.getByRole('button', { name: /approve/i });
}

describe('ValidationQueue (Tier-1 optimistic)', () => {
  it('optimistically removes the row, toasts success, and refreshes', async () => {
    validateDocumentActionMock.mockResolvedValue({
      ok: true,
      data: { ok: true },
    });
    const user = userEvent.setup();
    renderWithClient(
      <ValidationQueue rows={[ROW]} ayCode="AY9999" canValidate />
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    await user.click(approveButton());

    await waitFor(() =>
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    );

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
    expect(validateDocumentActionMock).toHaveBeenCalledWith(
      'EN-1',
      'birthCert',
      'AY9999',
      { status: 'Valid' }
    );
  });

  it('rolls the row back on error and shows the route-specific message', async () => {
    validateDocumentActionMock.mockResolvedValue({
      ok: false,
      error: 'document_locked',
      status: 409,
    });
    const user = userEvent.setup();
    renderWithClient(
      <ValidationQueue rows={[ROW]} ayCode="AY9999" canValidate />
    );

    await user.click(approveButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('document_locked')
    );
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // The bug this prop exists to fix: the page admits `school_admin` as
  // read-only oversight (KD #74 + KD #31) while the PATCH route deliberately
  // excludes them, and this component took no viewer prop — so it rendered
  // Approve/Reject to everyone who could open the page, and every click 403'd.
  it('renders no actions when the viewer cannot validate', () => {
    renderWithClient(
      <ValidationQueue rows={[ROW]} ayCode="AY9999" canValidate={false} />
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reject/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /triage/i })
    ).not.toBeInTheDocument();
  });

  it('omitting the prop is read-only, not editable', () => {
    renderWithClient(<ValidationQueue rows={[ROW]} ayCode="AY9999" />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /approve/i })
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Update `__tests__/p-files/awaiting-queue.test.tsx` — same swap**

Apply the identical mock-the-action-not-fetch change: drop the `import { jsonResponse, stubFetch } from '../_utils/mock-fetch';` line, add the `validateDocumentActionMock` to the `vi.hoisted(...)` block, add `vi.mock('@/lib/sis/actions/validate-document', () => ({ validateDocumentAction: validateDocumentActionMock }));`, replace both `stubFetch(...)` calls with `validateDocumentActionMock.mockResolvedValue(...)` using the same `{ok:true,...}` / `{ok:false,...}` shapes as Step 5, and drop `vi.unstubAllGlobals()` from the `afterEach` (nothing stubs a global anymore).

- [ ] **Step 7: Run the full affected test set**

```bash
npx vitest run __tests__/admissions/validation-queue.test.tsx __tests__/p-files/awaiting-queue.test.tsx __tests__/ui/write-feedback-coverage.test.ts
```

Expected: all green. `write-feedback-coverage.test.ts` checks for `useWriteAction` usage by file content — unaffected, since every converted component still calls it exactly as before.

- [ ] **Step 8: Type-check, build, and commit**

```bash
npx tsc --noEmit
```

Expected: zero errors.

```bash
git add components/admissions/document-validation/validation-queue.tsx components/sis/document-validation-actions.tsx components/p-files/document-validation/awaiting-queue.tsx components/p-files/document-card.tsx __tests__/admissions/validation-queue.test.tsx __tests__/p-files/awaiting-queue.test.tsx
git commit -m "feat(actions): convert the four document-validation call sites to the Server Action

Each mutationFn now calls callAction(() => validateDocumentAction(...))
instead of apiFetch — useWriteAction, the optimistic onMutate/onError
snapshots, and every error-message branch are untouched, since
ActionError already extends Error the same way ApiError did."
```

### Task 16: Evaluation write-up — one shared function, a Server Action, and a thinner route handler

Same shape as Task 14, applied to `PATCH /api/evaluation/writeups`. The same behavior narrowing applies: the original route's 400 for a failed zod parse carried `details: parsed.error.flatten()`, and the roster client's only error handler reads `.message`, never `.details` — so it is dropped here too.

**Files:**

- Create: `lib/evaluation/upsert-writeup.ts`
- Create: `lib/evaluation/actions/upsert-writeup.ts`
- Modify: `app/api/evaluation/writeups/route.ts`
- Create: `__tests__/evaluation/upsert-writeup.test.ts`

**Interfaces:**

- Consumes: `requireRole` (`lib/auth/require-role.ts`), `withAuthAction`/`ActionResult` (Task 12), `EvaluationWriteupUpsertSchema` (`lib/schemas/evaluation.ts`), `logAction`, `invalidateDrillTags`, `requireCurrentAyCode` (`lib/academic-year.ts`), `createServiceClient`.
- Produces: `upsertWriteup()` — the one function holding every branch (the per-section adviser gate, the roster-membership check, the submit/resubmit/save audit action selection, the cache bust); `upsertWriteupAction()` — the Server Action Task 17's call site calls.

- [ ] **Step 1: Write the failing test**

`__tests__/evaluation/upsert-writeup.test.ts`:

```ts
/**
 * upsertWriteup() is the whole former body of PATCH /api/evaluation/writeups,
 * extracted so the route handler and the Server Action
 * (upsertWriteupAction) share ONE implementation. These cases pin the two
 * authorization branches unique to the `teacher` role (KD #28's soft gate —
 * registrar/school_admin/admin/superadmin are unrestricted) and the
 * submit/resubmit/save audit-action selection.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
}));

let assignmentResult: { data: unknown; error: unknown } = {
  data: { id: 'assign-1' },
  error: null,
};
let rosterResult: { data: unknown; error: unknown } = {
  data: { id: 'roster-1' },
  error: null,
};
let existingResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let savedResult: { data: unknown; error: unknown } = {
  data: {
    id: 'w-1',
    writeup: 'A holistic paragraph.',
    submitted: false,
    submitted_at: null,
    updated_at: '2026-08-30T00:00:00.000Z',
  },
  error: null,
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'teacher_assignments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve(assignmentResult),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'section_students') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: () => ({
                  maybeSingle: () => Promise.resolve(rosterResult),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'evaluation_writeups') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve(existingResult),
              }),
            }),
          }),
          upsert: () => ({
            select: () => ({ single: () => Promise.resolve(savedResult) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { upsertWriteup } from '@/lib/evaluation/upsert-writeup';

const BASE = {
  actor: { id: 'u-teacher', email: 'adviser@hfse.test' },
  body: {
    termId: '11111111-1111-4111-8111-111111111111',
    sectionId: '22222222-2222-4222-8222-222222222222',
    studentId: '33333333-3333-4333-8333-333333333333',
    writeup: 'A holistic paragraph.',
    submit: false,
  },
};

describe('upsertWriteup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assignmentResult = { data: { id: 'assign-1' }, error: null };
    rosterResult = { data: { id: 'roster-1' }, error: null };
    existingResult = { data: null, error: null };
    savedResult = {
      data: {
        id: 'w-1',
        writeup: 'A holistic paragraph.',
        submitted: false,
        submitted_at: null,
        updated_at: '2026-08-30T00:00:00.000Z',
      },
      error: null,
    };
  });

  it('refuses a teacher who is not the form adviser for this section', async () => {
    assignmentResult = { data: null, error: null };

    const result = await upsertWriteup({ ...BASE, role: 'teacher' });

    expect(result).toEqual({
      ok: false,
      error: 'You are not the form class adviser for this section.',
      status: 403,
    });
    expect(logAction).not.toHaveBeenCalled();
  });

  it("refuses when the student is not on this section's current roster", async () => {
    rosterResult = { data: null, error: null };

    const result = await upsertWriteup({ ...BASE, role: 'teacher' });

    expect(result).toEqual({
      ok: false,
      error: 'This student is not on the current roster for this section.',
      status: 403,
    });
  });

  it('saves a draft, audits evaluation.writeup.save, and busts the evaluation drill cache', async () => {
    const result = await upsertWriteup({
      ...BASE,
      role: 'academic_coordinator',
    });

    expect(result.ok).toBe(true);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evaluation.writeup.save' })
    );
    expect(invalidateDrillTags).toHaveBeenCalledWith('evaluation', 'AY2026');
  });

  it('stamps submitted_at and audits evaluation.writeup.submit on first submit', async () => {
    savedResult = {
      data: {
        id: 'w-1',
        writeup: 'A holistic paragraph.',
        submitted: true,
        submitted_at: '2026-08-30T01:00:00.000Z',
        updated_at: '2026-08-30T01:00:00.000Z',
      },
      error: null,
    };

    const result = await upsertWriteup({
      ...BASE,
      role: 'academic_coordinator',
      body: { ...BASE.body, submit: true },
    });

    expect(result.ok).toBe(true);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evaluation.writeup.submit' })
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails on the missing module**

```bash
npx vitest run __tests__/evaluation/upsert-writeup.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/evaluation/upsert-writeup'`.

- [ ] **Step 3: Extract `upsertWriteup` — read the current route in full before writing this**

Read `app/api/evaluation/writeups/route.ts` in full (185 lines). Then create:

`lib/evaluation/upsert-writeup.ts`:

```ts
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { EvaluationWriteupUpsertSchema } from '@/lib/schemas/evaluation';
import type { ActionResult } from '@/lib/query/action-result';
import type { Role } from '@/lib/auth/roles';

export type UpsertWriteupParams = {
  body: unknown;
  actor: { id: string; email: string | null };
  role: Role;
};

export type UpsertWriteupData = {
  ok: true;
  id: string;
  writeup: string | null;
  submitted: boolean;
  submitted_at: string | null;
  updated_at: string;
};

// Every branch of the former PATCH /api/evaluation/writeups handler,
// unchanged in behaviour. Shared by the route handler and the Server Action
// (upsertWriteupAction, lib/evaluation/actions/upsert-writeup.ts).
//
// Gate: teachers must hold a form_adviser teacher_assignment on the target
// section AND the target student must be on that section's current roster
// (KD #28's soft gate). Registrar/school_admin/admin/superadmin are
// unrestricted — `role` is resolved once by the caller (requireRole in the
// route, withAuthAction in the action) and passed in, same split as
// validateDocument's `capabilities` param (Task 14).
export async function upsertWriteup(
  params: UpsertWriteupParams
): Promise<ActionResult<UpsertWriteupData>> {
  const { body, actor, role } = params;

  const parsed = EvaluationWriteupUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid payload',
      code: 'invalid_payload',
      status: 400,
    };
  }
  const { termId, sectionId, studentId, writeup, submit } = parsed.data;
  const writeupProvided = 'writeup' in parsed.data;

  const service = createServiceClient();

  if (role === 'teacher') {
    const { data: assignment } = await service
      .from('teacher_assignments')
      .select('id')
      .eq('teacher_user_id', actor.id)
      .eq('section_id', sectionId)
      .eq('role', 'form_adviser')
      .maybeSingle();
    if (!assignment) {
      return {
        ok: false,
        error: 'You are not the form class adviser for this section.',
        status: 403,
      };
    }

    // Confirm studentId (also caller-supplied) actually belongs to this
    // section's current roster — the sectionId check above only proves
    // adviser-of-sectionId, not that studentId is on that roster.
    const { data: rosterRow } = await service
      .from('section_students')
      .select('id')
      .eq('section_id', sectionId)
      .eq('student_id', studentId)
      .neq('enrollment_status', 'withdrawn')
      .maybeSingle();
    if (!rosterRow) {
      return {
        ok: false,
        error: 'This student is not on the current roster for this section.',
        status: 403,
      };
    }
  }

  const { data: existing } = await service
    .from('evaluation_writeups')
    .select('id, writeup, submitted, submitted_at')
    .eq('term_id', termId)
    .eq('student_id', studentId)
    .maybeSingle();

  const nextWriteup = writeupProvided
    ? (writeup ?? null)
    : (existing?.writeup ?? null);
  const wasSubmitted = existing?.submitted ?? false;
  const nextSubmitted =
    submit === true ? true : submit === false ? false : wasSubmitted;
  const nextSubmittedAt =
    submit === true
      ? new Date().toISOString()
      : submit === false
        ? null
        : (existing?.submitted_at ?? null);

  const row = {
    term_id: termId,
    section_id: sectionId,
    student_id: studentId,
    writeup: nextWriteup,
    submitted: nextSubmitted,
    submitted_at: nextSubmittedAt,
    created_by: existing ? undefined : actor.id,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error: upsertErr } = await service
    .from('evaluation_writeups')
    .upsert(row, { onConflict: 'term_id,student_id' })
    .select('id, writeup, submitted, submitted_at, updated_at')
    .single();
  if (upsertErr || !saved) {
    return {
      ok: false,
      error: upsertErr?.message ?? 'save failed',
      status: 500,
    };
  }

  const textChanged =
    writeupProvided && (existing?.writeup ?? null) !== nextWriteup;
  const submittedChanged = nextSubmitted !== wasSubmitted;

  let action:
    | 'evaluation.writeup.submit'
    | 'evaluation.writeup.resubmit'
    | 'evaluation.writeup.save'
    | null = null;
  if (submit === true) {
    action = wasSubmitted
      ? 'evaluation.writeup.resubmit'
      : 'evaluation.writeup.submit';
  } else if (textChanged || (submit === false && wasSubmitted)) {
    action = 'evaluation.writeup.save';
  }

  if (action) {
    await logAction({
      service,
      actor,
      action,
      entityType: 'evaluation_writeup',
      entityId: saved.id,
      context: {
        term_id: termId,
        section_id: sectionId,
        student_id: studentId,
        length: nextWriteup?.length ?? 0,
        submitted: nextSubmitted,
        ...(submit === false && wasSubmitted ? { un_submitted: true } : {}),
        ...(submit === true ? { submitted_at: nextSubmittedAt } : {}),
      },
    });
  }

  if (textChanged || submittedChanged) {
    invalidateDrillTags('evaluation', await requireCurrentAyCode(service));
  }

  return {
    ok: true,
    data: {
      ok: true,
      id: saved.id,
      writeup: saved.writeup,
      submitted: saved.submitted,
      submitted_at: saved.submitted_at,
      updated_at: saved.updated_at,
    },
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
npx vitest run __tests__/evaluation/upsert-writeup.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Add the Server Action**

`lib/evaluation/actions/upsert-writeup.ts`:

```ts
'use server';

import { withAuthAction } from '@/lib/auth/with-auth-action';
import {
  upsertWriteup,
  type UpsertWriteupData,
} from '@/lib/evaluation/upsert-writeup';
import type { ActionResult } from '@/lib/query/action-result';

export async function upsertWriteupAction(
  body: unknown
): Promise<ActionResult<UpsertWriteupData>> {
  const action = withAuthAction(
    {
      kind: 'role',
      roles: ['teacher', 'academic_coordinator', 'school_admin', 'superadmin'],
    },
    async (auth) =>
      upsertWriteup({
        body,
        actor: { id: auth.user.id, email: auth.user.email },
        role: auth.role,
      })
  );
  return action();
}
```

- [ ] **Step 6: Rewire the route handler**

Replace `app/api/evaluation/writeups/route.ts` in full with:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { upsertWriteup } from '@/lib/evaluation/upsert-writeup';

// PATCH /api/evaluation/writeups — thin HTTP adapter over upsertWriteup()
// (lib/evaluation/upsert-writeup.ts), the same function the Server Action
// (lib/evaluation/actions/upsert-writeup.ts) calls. Kept alive for the same
// reason as the document-validation route (Task 14) — no non-UI caller
// today, but a stable contract and a rollback path cost one thin wrapper.
export async function PATCH(request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const result = await upsertWriteup({
    body,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    role: auth.role,
  });

  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}
```

- [ ] **Step 7: Type-check and confirm nothing else broke**

```bash
npx tsc --noEmit
npx vitest run __tests__/evaluation __tests__/auth/assignment-read-classification.test.ts
```

Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add lib/evaluation/upsert-writeup.ts lib/evaluation/actions/upsert-writeup.ts app/api/evaluation/writeups/route.ts __tests__/evaluation/upsert-writeup.test.ts
git commit -m "refactor(evaluation): extract upsertWriteup, add the Server Action, thin the route

Same split as the document-validation route (Task 14) — the adviser
gate, the roster-membership check, and the submit/resubmit/save audit
selection all live in lib/evaluation/upsert-writeup.ts, exercised by
both the route handler and upsertWriteupAction."
```

### Task 17: Evaluation write-up — convert the roster call site

**Files:**

- Modify: `components/evaluation/writeup-roster-client.tsx`

**Interfaces:**

- Consumes: `callAction` (Task 12), `upsertWriteupAction` (Task 16).
- Produces: the roster's Save/Submit buttons call the Server Action instead of `apiFetch`. `saveMutation`'s `onMutate`/`onSuccess`/`onError` callbacks are untouched.

- [ ] **Step 1: Convert the mutation**

Replace the import:

```ts
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
```

with:

```ts
import { callAction } from '@/lib/query/action-error';
import { upsertWriteupAction } from '@/lib/evaluation/actions/upsert-writeup';
```

Replace the mutation:

```ts
  const saveMutation = useMutation({
    mutationFn: ({ studentId, text, submit }: SaveVars) =>
      apiFetch<SaveResult>(
        '/api/evaluation/writeups',
        jsonInit('PATCH', {
          termId,
          sectionId,
          studentId,
          writeup: text,
          submit,
        })
      ),
```

with:

```ts
  const saveMutation = useMutation({
    mutationFn: ({ studentId, text, submit }: SaveVars) =>
      callAction(() =>
        upsertWriteupAction({
          termId,
          sectionId,
          studentId,
          writeup: text,
          submit,
        })
      ),
```

`onMutate`/`onSuccess`/`onError` need no change: `onSuccess`'s `body` parameter now has the (wider) `UpsertWriteupData` shape instead of the local `SaveResult` type, which is a structural superset (`submitted`/`submitted_at` are present on both), and `onError`'s `e instanceof Error ? e.message : 'save failed'` already produces the right message for an `ActionError`.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. (There is no existing test file for `writeup-roster-client.tsx` to update — confirmed by searching `__tests__/` before this task started.)

- [ ] **Step 3: Commit**

```bash
git add components/evaluation/writeup-roster-client.tsx
git commit -m "feat(actions): convert the write-up roster to the Server Action

Save as draft / Submit / Resubmit now call
callAction(() => upsertWriteupAction(...)) instead of apiFetch — the
per-row saving flag, inline error and dirty-state tracking are untouched."
```

### Task 18: Full-suite verification and the one thing that needed a real browser

**Files:** none — verification only.

**Interfaces:**

- Consumes: everything from Tasks 12–17.
- Produces: confidence that the five converted call sites work end to end in a production build, and a direct answer — proven in a browser, not reasoned about — to the one question the design investigation could not settle by reading code: what a user actually sees when their session expires mid-action.

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: green apart from the pre-existing known flakes (Global Constraints, top of this plan). Nothing in Tasks 12–17 touches any of the flaking files.

- [ ] **Step 2: Type-check and production build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0. Watch the route table in the build output — `app/api/sis/students/[enroleeNumber]/document/[slotKey]` and `app/api/evaluation/writeups` should still be listed as routes (the thin wrappers didn't disappear), and the two pages hosting the converted client components should build with no new client-bundle warnings about `'use server'` files.

- [ ] **Step 3: Browser pass — all five converted call sites, normal path**

```bash
npm run build && npm start
```

Sign in and, for each of the five call sites, open DevTools → Network first so the request shape is visible:

1. `/admissions/applications/[enroleeNumber]` — reject a document via `document-validation-actions.tsx`'s Reject dialog.
2. Wherever `validation-queue.tsx` renders (the admissions document-validation queue) — approve a document.
3. `/p-files/document-validation` (the Awaiting queue) — approve a document.
4. `/p-files/[enroleeNumber]` — approve a document via a `DocumentCard`.
5. `/evaluation/sections/[sectionId]` — Save as draft, then Submit, on the write-up roster.

For every one: confirm the Network tab shows a **POST to the current page's own URL** (not to `/api/sis/...` or `/api/evaluation/...` — that is the visible proof the Server Action is actually being used, not a stray fallback to the old route), the pending → success toast sequence from `useWriteAction` still fires in the right order, and the list/roster reflects the change after the toast. This is the same manual pass Task 3's browser-verify steps already establish the habit for.

- [ ] **Step 4: The session-expiry drill — the one thing the design investigation flagged as reasoned-not-observed**

This is the residual unknown named in the Phase 4 design work: Next's own source and docs fully determine what _should_ happen (traced end to end before this plan was written), but nobody had put a real browser through it. Do this exactly:

1. Sign in as any staff role in a real browser (not the dev server's fast-refresh session — a real sign-in).
2. Open `/evaluation/sections/[a real sectionId]` (the write-up roster).
3. Type something in one student's textarea, but do **not** click Save yet.
4. In DevTools → Application → Cookies, delete every `sb-*` cookie (the Supabase session cookies) — do this **without reloading the page**.
5. Click **Save as draft**.
6. **Expected, post-Task-13 fix:** the Network tab shows exactly **one** request — a POST to `/evaluation/sections/[sectionId]` with a `next-action` header, answered `401` with `content-type: text/plain`. No second request. The error toast (from `useWriteAction`'s `catch` branch, via `defaultErrorMessage`) reads **"Your session has expired. Please sign in again."** — the exact string `withAuthAction`/`proxy.ts` both use. The textarea's typed text is still there (nothing was lost; it just didn't save).
7. **If instead you see two requests** (a POST, then a second POST to `/login` carrying the same `next-action` header) **and a toast reading something about "Server Action" not being found**, Task 13's proxy fix did not land correctly — stop and re-check the `isServerActionRequest` branch in `lib/supabase/proxy.ts` before treating any other step in this task as trustworthy.
8. Reload the page. Confirm it redirects to `/login` normally (the ordinary, unrelated GET-navigation path, which Task 13 deliberately left untouched).

- [ ] **Step 5: Record the outcome**

If Step 4 matched the expected behavior, Phase 4 is done — the proxy/Server-Action interaction that the design investigation could only reason about from Next's source is now confirmed against a real browser, not assumed. If it did not match, the bug is almost certainly in Task 13 (the `isServerActionRequest` branch) rather than in Tasks 14–17, since Steps 1–3 already prove the actions themselves work correctly when the session is valid.

---

## Deferred — not in this plan

> **In one line:** not in the plan are Cache Components (genuinely multi-week,
> and the risky part is 68 dialogs that would start staying open when you
> navigate back) and view transitions. Server Actions were also raised here
> originally — see Phase 4 above, where the two surfaces worth converting
> were promoted out of this list and built as Tasks 12–18.

- **Phase 4: Cache Components + Partial Prefetching.** 18 layouts restructured, 68 dialog/sheet files audited for the `<Activity>` state-preservation change, route-by-route conversion behind the `cache-components-instant-false` codemod. Multi-week, quiet regression surface. Needs its own plan and its own branch. Vercel ships `next-cache-components-adoption` and `next-partial-prefetching-adoption` skills that work route-by-route.
- **View transitions (`Crossfade` on Suspense reveals).** Worth more _after_ Phase 2, since it animates the handoff into skeletons that must exist first. Needs `::view-transition { pointer-events: none }` or clicks during the animation are lost, and all 9 module layouts have sticky headers that would need anchoring.
- **Server Actions for the two highest-frequency write surfaces — PROMOTED into Phase 4 above (Tasks 12–18), no longer deferred.** Raised by Mr Ace on 2026-08-29. His position: traditional API routes are fine as the general architecture — the interest is that **specific write actions** could be Server Actions instead, for **speed**. ⚠ **There was no recorded decision behind the prior architecture** — "server action" appeared **zero times** across every key-decision file, every context doc and CLAUDE.md before this pass, so it was never weighed and rejected; it was defaulted into.

  **The speed argument is real and mechanical.** An API-route write is **two round trips**: `fetch` writes and returns JSON, then the client calls `router.refresh()` before the user sees the change — which is what `useWriteAction` (KD #186) does across all 80 write components. A Server Action is **one**: the mutation and the re-rendered RSC payload come back in the same response. Both trips also pass the claim check in `proxy.ts`, so it is two auth resolutions, not just two network hops.

  **MEASURED 2026-08-30 by an exhaustive sweep of all 88 write endpoints** (detail: two reports written to the session scratchpad; the counts below are the durable part; Phase 4's own design pass re-verified the candidate list against the actual components — see the correction below — before anything was built).

  **Almost everything CAN convert — that was never the constraint.** Of 88 write endpoints, only **6** can never be Server Actions: **2 external** (the parent portal's `declarations` and its `/evidence` upload — CORS + Bearer), **3 cron** (`grading-sheets/lock-overdue`, `sis/students/auto-sync`, both `Bearer CRON_SECRET`), and **1 email link** (`change-requests/act`, HMAC-token-only with no session check at all). The remaining **82 are internal**. ⚠ **An earlier draft of this entry said "the parent AND ADMISSIONS portals" — that was wrong. There is no `app/api/admissions-portal/` directory**; only the parent portal has API routes here.

  🔴 **The real constraint was that converting is only worth it where the second round trip is felt — and that is five call sites across two routes, not a module.** ⚠ **The two surfaces this entry originally named — attendance marking and mark entry — were asserted without checking, and both were already solved:** `components/attendance/wide-grid.tsx` and `components/grading/score-entry-grid.tsx` are already optimistic with a debounced/coalesced refresh, and `components/attendance/daily-entry.tsx` already bulk-batches to one write per class per day. **Those stayed out of scope.** 🔴 **This list also had two of its own errors, caught while scoping Phase 4 by reading every file rather than trusting the earlier grep:** `components/p-files/document-validation/expiring-queue.tsx` does **not** call the document-validation route at all — its only write is a `Notify` button hitting a different route (`/api/p-files/[enroleeNumber]/notify`) — while `components/p-files/document-card.tsx` (the P-Files single-student detail card, with its own approve/reject pair) was missing from this list entirely. The real, verified candidates, all converted in Phase 4:
  1. **Document validation queues** — `components/admissions/document-validation/validation-queue.tsx`, `components/sis/document-validation-actions.tsx`, `components/p-files/document-validation/awaiting-queue.tsx`, and `components/p-files/document-card.tsx` (four call sites, all against `PATCH /api/sis/students/[enroleeNumber]/document/[slotKey]`). 20–30 approve/reject pairs per session and, unlike the grids, **the refresh is NOT debounced** — every decision pays the full second round trip.
  2. **Evaluation write-up roster** — `components/evaluation/writeup-roster-client.tsx` (one call site, against `PATCH /api/evaluation/writeups`). 20–30 explicit Save/Submit clicks per session, only partial optimistic UI, the user waits per row.

  The sweep found **no** repetitive checklist, reorder or index-assignment surface — those are all once-a-term or once-a-year. Stacks with `useOptimistic`, which would make these feel instant before the round trip lands — not attempted in Phase 4, and worth its own look afterward.

  ⚠ **A convention layer had grown on top of route handlers** — `requireRole()`/`requireAnyCapability()`, `lib/audit/log-action.ts`, `revalidateTag`/`invalidateDrillTags`, JSON errors with machine codes, `410 Gone` tombstones — and Phase 4 found that four of those five port into a Server Action with zero code change; only the error shape needed new design (`ActionResult<T>`, Task 12). ⚠ **3 routes do real file I/O** (`attendance/import` xlsx, `p-files/[enroleeNumber]/upload` multipart + pdf-merge, `parent/v2/declarations/evidence`) and are poor Server Action fits; two are already cross-origin, so they stay HTTP regardless — none of the three are among the two surfaces above, so this was never a blocker for Phase 4.

  **Honest scale, confirmed by building it: a targeted change to five call sites across two routes, not an architecture migration.** The other ~80 internal write routes stay route handlers, exactly as this entry originally scoped — this was never proposed as a wholesale migration and still isn't one.

- **Unrelated findings from the same sweep, worth their own look.** Not performance work, recorded so they are not lost: **4 write routes have no discoverable client call site** — `compute/quarterly` is a documented script-only escape hatch (KD #154), but `sis/admin/subjects/[configId]/resync`, `sis/admin/subjects/level-offerings` and `students/sync` look dead or never-wired, and one carries a header comment describing a drag-and-drop gesture that exists nowhere in `components/`. Separately, **2 POST routes write nothing** — `grading-sheets/bulk-create/preview` and `sis/students/raw-columns` use POST only to carry a request body.
