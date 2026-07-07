# Bug-hunt 2026-07-07 — execution progress (resumption document)

**Branch:** `fix/bug-hunt-2026-07-07` (off `main` @ `5a92466`, NOT yet pushed/PR'd)
**Backlog:** `docs/bug-hunt-2026-07-07.md` (3 CRITICAL, 10 HIGH, ~17 MEDIUM, ~10 LOW)
**Method:** subagent-driven development — per-task briefs/reports under `.superpowers/sdd/sdd-workspace/` (git-ignored scratch; this doc is the durable record). Every finding was re-verified against the code before fixing; every batch verified with `npx next build` + the relevant vitest suites.
**State at pause (2026-07-08):** Phases 1–3 complete — 31 commits, working tree clean, full suite 106 files / 860 tests green, build clean.

## Done

### Prep

- `9d4c81a` — pre-existing uncommitted KD #152 work (pipeline strip + facetGroups) committed as its own baseline
- `2284ae3` — the bug-hunt findings doc itself

### Phase 1 — CRITICAL (all verified + fixed)

- `a3657a4` **C1** parent report-card API: filters payload to the actual set of active publication windows (was: one window unlocked all 4 terms); withdrawn students included per KD #150. New pure `lib/report-card/publication-window.ts` + 12 tests.
- `a89ec52` **C2** ILIKE filter injection in parent→student auth: spliced `.or()` replaced with two parameterized `.ilike()` queries unioned/deduped by enroleeNumber.
- `8767a7e` **C3** masterfile grade_entries + attendance_records reads paginated (`fetchAllPages`); new `__tests__/supabase/paginate.test.ts`.

### Phase 2 — HIGH (all verified + fixed)

- `de9581f` **H1+H6** writeups PATCH roster-authorization check; evaluation dashboard/drill reads paginated.
- `adfa12c` **H2** change-request apply patches ONLY the approved slot from the current DB array (Hard Rule #5); `buildEntryPatch` extracted + 11 tests.
- `6a50139` **H3** annual-letter route: phantom `subject_code`/`section_name` → real `code`/`name` (route 404'd on every call before).
- `cfec8c9`+`c186000` **H4** needs-follow-up count == deep-link: 'Never updated' added to `STALENESS_FOLLOW_UP_VALUES`; NEW shared `isActiveFunnelStatus`/`ACTIVE_FUNNEL_STAGES` in `lib/schemas/sis.ts` consumed by both application lists + the count + the 'outdated' drill. (Bug report's claim of a `created_at` fallback in the count was WRONG — verified, documented.)
- `f7e627d` **H5** bulk auto-sync: invariant levels/sections fetched once (`PreloadedSyncSnapshot` optional param), chunks of 5.
- `5784b48` **H8** lone `oklch()` → `rgba()` (Hard Rule #7).
- `6097f79` **H9** `resolveStatus` honours stored 'Expired' (placed after rejected/to-follow precedence, before the date backstop).
- `905eca2` **H10** STP bucket predicate rewritten onto `stpApplicationStatus` (was reading columns the query never selected — every STP applicant counted as awaiting forever). Pure `isAwaitingStpCompletion` + tests. NOTE: the SIS hub's "Awaiting STP completion" number will visibly DROP on real data — correct, not a regression.
- `dcd19a6` **H7** `docs/context/07-api-routes.md` rewritten from the real 106-route tree.

### Phase 3 — MEDIUM (all 17 verified real; 6 batches)

- `1086cc1` **M1.a/b/c** export sheet: honours mine-scope; grouped-facet (facetGroups) selections visible/clearable; raw-columns stale-fetch epoch guard.
- `d9a6565` **M1.d** debounced url-state write preserves page/pageSize; immediate writes cancel pending debounce.
- `7c0b615` **M1.e** pipeline + stage\_\* columns excluded from CSV export.
- `aa9eddf` **M2.b** T4 publish-readiness grade_entries read paginated.
- `547a67e` **M2.a** T4 grades-missing scan exempts terms outside enrolment coverage (KD #148 — is_na exemption didn't cover render-time-only N.A.).
- `e9838fb` **M2.c** Alerts column unions prior grades by student_id across enrolments (KD #67); pure `buildPriorGradeMap`.
- `12fa6a6` **M2.d** score-entry grid reverts optimistic cells on failed/cancelled saves (snapshot ref + pure `revertPatchedFields`/`applyServerEntry` in `components/grading/score-revert.ts` + tests).
- `7d1be13` **M3.a** lifecycle timeline reads section_students withdrawal_date/reason for post-enrolment withdrawals (KD #150; pure `resolveWithdrawnDisplay`, transfer-safe).
- `9ba5965` **M3.b** cross-AY student search survives comma/paren (per-column ilike + `mergeSearchHits`).
- `67f61b2` **M3.c** auth-callback `?next=` open-redirect guard.
- `624c049` **M3.d** derived facet options no longer admit blank values.
- `8b4d0fb` **M4.a** freshen revive strictly `.gt(today)` — expiry-day oscillation stopped.
- `cafd8ff` **M4.b** evaluation submission KPI **and** its drill aligned to KD #120 (submitted AND non-empty, roster-only) — prior fixes covered the priority panels but not this pair.
- `7c97172` **M4.c** quota drills union leave usage across enrolment rows (KD #67; pure `tallyLeaveUsageByStudent`).
- `812452e` **M4.d** monthly attendance breakdown: audience precedence (KD #50/#76, level threaded, pure `countSchoolDaysByMonth`) + AY term scoping.
- `395d1eb` **M-5** dead compare loaders deleted (`lib/admissions/compare.ts`, `lib/attendance/compare.ts`, `lib/sis/records-compare.ts`, `getMarkbookCompareKpis`); `MarkbookCompareKpis` type kept (live).
- `9863795` **M-6** docs: registrar switcher cell (+3 more stale matrix cells), index-number model → KD #136, migration range → 076, 15 primitives added to the design-system table.

## Remaining

### Phase 4 — LOW (one batched commit; from `docs/bug-hunt-2026-07-07.md` §LOW)

Verify-then-fix each (finder-reported, mostly unverified):

1. `app/api/sis/ay-setup/seed-calendar/route.ts` — no `logAction` audit call (KD #9).
2. `components/ui/data-table/index.tsx` ~288-292 — `selectedRows` memo missing `data` dep (stale rows after `router.refresh()`). NOTE: index.tsx was modified by M1 — re-locate.
3. `components/report-card/report-card-letterhead.tsx` ~89,98 — inline `style={{ color: 'rgba(255,255,255,0.92)' }}` → `text-white/90` utility.
4. Perf nits: `filter-rows.ts` per-row column lookup → hoist per facet; export-sheet facet-options memo; wide-grid `CellButton` memoization + weekday-label into columns memo; `next/dynamic` the export sheet (+ `@dnd-kit`) out of the 31 DataTable pages; batch-print calendar re-query once per (term, level) in `build-report-card.ts` ~469.
5. `FacetConfig.showUnassigned` — declared + referenced in a movements-table comment but never implemented → implement or delete (delete likely right; verify no consumer sets it).

### Then

6. **Final whole-branch review** — `superpowers:requesting-code-review` (feature-dev:code-reviewer or /code-review) over `2284ae3..HEAD`; dispatch ONE fix subagent for the full findings list if any.
7. **Wrap-up** — `/sync-docs` (CLAUDE.md session-context + dev-plan snapshot; the H4/H10/M4.b fixes deserve KD-update notes), then `superpowers:finishing-a-development-branch` (merge/PR decision is the user's; `git pull --rebase origin main` before any push).

## Resumption notes

- Ledger (scratch, richer per-task detail): `.superpowers/sdd/progress.md`; briefs/reports: `.superpowers/sdd/sdd-workspace/task-*.md`.
- Several implementer agents died mid-stream on API errors this session — always `git log` + `git status` to find ground truth before re-dispatching; the commits were consistently fine, only the reports were lost.
- Verification bar per batch: `npx next build` clean + relevant `__tests__/` suites; criticals also got manual reasoning re: parent-API behavior (curl re-test against a live env still outstanding — noted in the backlog doc's Verification section, worth doing before deploy).
