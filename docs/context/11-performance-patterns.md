# 11 — Performance Patterns

The playbook for making pages feel fast in this app. Apply to every new feature. Adopted 2026-04-18 after a pass that cut per-nav auth latency from ~200–500ms to ~1–5ms and cached/parallelized the dashboard + grading list. Extended 2026-04-17 with a second pass: migrated all server-component layouts + pages off `getUser()`, scoped the grading list's `grade_entries` fetch to visible sheets, deduplicated the report card API, eliminated a double-fetch on the P-Files detail page, replaced a 1000-row O(n log n) merge with an O(n) linear merge on the audit log, hoisted `unstable_cache` wrappers to module scope, and fixed a 550-component re-render storm in the grading grid.

## 1. Auth on the hot path

- **Middleware uses `getClaims()`, not `getUser()`.** `lib/supabase/middleware.ts` calls `supabase.auth.getClaims()`, which verifies the JWT signature locally against the cached JWKS — no network round-trip per navigation. `proxy.ts` reads role via `getRoleFromClaims(claims)` from `lib/auth/roles.ts`.
- **`proxy.ts` matcher excludes `/api/*`.** API routes authenticate themselves via `requireRole()` inside each handler. Running the proxy on them was pure overhead.
- **Page / server-component code: use `getSessionUser()` from `lib/supabase/server.ts`.** It wraps `supabase.auth.getClaims()` and returns a lightweight `{ id, email, role: Role | null }` — everything a page needs without the Supabase Auth round-trip. All 3 layouts and 12 nested pages migrated off `getUser()` in the 2026-04-17 pass — greenfield pages should follow suit.
  - References: `app/(dashboard)/layout.tsx`, `app/(p-files)/layout.tsx`, `app/(parent)/layout.tsx`, `app/(dashboard)/grading/[id]/page.tsx`, `app/(dashboard)/admin/audit-log/page.tsx`, `app/(p-files)/p-files/page.tsx`.
- **When you still need `createClient()` for DB queries**, import both: `import { createClient, getSessionUser } from '@/lib/supabase/server'`. Call `getSessionUser()` first for auth, then `createClient()` only if the page does cookie-scoped DB reads beyond what `createServiceClient()` covers.
- **`app/(dashboard)/grading/page.tsx` reads `getClaims()` directly** (via `supabase.auth.getClaims()`) because it needs the raw claims object. That's fine — `getSessionUser()` is sugar, not mandatory.
- **API routes use `requireRole()`** from `lib/auth/require-role.ts`. As of 2026-04-25 it also authenticates via `getClaims()` (no Supabase Auth round-trip) and returns `{ user: { id, email }, role }`. If a handler needs more than id+email+role, look the full Supabase user up via `createServiceClient().auth.admin.getUserById(id)`.
- **Tradeoff:** claims reflect token state at issue time. A role change in `app_metadata` lands after the next token refresh (~1h). Fine for this app — staff roles are effectively static.
- **Caveat:** `getClaims()` only performs local verification when the Supabase project uses asymmetric JWT signing keys (default for new projects since 2024). With legacy HS256 keys, `auth-js` silently falls back to a network `getUser()` call. Verify under Auth → JWT Keys if the win doesn't materialize.

## 2. Server-component data fetching

