# Next.js Navigation Performance — Plan

**Rewritten 2026-08-30.** The previous version was 4,300 lines across four phases. This is three, and it is short on purpose: the old plan's bulk is why nobody read it and why two of its phases were never verified.

**Goal:** pages arrive in pieces instead of all at once.

**Source:** [Building App-like Experiences with Next.js 16.3](https://nextjs.org/blog/building-app-like-experiences-with-nextjs-16-3) and [Designing view transitions](https://nextjs.org/docs/app/guides/view-transitions). Every code shape below is copied from one of them.

**Already landed:** Next.js **16.3.3** (`97904e7b`), and the two perf-test mocks fixed for it (`94c54bc0`). `tsc` clean, `npm ls` clean. Nothing below needs further upgrade work.

---

## Confidence

Stated per phase, with what earned it. **These are not aspirations — where a number could not be earned, it says so.**

| Phase                         | Confidence                                | What earned it                                                                                                                                           |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Skeleton system           | **97% on the fix, design needs sign-off** | The rule violation and the dead classes are read off the file. The visual direction is a judgement call and needs a mockup approved first.               |
| 1 — Nested Suspense           | **97%**                                   | No config, no dependency change, additive, reverts by deleting a wrapper. Standard React.                                                                |
| 2 — Instant Navigations flags | **~50% that the build passes first try**  | Not earned. Only `npm run build` can settle it, and it hasn't been run.                                                                                  |
| 3 — Crossfade                 | **97%**                                   | Measured 2026-08-30: the exact component below type-checks at **0 errors**, and `"types": ["react/canary"]` produced **0 errors across the whole repo**. |

⚠ **The plan as a whole is therefore not 97%, and saying otherwise would be the same mistake the last pass made.** Phases 0, 1 and 3 are (Phase 0 once its mockup is signed off). Phase 2 is a five-minute experiment whose result is either "keep it" or "revert it" — that _outcome_ is ~97% safe; the _build passing_ is a coin flip until run.

---

## Phase 0 — The skeleton system

**Runs before Phase 1**, because Phase 1's Suspense fallbacks are its first consumer. Numbered 0 so the phases already referenced elsewhere keep their numbers.

### Why this exists

Two things are wrong with `components/ui/skeleton.tsx` today, both read straight off the file (2026-08-30):

```tsx
'animate-pulse rounded-md border border-hairline bg-white from-muted via-muted/60 to-muted';
```

1. 🔴 **`bg-white` violates hard rule #7.** The design system bans `bg-white` in `app/` and `components/` outright. This is the primitive **58 `loading.tsx` files and 1,874 lines** are built on.
2. **`from-muted via-muted/60 to-muted` are inert.** There is no `bg-gradient-*` class to activate them, so a shimmer was intended and never shipped. What renders is a white box with a border and a pulse.

### The structural change

The real problem is not the colour — it is that **a skeleton in a separate file has to guess the shape of a page it cannot see, and then drift from it.** 1,874 lines of hand-drawn bars, none of which any test can verify against the page they stand in for.

**The fix is to stop drawing skeletons and start rendering the real component in a loading state.** A `<StatCard>` renders `<Skeleton />` where its number goes; a table row renders skeleton cells at the real column widths. The fallback then _is_ the real layout, so it cannot drift and it cannot cause layout shift.

[`react-loading-skeleton`](https://www.npmjs.com/package/react-loading-skeleton) (dvtng) is built for exactly this — it auto-sizes from the surrounding font-size and line-height, so a skeleton standing in for a heading is heading-sized without being told.

⚠ **Understand what it does before adopting it.** It adapts because it renders **inside the real component**, not because it inspects a page. That means it does **nothing** for a standalone `loading.tsx`, which has no access to the real tree. Its value here is entirely in Phase 1's Suspense fallbacks. Adopting it is optional — the same pattern works with our own `Skeleton`; the package mainly buys the typography auto-sizing and a `SkeletonTheme` provider.

### Steps

- [ ] Fix the primitive: `bg-white` → a token (`bg-muted`), and either activate the gradient with `bg-gradient-to-r` or delete the three dead classes. **Do not leave inert classes in place.**
- [ ] ⚠ **Produce a mockup and get it signed off before rolling anything out.** A skeleton redesign is a visual change across every page in the app; per standing preference, UI work needs a visual layer approved first, not a described one.
- [ ] Design direction to propose, unless the mockup says otherwise: keep `animate-pulse` over a shimmer sweep — this is a data-dense school system, and a travelling highlight reads as a consumer app. **The idea worth spending the boldness on is that the skeleton carries the real row rhythm** — same row height, same column widths, same card grid as the content it replaces. Structurally honest rather than decorative bars.
- [ ] Build a small set of archetype loaders — table, detail, cards, form — as components that take the real layout props. Four, not fifty-eight.
- [ ] Respect `prefers-reduced-motion`: no pulse when it is set.
- [ ] Decide on `react-loading-skeleton` once the pattern exists. If the archetypes already read well with our own primitive, skip the dependency.
- [ ] Migrate `loading.tsx` files opportunistically — **only when you are already touching that route.** A big-bang rewrite of 58 files is how the last plan became unreviewable.

**Done when:** the primitive breaks no rules, the four archetypes exist, and Phase 1's fallbacks are built from them.

---

## Phase 1 — Nested Suspense

**Why first:** there is **exactly one `<Suspense>` in the whole app** (`app/(attendance)/attendance/page.tsx`). Every other page awaits everything at the top and returns finished JSX, so nothing appears until the slowest query lands.

Independent of Phases 2 and 3. Works on what is installed today.

### The pattern

Boundaries are **nested, not siblings.** Siblings resolve independently and shove each other around as they land; nested ones settle top-down.

```tsx
<Suspense fallback={<DropDetailSkeleton />}>
  {params.then(({ id }) => (
    <>
      <DropDetail id={id} />
      <Suspense fallback={<RepliesSkeleton />}>
        <Replies id={id} />
      </Suspense>
    </>
  ))}
</Suspense>
```

### Targets

Measured 2026-08-30 (`grep -c "await " <page>`):

| Page                                            | awaits |
| ----------------------------------------------- | -----: |
| `app/(markbook)/markbook/report-cards/page.tsx` |     10 |
| `app/(classroom)/classroom/page.tsx`            |      8 |
| `app/(sis)/sis/admin/staff/page.tsx`            |      5 |

Anything at 5+ is a candidate.

### Steps, per page

- [ ] Identify which awaited reads feed content **below the fold or beside the main answer**. Those go behind boundaries. The page's identity — header, title, the thing the user came for — stays outside.
- [ ] Move each into a small `async` child component in the same file.
- [ ] Wrap in nested `<Suspense>`, outermost = highest on the page.
- [ ] Fallbacks use **Phase 0's archetype loaders**, not hand-drawn bars — the fallback should be the real component in a loading state, so it cannot drift from the page or shift its layout. If Phase 0 hasn't run, use `Skeleton` from `@/components/ui/skeleton` sized to roughly match what it replaces; a fallback much shorter than its content trades a blank wait for a layout jump.
- [ ] `npx tsc --noEmit`, plus that page's tests.
- [ ] Commit per page.

**Two rules from the post:**

- Keep the **LCP element outside** any boundary — content inside one cannot paint until it resolves.
- _"If there is a Suspense boundary, React might use it."_ Don't add one you don't need.

**Done when:** on those three pages, the header and primary content appear before the secondary panels.

⚠ **If a read doesn't decompose** — a sibling depends on its result — **skip that page.** Do not restructure the data flow to force a boundary. That is the 3%.

---

## Phase 2 — Turn on Instant Navigations

Two lines. Reverting is deleting them.

```ts
// next.config.ts
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // ...existing config unchanged
};
```

Cache Components gives each route a prerendered shell it can paint before its data arrives; Partial Prefetching pulls that shell to the browser before the click.

### Why it's safe to just try

Validation is **development-only and never blocks the build** (`node_modules/next/dist/docs/01-app/02-guides/adopting-partial-prefetching.md:47`) — it appears in the dev overlay as fix cards.

Routes that aren't ready opt out and render exactly as they do today:

> "You don't have to resolve them all before shipping. Set `export const instant = false` on the page or layout to let it keep blocking on the server, then adopt the patterns below one route at a time."
> — `authentication-with-cache-components.md:45`

That matters here because **every page reads the session cookie** (KD #35), so every one will be flagged. That is expected, not failure.

### Steps

- [ ] ⚠ **Check no other session is running `next dev` first.** A production build writes into the same `.next` and can break a live dev server. On 2026-08-30 one was running on port 3000 (PID 64680) and this step was deliberately not run.
- [ ] Add the two lines.
- [ ] `npm run build`. **This step IS the experiment — its output is the deliverable.**
- [ ] 🔴 **The one thing that can genuinely fail the build:** a synchronous `new Date()` / `Date.now()` during prerender. `instant = false` does **not** clear those. There are **5** such files in `app/` and **41** in `lib/` (measured 2026-08-30). If the build names any: either wrap that read behind `await connection()`, or set `instant = false` on the route and move on. ⚠ Those counts are FILE COUNTS, not a work estimate — the subset actually reachable from a prerendered path has never been measured, and most `lib/` date reads are reached only from route handlers, which never prerender.
- [ ] If it gets ugly, delete the two lines. Nothing else has changed.
- [ ] `npm run dev` and read the overlay. That list is the real map of this app's blocking reads — worth more than any audit in this repo.
- [ ] Commit the two lines plus whatever `instant = false` exports the build required.

**Done when:** the build exits 0 and the app runs. Improving individual routes is separate, later, optional work.

**Two constraints if `'use cache'` is added later:** cache keys and `cacheTag` values are stored in **plain text** — key on `studentNumber`, never an email. And `cacheLife` `stale` must be **≥ 30s** or the scope silently drops out of prefetching.

---

## Phase 3 — Crossfade the reveals

Runs after Phase 1, because it animates boundaries that must exist first.

```tsx
// components/ui/crossfade.tsx
import { ViewTransition, type ReactNode } from 'react';

export function Crossfade({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="auto" default="none">
      {children}
    </ViewTransition>
  );
}
```

### Why this works despite `react@19.2.4`

🔴 **A plain `require('react')` in Node shows no `ViewTransition`, and concluding "blocked" from that is WRONG.** App Router code does not use the installed React:

> "View transitions work in the App Router with **no configuration**. The App Router uses React canary releases, which contain all stable React 19 changes as well as newer features like `ViewTransition`. **You do not need to install `react@canary` yourself.**"
> — `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`

That is why `next/dist/compiled/react` exports it and bare `react` does not. **Test with `tsc`, not with `node -p`.**

### Steps

- [ ] Add `"types": ["react/canary"]` to `tsconfig.json` next to `"lib"`. ✅ **Verified 2026-08-30: 0 errors across the repo.**
- [ ] Create `components/ui/crossfade.tsx` exactly as above. ✅ **Verified: type-checks at 0 errors.**
- [ ] Wrap the content inside each Phase 1 boundary.
- [ ] Add `::view-transition { pointer-events: none }` to `app/globals.css` — without it, clicks during a transition are lost.
- [ ] ⚠ `default="none"` with no `share` prop silently stops a _named_ pair morphing. Not an issue for `Crossfade` (it names nothing), but keep it in mind if a named transition is added later.

**Done when:** streamed sections fade in rather than pop. Without browser support they simply don't animate; the app works normally.

---

## Dropped, and why

**36 `loading.tsx` files.** The headline that justified it was wrong: a `loading.tsx` covers its own segment _and everything below it_, so only **9** routes genuinely show nothing on click — all of Classroom. The other 27 already show an inherited skeleton. If Classroom is ever done, it's 9 small files, and `app/(classroom)/classroom/[sectionId]/layout.tsx` already renders `PageShell` + header + subnav, so eight of them render **inner content only**.

**Server Actions on the write surfaces.** 🔴 **Investigated 2026-08-30; the stated win does not exist.** The claim was that an action collapses the write and the follow-up `router.refresh()` into one round trip. It does not, here: `invalidateDrillTags` calls `revalidateTag(tag, 'max')`, and Next sets `pathWasRevalidated` only when there is **no profile** or `expire === 0` (`node_modules/next/dist/server/web/spec-extension/revalidate.js:217-222`; the `max` profile's `expire` is `31536000`). With a profile the action **skips page rendering** and the client still needs its refresh. Reopening requires changing how the app invalidates, not just adding an action.

Two further blockers found the same day: `__tests__/attendance/school-days.test.ts:363` reads `app/api/attendance/daily/route.ts` **as text** and asserts what it imports; `__tests__/auth/assignment-read-classification.test.ts` fails on any unclassified reader of `loadEffectiveAssignmentsForUser`. Moving that route's body breaks both.

**`'use cache'` migration.** ~110 `unstable_cache` compositions already work, and the migration guide says existing caching "keeps working as a separate layer."

**`useOffline`.** The post itself: experimental, "not recommended for production."

**`prefetch={true}` on tables.** One server invocation per visible link — a 25-row table is 25 calls. The prop is plumbed on `components/ui/identifier-link.tsx` and passed nowhere; leave it that way until there's a shell worth prefetching.

**The old Phase 3 (prerender dates).** Cache Components entry fee, scoped to `app/` when `lib/` holds 41 more of the same reads. Folded into Phase 2 as a possible build error instead.
