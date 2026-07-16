-- Migration 085: subject_configs.weights_confirmed — Task 2 of the
-- "Unified Subject Setup page" plan
-- (C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
--
-- Closes a real "needs attention" signal gap Task 1's report flagged as
-- load-bearing for this task: migration 082 pre-populated subject_configs
-- for four brand-new subjects (GP, COMP, ARTD, PESTD) with an EXPLICITLY
-- documented, NOT-yet-confirmed-with-the-school assumed weight (082's own
-- header: "WEIGHTS ARE A STATED ASSUMPTION, NOT YET CONFIRMED WITH THE
-- SCHOOL"). Because those rows exist, `hasConfig` already reads TRUE for
-- all four — a naive `needsAttention = !hasConfig` signal silently stops
-- flagging them the moment 082 is applied, even though the weights inside
-- those rows are still unconfirmed.
--
-- Fix: a per-config `weights_confirmed boolean` flag, orthogonal to
-- "does a row exist." `subject_configs.hasConfig` answers "is there a
-- number here at all"; `weights_confirmed` answers "has a human looked at
-- that number and said it's right." Chosen over the two documented
-- alternatives (comparing live vs template weights — fragile, breaks the
-- moment someone corrects the template without re-syncing; or hardcoding
-- the 4 subject codes — doesn't generalize to a future similarly-assumed
-- subject) because it's the one option that keeps working correctly for
-- any FUTURE subject seeded with an unconfirmed default, not just today's
-- four.
--
-- Column semantics:
--   - DEFAULT true — a brand-new config created through the Subject Setup
--     page's own Add/Tune flow (POST /api/sis/admin/subjects) carries a
--     value the admin just typed in and reviewed on the same screen — it
--     is confirmed the moment it's saved. Only migration 082's four
--     stand-in rows should ever start out false.
--   - The PATCH /api/sis/admin/subjects/[configId] route (which is
--     specifically how the Tune step's "needs attention" fix + full-edit
--     drawer save weights) sets weights_confirmed = true unconditionally
--     on every successful save — the admin explicitly reviewed the
--     numbers to get to a Save click, so the flag flips true there
--     regardless of whether it started false. Application-layer change,
--     no migration needed for that half.
--
-- Idempotency: `add column if not exists` is a safe no-op re-run; the
-- backfill UPDATE below is a plain `code = 'X'` predicate with no
-- "currently at value Y" guard (unlike 084's weight corrections) because
-- setting weights_confirmed = false on an already-false row is a no-op by
-- definition — safe to re-run unconditionally, matching 081-084's
-- documented idempotency contract.
--
-- No dev/live database is reachable from this worktree — this migration
-- has NOT been run or verified against a live database, same caveat as
-- 082/083/084. Verification here is structural only (begin/commit
-- balance; cross-checked against migration 082 §3's exact insert so the
-- backfill targets exactly the four rows it created, no more no less).

begin;

alter table public.subject_configs
  add column if not exists weights_confirmed boolean not null default true;

commit;

-- Backfill: the four rows migration 082 §3 inserted for GP/COMP/ARTD/PESTD
-- (every AY that already had subject_configs rows at the time 082 ran) are
-- the only rows anywhere that carry an unconfirmed, assumption-only
-- weight — every other subject_configs row, historical or freshly
-- created, was either hand-entered by an admin (confirmed by definition)
-- or seeded from HFSE's actual verified canonical weights
-- (supabase/seed.sql). No other backfill target exists.

begin;

update public.subject_configs sc
set weights_confirmed = false
from public.subjects subj
where subj.id = sc.subject_id
  and subj.code in ('GP', 'COMP', 'ARTD', 'PESTD');

commit;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply manual review queries:
--   select subj.code, ay.ay_code, sc.weights_confirmed
--     from public.subject_configs sc
--     join public.subjects subj on subj.id = sc.subject_id
--     join public.academic_years ay on ay.id = sc.academic_year_id
--     where subj.code in ('GP','COMP','ARTD','PESTD')
--     order by ay.ay_code, subj.code;
--   -- Expect: weights_confirmed = false for every row of all four codes.
--
--   select count(*) from public.subject_configs where weights_confirmed is null;
--   -- Expect: 0 (NOT NULL DEFAULT true backstop).
--
--   select count(*) from public.subject_configs sc
--     join public.subjects subj on subj.id = sc.subject_id
--     where subj.code not in ('GP','COMP','ARTD','PESTD')
--       and sc.weights_confirmed = false;
--   -- Expect: 0 — no other subject was ever touched by the backfill.
-- ═════════════════════════════════════════════════════════════════════