- **Default to parallel.** Two sequential `await supabase.from(...)` calls in a page is a bug. Use `Promise.all([...])`. Dependent queries run in waves — fetch IDs first, then the dependent counts in a single second-wave `Promise.all`. References: `app/(dashboard)/page.tsx::loadStatsUncached`, `app/(dashboard)/grading/[id]/page.tsx` (sheet fetch → `Promise.all([changeRequests, entries])`).
- **Combine count + rows in one query** when both are needed: `.select('id', { count: 'exact' })` returns the rows *and* the exact count in a single round-trip. Don't issue a separate `head: true` count query next to a rows query against the same table.
- **Avoid `select('*')` on wide tables.** When the caller only needs a subset of columns (status, expiry, etc.), enumerate them. The `ay{YY}_enrolment_documents` dashboard query lists exactly the columns needed per slot instead of selecting all document-URL text fields. Reference: `lib/p-files/queries.ts::loadRawDataUncached`.
- **Filter at the DB, not in JS.** If searchParams carry a filter the DB can apply, push it there before fetching 500 rows to filter down to 5. Reference: `app/(dashboard)/admin/audit-log/page.tsx` pushes `sheet_id` and `action` into `.contains()` / `.eq()` before capping to 500 rows.
- **Scope wide-table fetches to an id set you've already derived.** Fetch the sheet list first (RLS-scoped), then pass those IDs into an `.in('grading_sheet_id', sheetIds)` filter on the blanks query — don't re-scan the full `grade_entries` table. Reference: `app/(dashboard)/grading/page.tsx`.
- **Cache what's safe.** School-wide, service-client reads → wrap in `unstable_cache` with a short TTL and a descriptive tag. References:
  - `app/(dashboard)/page.tsx::loadStats` — 60s TTL, tag `dashboard-stats`.
  - `lib/admissions/dashboard.ts` — 10min TTL, tag `admissions-dashboard:${ayCode}`.
  - `lib/p-files/queries.ts::loadRawData` — 600s TTL, tags `p-files-dashboard`, `p-files-dashboard:${ayCode}`.
- **Hoist the `unstable_cache` wrapper to module scope.** Creating the wrapper inside a function call (`return unstable_cache(...)()` in a per-request function) can break cache stability across Next.js versions. The safe form is `const loadStats = unstable_cache(loadStatsUncached, [...], { ... })` at the top of the file. References: `app/(dashboard)/page.tsx::loadStats`, `lib/admissions/dashboard.ts`.
- **Don't cache RLS-scoped queries.** Rows differ per user; caching creates either cross-contamination risk or degenerates into per-user cache slots with no real win. Just parallelize them. Reference: `app/(dashboard)/grading/page.tsx`.
- **Top-level parallelization.** Even cached calls should overlap with other fetches. Kick off multiple independent `Promise`s and `await Promise.all([...])` — don't pay for them serially. Reference: `app/(dashboard)/page.tsx` (`loadStats` + `getPipelineCounts` + `getOutdatedApplications` all in one `Promise.all`).
- **Deduplicate query pipelines.** If a page and an API route both need the same data shape, extract one canonical builder and have both call it. Reference: `lib/report-card/build-report-card.ts` is the single source; `app/(dashboard)/report-cards/[studentId]/page.tsx`, `app/(parent)/parent/report-cards/[studentId]/page.tsx`, and `app/api/report-card/[studentId]/route.ts` all consume it.
- **Return the raw row alongside the computed view** when the caller is going to need both. Forcing the consumer to re-fetch the same row doubles the round-trips. Reference: `lib/p-files/queries.ts::getStudentDocumentDetail` returns `{ ...completeness, rawDocRow }` so the detail page doesn't re-fetch `enrolment_documents` for the file URLs.
- **Tag invalidation (future):** when freshness matters more than 60s, call `revalidateTag('dashboard-stats')` from the mutating API route. Not wired yet — current TTL covers it.

## 3. In-memory work in server components

- **Linear merge over sort() for pre-sorted arrays.** When two DB queries both return `ORDER BY X DESC` and you need to merge-cap to N, a standard linear merge is O(n) and allocates nothing; `concat().sort()` is O(n log n) and constructs a `Date` per comparison. Reference: `app/(dashboard)/admin/audit-log/page.tsx` (two-pointer merge of `audit_log` + legacy `grade_audit_log`, bounded by `merged.length < 500`).
- **Don't construct `Date` objects inside sort comparators.** ISO-8601 timestamp strings compare lexicographically, so `a.at >= b.at` works directly. Every `new Date(x).getTime()` allocation in a sort callback runs per comparison — with 1000 rows that's ~10k allocations.

