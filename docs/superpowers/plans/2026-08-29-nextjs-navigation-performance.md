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
