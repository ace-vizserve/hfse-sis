# Next.js navigation performance — findings and scope

**Date:** 2026-08-29
**Status:** Spec. Phases 1–2 approved for execution; Phase 3 is preparation only; Phase 4 is NOT approved.
**Source:** Two documents Mr Ace supplied on 2026-08-29 —
[Designing view transitions](https://nextjs.org/docs/app/guides/view-transitions) and
[Building App-like Experiences with Next.js 16.3](https://nextjs.org/blog/building-app-like-experiences-with-nextjs-16-3) —
plus the eleven guides and API references they point at, all read in full.

---

## 1. Why this is being reopened

View Transitions were evaluated on **2026-07-29** and rejected; the navigation
findings from the same pass were judged real but deferred. That decision is
recorded in the `project-nav-perf-evaluated-deferred` memory.

Both documents have been **rewritten since** (`lastUpdated: 2026-08-25`), and
Next.js 16.3 shipped "Instant Navigations" in between. Two of the three reasons
behind the July rejection no longer hold.

⚠ **The July note leaned on "nobody has complained."** Mr Ace ruled that out on
2026-08-29: _"dont matter the nobody has complained bro what does that matter"_.
Absence of complaint is a reason not to **rebuild** something, not a reason to
leave the app feeling worse than it should. **Do not re-raise it.**

---

## 2. Corrections to earlier statements in this same session

Both were produced by reasoning instead of reading, which is the failure mode
`feedback-corrections-must-cite-source` warns about. They are recorded because
the pattern will recur, not because the conclusions are interesting.

### 2.1 `updateTag` is UNUSABLE in this codebase

It was called "the real find" and recommended as the thing to lead with. It is
**Server-Actions-only** — the API reference states it "can **only** be called
from within Server Actions… It cannot be used in Route Handlers, Client
Components, or any other context," and throws elsewhere.

Measured: **`'use server'` appears in 0 files.** All **63** `revalidateTag`
calls sit in API route handlers (**26** `route.ts` files). There is no Server
Action to call it from.

✅ **Nothing is lost today.** The migration guide states that `revalidateTag`
_without_ a profile is "legacy behavior which is equivalent to `updateTag`" —
so the existing 63 calls already carry immediate-expiry semantics. Only under
Cache Components would they need an explicit profile.

### 2.2 Cache Components is NOT blocked by this app's auth model

It was claimed that 103 pages reading the session cookie put Cache Components
out of reach. **False.** `'use cache: private'` exists precisely for this: it
reads `cookies()`, `headers()` and `searchParams` inside a cached scope and
keeps the result **in the browser only, never on the server**.

There is a dedicated guide — _Authentication with Cache Components_ — whose
worked example is a `getCurrentUser()` marked `'use cache: private'` with
`redirect('/login')` inside it. The `redirect()` throws to interrupt rendering,
so only a resolved user is ever cached.

The migration also has an escape hatch that was missed: `export const instant =
false` per segment, plus a codemod (`cache-components-instant-false`) that
stamps it across the whole app in one pass, so everything keeps building while
routes convert one at a time.

**The auth model is not a wall. It is a long road.** That distinction is what
moves Cache Components from "rejected" to "deferred, with a known cost."

### 2.3 The cost of Cache Components was inflated ~10×

Three counts were quoted as required migration work. Two were wrong:

| Claimed                              | Actual         | Why the first number was wrong                                                                                                                  |
| ------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 59 synchronous-date sites to fix     | **5 files**    | 47 of the 62 hits are in **API route handlers, which never prerender**; 2 more are in client components                                         |
| 59 `unstable_cache` files to migrate | **0 required** | The migration guide: existing `fetch` and `unstable_cache` caching "keeps working as a separate layer" — you convert only what validation flags |
| 85 dialog/sheet files at risk        | **68 files**   | Refined to those actually holding `useState(false)` open state                                                                                  |

⚠ **The lesson: a grep count is not a work estimate.** Counting hits without
asking where they live produced a multi-week figure for what is, in the first
three phases, about three days of work.

---

## 3. Version facts, measured against this tree

| Fact                                                            | Value                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Installed                                                       | `next@16.2.10`, `react@19.2.4`, `react-dom@19.2.4`                                                                                       |
| `cacheComponents` in installed config schema                    | ✅ present (top-level, no longer experimental)                                                                                           |
| `partialPrefetching` in installed config schema                 | ❌ **absent — 16.3 only**                                                                                                                |
| `experimental.viewTransition` on 16.2.10                        | Still present, still defaults to `false`                                                                                                 |
| `staleTimes`                                                    | ✅ **not** deprecated (it is `experimental.ppr` that merged into `cacheComponents`)                                                      |
| `updateTag` / `cacheLife` / `cacheTag` exported by `next/cache` | ✅ all three, 0 usages                                                                                                                   |
| `react@19.2.4` exports `ViewTransition`                         | ❌ no — only `next/dist/compiled/react` does                                                                                             |
| `ViewTransition` types                                          | Only in `@types/react/canary.d.ts`; needs `"types": ["react/canary"]` in tsconfig, which opts the **whole repo** into canary React types |

⚠ **The "no configuration needed" line in the view-transitions guide is true
for 16.3, not for 16.2.10.** Any view-transition work on the current version
still needs the flag.

⚠ **Not verified:** whether the `instant` segment config, the instant-navigation
validation insights, or the Navigation Inspector exist on 16.2.10. The entire
Cache Components migration workflow is built around that tooling. This is an
additional reason the upgrade comes first.

---

## 4. Measured state of this codebase

| Surface                                                     |              Count | Relevance                                                            |
| ----------------------------------------------------------- | -----------------: | -------------------------------------------------------------------- |
| `page.tsx` routes                                           |                112 | —                                                                    |
| Routes **with** `loading.tsx`                               |                 58 | —                                                                    |
| Routes **without** `loading.tsx`                            |             **54** | ~19 legitimately exempt; the rest are the Phase 2 work               |
| Pages calling `getSessionUser()`                            |                103 | Every route is dynamic (KD #35)                                      |
| Layouts awaiting the session at top level                   |       **18 of 19** | Phase 4 structural work — a top-level `await` holds `{children}` too |
| Synchronous dates in **server pages**                       |        **5 files** | Phase 3                                                              |
| Synchronous dates in route handlers                         | 47 hits / 35 files | ❌ irrelevant — route handlers never prerender                       |
| `Math.random()` / `crypto.randomUUID()` in `app/`           |              **0** | Clean                                                                |
| Files with `useSearchParams`                                |                 11 | Need Suspense boundaries under Cache Components                      |
| Dialog/sheet files with local open state                    |             **68** | The Activity risk (§5)                                               |
| `runtime = 'edge'`                                          |                  0 | Clean — Cache Components requires Node runtime                       |
| Route segment configs (`dynamic`/`revalidate`/`fetchCache`) |                  1 | Clean                                                                |
| `generateStaticParams`                                      |                  0 | Clean                                                                |
| Server Actions (`'use server'`)                             |              **0** | Blocks `updateTag`, `useActionState` form patterns                   |
| `useOptimistic` usages                                      |                  0 | —                                                                    |
| Playwright / `@next/playwright`                             |      Not installed | Test suite is vitest-only                                            |

---

## 5. The largest risk, and it is not the caching

Under Cache Components, Next.js **stops unmounting pages**. It hides them with
React's `<Activity>` in `hidden` mode, preserving up to **3 routes**. React
state and DOM state both survive navigation: form drafts, scroll position,
`<details>` expansion — and **open dialogs**.

**68 files** in this app hold a sheet or dialog with local `useState(false)`
open state. Consequences documented in _Preserving UI state_:

- **Transient popovers stay open.** Navigate away mid-dropdown, come back, it is
  still open. Fix is a `useLayoutEffect` cleanup that closes on hide.
- **Dialogs with initialization effects break silently.** If `isDialogOpen` was
  already `true` when hidden, re-opening sets `true` over `true`, no state change
  occurs, and the effect (focus an input, seed a form) never re-fires. The
  documented fix is deriving dialog state from a search param instead.
- **Stale success/error messages persist** on forms the user returns to.
- **E2E testing changes** — hidden content stays in the DOM with `display: none`,
  so selectors must be visibility-aware.

⚠ **This fails quietly rather than at build time**, which makes it a larger
practical risk than the caching work. It is the main reason Phase 4 is not
approved as part of this plan.

---

## 6. Scope decision

### Approved — Phases 1 and 2

1. **Upgrade to `next@16.3.x`.** Hours. Unlocks `partialPrefetching`, drops the
   `experimental.viewTransition` flag requirement, and removes the
   `"types": ["react/canary"]` problem for any future view-transition work.
2. **`loading.tsx` coverage sweep.** The biggest felt improvement available.
   On the ~35 non-exempt routes with no `loading.tsx`, a click currently
   produces **no feedback at all** until the page swaps in.

### Preparation only — Phase 3

3. **The 5 synchronous-date server pages.** ⚠ **These deliver nothing on their
   own.** `new Date()` in a server component is entirely fine today; it only
   breaks under Cache Components, where it throws a build error that
   `instant = false` does **not** clear. Included because it is the
   un-deferrable entry fee for Phase 4, and it is an afternoon. **Skip it
   without loss if Phase 4 is never adopted.**

### NOT approved — Phase 4

4. **Cache Components + Partial Prefetching.** 18 layouts restructured, 68
   dialog files audited, route-by-route conversion behind the codemod escape
   hatch. Genuinely multi-week, with a quiet regression surface (§5). Needs its
   own plan, its own branch, and a separate decision. Vercel ships adoption
   skills for it (`next-cache-components-adoption`,
   `next-partial-prefetching-adoption`) which work route-by-route and check in
   at each boundary.

### Not scoped

- **View transitions.** Of the four patterns, the flagship shared-element morph
  still has **zero surface** here (no images; every list→detail pair is text-row
  → text-card) and directional slides still mis-model the module-switcher
  lattice. ⚠ **"Morphs have zero surface here" was too broad and is corrected:**
  the blog's §2 uses the SAME component for a **layout** morph with no images at
  all — each keyed row wrapped in `<ViewTransition key={row.id}>` so that
  removing one animates the rows below into their new positions instead of
  jumping. This app is full of tables that filter, sort and delete rows, so that
  variant **does** apply; only the shared-element (thumbnail→hero) morph does
  not. The `Crossfade` wrapper on Suspense reveals is still the first worthwhile
  piece, and it is worth more **after** Phase 2, since it animates the handoff
  to skeletons that must exist first. ⚠ Also note `::view-transition
{ pointer-events: none }` — without it, clicks during a transition are lost —
  and that all **9 module layouts** have sticky headers that would need
  anchoring.
- **`useOffline`.** The guide itself says experimental and "not recommended for
  production."
- **`useOptimistic` / `useActionState`.** Both assume Server Actions (0 here),
  and would cut across `useWriteAction`, the single write lifecycle all 80 write
  components were standardised onto in KD #186.
- **SWR / TanStack Query.** No requirement for a shared browser cache today.

---

## 7. Open question for Mr Ace

**Phase 3 only makes sense if Phase 4 is eventually wanted.** If Cache
Components is never going to be adopted, those five files should be left alone.
Confirm before executing Phase 3, or defer it into the Phase 4 plan where it
belongs.

---

## Appendix A — every mechanism in the two documents, and its status here

Reference only; **nothing here is scope.** It exists so a future session does
not re-read thirteen documents to re-derive it. Status measured 2026-08-29 on
`next@16.2.10`.

| #   | Mechanism                                    | What it buys                                         | Status in this app                                                    |
| --- | -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `cacheComponents: true`                      | Prerendered shell per route, paints before data      | Available on 16.2.10; blocked only by effort, not by auth (§2.2)      |
| 2   | `partialPrefetching: true`                   | Pulls that shell to the browser pre-click            | **16.3 only** — absent from the installed config schema               |
| 3   | `'use cache'`                                | Reuses a read instead of re-querying per render      | Exported, **0 usages**                                                |
| 4   | `cacheLife()`                                | Freshness profile for a cached read                  | Exported, **0 usages**                                                |
| 5   | `cacheTag()`                                 | Tags a cached read for later expiry                  | Exported, **0 usages**                                                |
| 6   | `updateTag()`                                | Expires **and** refreshes in one action              | 🔴 Unusable — Server-Actions-only, and there are none (§2.1)          |
| 7   | `'use cache: private'`                       | Caches a function that reads `cookies()`/`headers()` | The answer to the auth objection; browser-only, never server-side     |
| 8   | `<Link prefetch={true}>`                     | Resolves `params`/`searchParams` before the click    | Prop plumbed in `components/ui/identifier-link.tsx`, **never passed** |
| 9   | Default `<Link>` prefetch                    | One App Shell per route, shared across links         | Active, but there is no shell to fetch until #1                       |
| 10  | Nested `<Suspense>`                          | Top-down settling; kills layout shift                | Not used — boundaries are siblings                                    |
| 11  | `useTransition`                              | Action + server update as one pending operation      | Present via `useWriteAction` (KD #186)                                |
| 12  | `useOptimistic`                              | Renders the change before the save lands             | **0 usages**; assumes Server Actions                                  |
| 13  | `useActionState`                             | Orders repeated mutations, keeps pending on screen   | Not used; assumes Server Actions                                      |
| 14  | Provider in a shared layout                  | State survives navigation, no refetch                | Partially                                                             |
| 15  | `useOffline` + `experimental.useOffline`     | Retries dropped requests instead of throwing         | Experimental; the guide says **not for production**                   |
| 16  | SWR / TanStack + server `preload`            | Kills the client waterfall on live data              | Not used; no shared-browser-cache requirement today                   |
| 17  | `@next/playwright` `instant()`               | E2E assertion that the prefetched UI is visible      | **Not installed** — the suite is vitest-only, no Playwright at all    |
| 18  | `::view-transition { pointer-events: none }` | Without it, clicks during a transition are **lost**  | N/A until transitions exist — but mandatory the day they do           |
| 19  | Header anchoring (`viewTransitionName`)      | Stops the header sliding with the content            | **9 module layouts** have sticky headers; all would need it           |
| 20  | `transitionTypes` on `<Link>` / `useRouter`  | Tags a navigation forward or back                    | Mis-models the module-switcher lattice (§6)                           |

### Details that cost the most to re-derive

- **The morph only fires if the destination is already prefetched.** If it
  suspends to a fallback first, no pair forms and the content plays its enter
  animation instead. This ties animation work to prefetching work — they are not
  independent.
- **`default="none"` with no `share` prop silently stops a named pair
  morphing.** Keep the explicit `share` whenever you add `default="none"`.
- **Put a directional wrapper in `page.tsx`, never `layout.tsx`** — layouts
  persist across navigations, so `enter`/`exit` never fire there.
- **Browser back/forward carries no transition type**, so directional slides do
  not play on it; a shared-element morph still does.
- **Cache Components changes prefetch semantics**: with `partialPrefetching`, a
  visible `<Link prefetch={true}>` costs **one server invocation per link** — a
  grid of 25 rows is 25 invocations. The hover-triggered pattern
  (`prefetch={active ? null : false}` set on `onMouseEnter`) is the documented
  way to avoid that.
- **`cacheLife` thresholds that gate behaviour:** `stale` must be **≥ 30s** for
  per-link prefetching to work at all, and **≥ 5 minutes** for content to reach
  the App Shell. Below 30s the scope silently drops out of prefetching.
- **Cache keys and `cacheTag` values are stored in PLAIN TEXT.** Key on a stable
  identifier such as a user id; never put tokens, raw emails or other personal
  data in a cache key or tag.
- **Streaming / Web Vitals:** an LCP element inside a Suspense boundary cannot
  paint until that boundary resolves, so keep LCP elements **outside** boundaries;
  skeletons must match the dimensions of what replaces them or they cause CLS;
  each boundary is a hydration unit, which is what improves INP. And "if there is
  a Suspense boundary, React might use it" — do not add one you do not need.
- **The HTTP contract:** once streaming starts the status code is already sent, so
  a `notFound()` mid-stream cannot become a 404 (Next injects
  `<meta name="robots" content="noindex">` instead) and a `redirect()` becomes a
  client-side redirect. Put `notFound()` **before** any `await` or boundary to get
  a real status code.
- **`instant = false` does NOT clear synchronous-IO build errors.** `new Date()`,
  `Date.now()`, `Math.random()`, `crypto.randomUUID()` during prerender fail the
  build regardless of the opt-out. This is why §6's Phase 3 is un-deferrable
  entry-fee work rather than something the codemod can postpone.
- **Five adoption skills exist:** `next-cache-components-adoption`,
  `next-partial-prefetching-adoption`, `next-cache-components-optimizer`,
  `next-dev-loop`, and `vercel-react-view-transitions`. The first two work
  route-by-route and check in at each feature boundary.
- **Tooling that only exists under Cache Components:** the dev-overlay validation
  insights (which name the blocking component and offer Stream/Cache/Block fixes)
  and the **Navigation Inspector**, which freezes a navigation so you can see the
  actual shell. The entire migration workflow is built around both.