## 4. Loading UX

- **Every route segment with >1 server fetch on first paint needs a `loading.tsx`.** Without one, Next.js sits on the previous page until the RSC work resolves. Navigation feels broken even when it isn't.
- **Reuse `Skeleton`** from `components/ui/skeleton.tsx` and wrap in `PageShell` so the sidebar frame doesn't jump.
- **Tailor the shape to the page** (card grid, table rows, document). A generic spinner is worse than a well-matched skeleton because the layout shifts when real content arrives.
- **Shared skeletons** live next to the component they mirror. Reference: `components/report-card/report-card-skeleton.tsx` is reused by both `app/(dashboard)/report-cards/[studentId]/loading.tsx` and `app/(parent)/parent/report-cards/[studentId]/loading.tsx`.
- **Skip `loading.tsx`** on static-ish pages (login, account, forms with no server fetching) — it adds visual noise for no gain.

## 5. Client-side rendering & state

- **Don't put mutable state in `useCallback` dependency arrays if a ref will do.** `ScoreEntryGrid::patchEntry` used to depend on `rows`, which meant every successful save recreated the callback, which changed the `onCommit` prop on 50×11 = 550 cells and re-rendered the whole grid. Fix: `const rowsRef = useRef(rows); rowsRef.current = rows;` and read `rowsRef.current.find(...)` inside the callback, with `rows` removed from the dep array. The state update path (`setRows(current => ...)` functional form) already works fine. Reference: `components/grading/score-entry-grid.tsx`.
- **Rule of thumb:** if a callback only *reads* a piece of state to compose a toast or log message (not as part of the update itself), a ref is correct. If it uses the value to decide what to write, use the functional setter.

## 6. Client-side data (TanStack Query)

- **Not adopted app-wide.** RSC + `unstable_cache` handles almost everything this app does. Adding a client-side query lib to RSC pages gives you nothing and costs bundle size.
- **One legitimate candidate:** the grading grid autosave (`components/grading/score-entry-grid.tsx`). Optimistic updates, retry/rollback, and dedupe would be a genuine UX win there. Targeted refactor only — don't spread it to RSC pages.

## 7. Checklist before shipping a new feature

Before marking any new page or feature done, walk through:

- [ ] No `getUser()` calls in middleware or server-component page code — use `getSessionUser()` (or `getClaims()` directly for the raw claims object).
- [ ] Any two sequential `await supabase.from(...)` collapsed into `Promise.all`.
- [ ] Combined `select('id', { count: 'exact' })` anywhere you need both rows and count against the same table.
- [ ] Explicit column list on wide tables — no gratuitous `select('*')` when only a subset is used.
- [ ] Searchparams / filter props pushed to the DB query, not applied in JS after a full fetch.
- [ ] Wide-table fetches scoped via `.in('x', ids)` against an already-known id set, not an unfiltered table scan.
- [ ] School-wide / service-client reads wrapped in `unstable_cache` with a descriptive tag, **hoisted to module scope** (not recreated per request).
- [ ] Pre-sorted arrays merged with a linear two-pointer walk, not `concat().sort()`.
- [ ] No `new Date(...)` allocations inside sort comparators — compare ISO strings directly.
- [ ] `loading.tsx` added for any new route segment with real server-side fetching.
- [ ] Mutating API routes that touch cached data call `revalidateTag(...)` (when freshness matters more than the TTL).
- [ ] Any shared query pipeline (used by a page *and* an API route) has exactly one canonical implementation.
- [ ] Per-cell autosave, optimistic updates, or retry logic? Consider TanStack Query; otherwise stay on raw state.
- [ ] `useCallback`/`useMemo` dependencies reviewed — mutable state only in deps if the callback's *write* depends on it; otherwise read via `useRef`.
