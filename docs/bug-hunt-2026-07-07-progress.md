# Bug-hunt 2026-07-07 — execution progress (resumption document)

**Branch:** `fix/bug-hunt-2026-07-07` (off `main` @ `5a92466`, NOT yet pushed/PR'd)
**Backlog:** `docs/bug-hunt-2026-07-07.md` (3 CRITICAL, 10 HIGH, ~17 MEDIUM, ~10 LOW)
**Method:** subagent-driven development — per-task briefs/reports under `.superpowers/sdd/sdd-workspace/` (git-ignored scratch; this doc is the durable record). Every finding was re-verified against the code before fixing; every batch verified with `npx next build` + the relevant vitest suites.
**State (2026-07-08, session 2):** ALL PHASES COMPLETE + final whole-branch review passed — **Ready to merge (Yes)**. 43 commits, working tree clean, build clean; full suite 859/860 at final review (1 timing flake in `data-table-export-sheet.test.tsx` under full-suite load — passes 4/4 in isolation).

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

### Pre-Phase-4 note (session 2)

- `e6d5bff` — a stray uncommitted `React.cache()` wrapper on `getSessionUser` (`lib/supabase/server.ts`) was found in the working tree at resume (NOT part of the bug-hunt backlog; origin unknown — the tree was clean at pause). Committed separately so it can be dropped if unwanted; the final reviewer checked it (safe: `cache()` outside render is a per-invocation no-op, so route handlers are unaffected).

### Phase 4 — LOW (all verified real; 2 tasks)

- `3a4d05a` **L1** seed-calendar route audits via `logAction` (reuses `attendance.calendar.autoseed`, exact sibling pattern, already dual-allowlisted on SIS + Attendance audit pages).
- `e1d8a8f` **L2** data-table `selectedRows` memo deps on `tabFilteredData` — bulk footer no longer acts on stale rows after `router.refresh()`.
- `173211b` **L3** letterhead inline rgba → `text-white/90` (Hard Rule #7).
- `9d0ef84` **L5** dead `FacetConfig.showUnassigned` prop deleted (shell types + movements-table local mirror + misleading comment).
- `e1906f4` `ca1226b` `fc6c463` `dd674de` `b72f39b` **L4** perf nits ×6: filterRows per-facet accessor hoist; export-sheet facet-options memo; wide-grid `CellButton` `React.memo` + weekday-label into columns memo (KD #151 single-popover invariant verified held); export sheet + `@dnd-kit` lazy via `next/dynamic` (gated on first open, no fallback flash); batch-print calendar fetched once per (term, level) via optional preload param (levelType-keyed, misses degrade to the old per-student query).

### Final whole-branch review (2284ae3..b72f39b)

- Verdict after one fix wave: **Ready to merge — Yes.**
- 1 Critical found + fixed: **C2 was only half-fixed** — the parameterized `.ilike()` calls closed the `.or()` grammar injection but left `%`/`_` live as ILIKE wildcards in the parent-email match (a parent registered `%@gmail.com` would match every `@gmail.com` family; sole authorization basis for `/api/parent/v2/*`). Fixed `a20eaa1`: escape mirroring `lib/sis/queries.ts` + 4-test regression file `__tests__/supabase/parent-email-ilike-escape.test.ts` (fails against pre-fix code). Re-review confirmed closed.
- No Important findings. All Minors triaged ride-along (selectedRows memo still ignores columnFilters/search — pre-existing; autoseed action naming; preload comment understates the levelType-cache safety; redundant filter-rows closure; exportEverOpened one-frame delay; pre-existing evBy double-call).
- Non-blocking follow-ups (not regressions): `9ba5965`'s commit message "only remaining `.or()`" claim is stale (others exist, all UUID/constant-interpolated — audited safe); `fetchAllPages` call sites (all ~19, incl. the new ones) lack explicit `.order()` — a codebase-wide hardening question if ever taken up, helper-wide not per-site.

## Remaining

- **Wrap-up** — `/sync-docs` (CLAUDE.md session-context + dev-plan snapshot; the H4/H10/M4.b fixes deserve KD-update notes), then `superpowers:finishing-a-development-branch` (merge/PR decision is the user's; `git pull --rebase origin main` before any push).
- **Before deploy** (from the backlog's Verification section): curl re-test of the two parent-API criticals against a live env — confirm a request omitting `termNumber` returns only active-window terms, and a `%`-email no longer over-matches.

## Resumption notes

- Ledger (scratch, richer per-task detail): `.superpowers/sdd/progress.md`; briefs/reports: `.superpowers/sdd/sdd-workspace/task-*.md`.
- Several implementer agents died mid-stream on API errors this session — always `git log` + `git status` to find ground truth before re-dispatching; the commits were consistently fine, only the reports were lost.
- Verification bar per batch: `npx next build` clean + relevant `__tests__/` suites; criticals also got manual reasoning re: parent-API behavior (curl re-test against a live env still outstanding — noted in the backlog doc's Verification section, worth doing before deploy).
