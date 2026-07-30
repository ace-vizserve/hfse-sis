# SIS Admin Consolidation Makeover — "13 → 6" (2026-07-12)

> **ABANDONED 2026-07-31 — do not implement. Kept for the reasoning only.**
>
> The direction was approved in-session and built out (14 commits), then halted
> by Mr Ace before merge. On 2026-07-31 the branch was reviewed and deleted; the
> code was not merged and will not be. This document and its mockup were the only
> copies of the design, so they were lifted onto `main` before deletion.
>
> **Why it is dead, not merely parked:**
>
> - Most of the benefit — hub becomes status-and-launch rather than a menu, one
>   audit surface, staff + accounts merged, the sync page removed — was already
>   delivered by **KD #154**, which is on `main`.
> - The sidebar regrouping that was this project's centrepiece was **explicitly
>   reverted to the production structure** by Mr Ace (see KD #154's revert note).
> - Two pages it merges **no longer exist**: `/sis/admin/levels` was removed by
>   migration 086 (see KD #153's SUPERSEDED note) and `/sis/admin/settings` went
>   with the test environment (KD #52).
> - Its "Discount Codes → Admissions" relocation **contradicts KD #133**, which
>   deliberately chose to grant Admissions access and leave the surface in SIS.
> - Its commits cite "KD #155" for this project; #155 was subsequently assigned to
>   the RBAC role rename. Any revival must renumber.
>
> Deleted branch tip, recoverable from the reflog for a limited window:
> `2074996e`.

**Status:** ~~approved~~ **abandoned** — see the banner above. (Direction + mockup were approved by Mr Ace in-session; mockup artifact `2026-07-12-sis-admin-consolidation-mockup.html`, artifact id f47dfbd1.)
**Branch:** `feat/sis-admin-consolidation` — **deleted 2026-07-31, never merged** (was stacked on `feat/sis-admin-ia`).
**Relation to prior work:** goes beyond KD #154 (which regrouped the same 13 pages into 3 sidebar tiers). This project merges the pages themselves. KD #48's ownership principle holds (SIS defines config, modules consume) but whole surfaces may relocate when their real users live elsewhere — explicitly user-approved.

## Purpose

SIS Admin's 13 pages are "one page per settings concern" — the anti-pattern Linear/Notion consolidated away from. Merge them into **six surfaces**, make the sidebar **flat (6 items, no tiers)**, and let the existing readiness engine drive seasonal setup work through the merged surfaces (Arbor/Gibbon pattern: setup season is loud and guided; in-year is quiet).

## The six surfaces

| #   | Surface         | Route                      | Absorbs                                                               | Cuts (`?view=`)                                                                                       | Access                                                                            |
| --- | --------------- | -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Admin Hub       | `/sis`                     | —                                                                     | —                                                                                                     | school_admin, superadmin                                                          |
| 2   | School Year     | `/sis/school-year`         | `/sis/ay-setup` + `/sis/calendar`                                     | `year` (default school_admin+) · `calendar` (registrar's default AND only cut)                        | registrar, school_admin, superadmin                                               |
| 3   | Structure       | `/sis/structure`           | `/sis/admin/levels` + `/sis/admin/subjects` + `/sis/admin/template`   | `levels` (default) · `weights` · `defaults`                                                           | school_admin, superadmin                                                          |
| 4   | Sections        | `/sis/sections` (+ `[id]`) | — (stays)                                                             | —                                                                                                     | registrar, school_admin, superadmin                                               |
| 5   | People & Access | `/sis/people`              | `/sis/admin/staff` (+ `users` stub) + `/sis/admin/approvers`          | `assignments` (default) · `accounts` · `approvers`                                                    | registrar (assignments only), school_admin (accounts read-only), superadmin (all) |
| 6   | System          | `/sis/system`              | `/sis/admin/school-config` + `/sis/admin/settings` + `/sis/audit-log` | `config` (default) · `settings` (superadmin-only) · `audit` (keeps its internal Overview\|Log toggle) | school_admin, superadmin                                                          |

**UI cut labels (plain English, per mockup):** School Year → "Year · Calendar"; Structure → "Grade levels · Subject weights · Year defaults"; People & Access → "Teaching assignments · Accounts · Approvers"; System → "School details · Settings · Activity history". Route/nav names stay the table's surface names.

## Cross-module moves

1. **Discount Codes → Admissions.** New `/admissions/discount-codes` page mounts the existing `DiscountCodesDataTable` + create/edit components + AY switcher unchanged. `ADMISSIONS_NAV` entry replaces the old cross-link; role set unchanged (admissions/registrar/school_admin/superadmin per KD #133); the `admissions` role loses ALL `/sis/*` access (the one-item SIS sidebar hack dies). KD #118 early-bird ownership untouched. API routes stay at `/api/sis/discount-codes/**` (no contract churn).
2. **One section detail.** `/sis/sections/[id]` is canonical for section admin (roster, teacher assignments, rename, generate index/sheets). Markbook keeps grading-only surfaces; its section rows/links point here for admin actions. IA/link change only — no data-layer change.
3. **Calendar stays in SIS** as the School Year calendar cut (existing `CalendarAdminClient` mount moves). Sub-project 6's exceptions+events data-model rework stays deferred.

## Seasonal engine

- Source of truth: `getAyReadiness` (8 items, 7 required). The hub year band and the School Year checklist read the same data and can never disagree.
- **Setup season** (required items incomplete): hub year band is loud with the page's single primary CTA → `/sis/school-year`; the `YearSetupChecklist` (relocated from ay-setup) deep-links each item to the exact cut that fixes it (e.g. weights → `/sis/structure?view=weights`, letterhead → `/sis/system` config cut).
- **In-year** (all required done): both collapse to a quiet one-line state ("AY2026 is set up and underway"). Structure cuts show an amber plain-English chip: "AY2026 is underway — structure changes now are unusual. New-year changes belong in Year defaults."
- Sidebar count chips: readiness `N/M` on School Year (amber when incomplete); sections count on Sections; staff count on People & Access.

## Role gating rules

- Per-cut gating is **server-side in the page RSC** (the shipped staff-directory pattern): the page derives visible cuts from the role and never fetches data for a hidden cut. Registrar requesting a forbidden `?view=` gets her default cut, not an error.
- `ROUTE_ACCESS`: 15 rows shrink to ~7. Registrar rows: `/sis/school-year`, `/sis/sections`, `/sis/people`. `admissions` role: no `/sis` rows. `(sis)` layout guard updated to match.
- All write-API gates unchanged — merged surfaces change where things live, never who can touch them.

## Redirects (server `redirect()`, preserving params where meaningful)

`/sis/ay-setup`→`/sis/school-year` · `/sis/calendar`→`/sis/school-year?view=calendar` (carry `?audience`) · `/sis/admin/levels`→`/sis/structure?view=levels` · `/sis/admin/subjects`→`/sis/structure?view=weights` (carry `?ay`) · `/sis/admin/template`→`/sis/structure?view=defaults` · `/sis/admin/staff`→`/sis/people` (map `?view=accounts`) · `/sis/admin/users`→`/sis/people?view=accounts` · `/sis/admin/approvers`→`/sis/people?view=approvers` · `/sis/admin/school-config`→`/sis/system` · `/sis/admin/settings`→`/sis/system?view=settings` · `/sis/audit-log`→`/sis/system?view=audit` (carry the Overview|Log param) · `/sis/admin/discount-codes`→`/admissions/discount-codes` (carry `?ay`).

Inbound links repointed at the source too (redirects are the safety net, not the mechanism): NAV arrays + `SIDEBAR_REGISTRY.iconByHref` + hub quick actions + command palette + readiness deep-links + cross-module `next/link` sites (grep old hrefs).

## Visual spec

Mockup `2026-07-12-sis-admin-consolidation-mockup.html` is binding for look/feel; design system 09/09a binding for tokens/primitives. Key elements:

- **Cut control**: page-level segmented control (shadcn `Tabs` styled per the shipped staff-directory tabs) with count chips and a mono "superadmin" lock tag on locked cuts; URL-driven (`?view=`, Link-based triggers per 09a §8).
- **Summary-count header** on Structure (levels offered · subjects · weight profiles · default sections) — serif tabular numerals, `HubStat`-adjacent styling.
- **Quiet year band**: mint check + one line, `bg-muted`-tinted, no CTA.
- **Flat sidebar**: 6 items, no group headers; `sb`-style count chips (readiness chip amber when incomplete).
- `SisPageHeader` continues on every surface (eyebrow "SIS Admin · {surface}").
- Standing rules: one primary button per screen; status never colour-only; plain-English copy.

## Out of scope (unchanged deferrals)

Calendar exceptions+events data model + public embed (sub-project 6); template Apply-preview/drift chips (sub-project 3); point-of-need section creation (sub-project 4); registrar-scoped hub; promotion automation (KD #127); any migration (none needed).

## Testing

- Extend `__tests__/auth/sis-nav-route-consistency.test.ts` to the flat NAV (no-dead-ends: every NAV item proxy-reachable by every role that sees it).
- New redirect-map unit coverage (old path + params → new path + params) via an exported pure mapping used by the stubs.
- Per-cut gating tests (registrar never sees year/accounts/approvers/settings cuts; hidden cuts fetch nothing — assert loader not called where feasible).
- Full suite + `npx next build` clean; browser pass per role (superadmin / school_admin / registrar / admissions).

## Docs on completion

New **KD #155** (this consolidation) + update notes on KD #154 (superseded IA), #133 (discount codes relocated), #109 (checklist home), #89/#48 (boundary narrowing note); `project-layout.md`, `14-modules-overview.md`, dev-plan snapshot, CLAUDE.md session context via `/sync-docs`.
