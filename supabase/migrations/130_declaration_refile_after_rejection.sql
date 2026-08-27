-- 130_declaration_refile_after_rejection.sql
--
-- A parent whose filing was turned down can file again.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS: THE DUPLICATE GUARD WAS TOO WIDE BY ONE STATUS
--
-- Migration 125 added `student_declarations_no_duplicate_filing` for a real
-- and narrow reason, quoted from its own comment: "A parent double-tapping
-- submit on a flaky connection must not file twice." The route catches the
-- resulting 23505 and returns the EXISTING filing as a success, deliberately —
-- showing somebody a failure for their own double-tap makes them try a third
-- time.
--
-- The index was written as:
--
--   unique (filed_by, declaration_type, student_id, start_date, end_date)
--   where filed_by is not null and status <> 'cancelled'
--
-- `status <> 'cancelled'` admits `rejected`, and that is the bug. Consider the
-- sequence the school actually intends:
--
--   1. a parent files an absence for 3 September with no certificate;
--   2. the officer in charge turns it down and asks for the MC;
--   3. the parent gets the certificate and files 3 September again.
--
-- Step 3 collides with the rejected row from step 1. The insert raises 23505,
-- the route reads that as "they double-tapped", and the parent is handed a
-- SUCCESS carrying the rejection they were trying to replace. There is no
-- error to read, nothing to retry, and no other route into the system. The one
-- moment a parent most needs to re-file is the one moment they cannot.
--
-- ⚠ THE APPLICATION SIDE IS ALREADY CORRECT AND THIS IS WHAT IT IS WAITING
-- FOR. `findOverlappingFilings` (lib/declarations/filing-window.ts) scopes its
-- duplicate check to `('pending','approved')` on purpose — a rejected or
-- cancelled filing is explicitly not a blocker there. Until this migration
-- runs, that intent is overruled by the index underneath it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY NARROWING IS SAFE
--
-- A partial unique index constrains only the rows matching its WHERE clause.
-- Removing `rejected` from that set makes the index cover STRICTLY FEWER rows,
-- so every row that satisfies the constraint today still satisfies it
-- afterwards. A narrowing cannot fail on existing data, which is why there is
-- no backfill or precondition check here — unlike a widening, which would need
-- one.
--
-- Double-tap protection is untouched for every other status: two identical
-- pending filings still collide, which is the case 125 was written for.
--
-- ⚠ Two rejected filings for the same child and dates CAN now coexist. That is
-- correct rather than tolerated: each is a distinct request the school
-- considered and turned down, and collapsing them would erase the history of
-- how many times a family asked.

-- `create unique index` cannot replace an existing index of the same name, and
-- the definition is changing, so the old one is dropped first. Both statements
-- are guarded so a re-run is a no-op.
drop index if exists public.student_declarations_no_duplicate_filing;

create unique index if not exists student_declarations_no_duplicate_filing
  on public.student_declarations
     (filed_by, declaration_type, student_id, start_date, end_date)
  where filed_by is not null and status not in ('cancelled', 'rejected');

comment on index public.student_declarations_no_duplicate_filing is
  'Stops one parent double-submitting the same filing. Deliberately ignores '
  'cancelled and rejected rows so a turned-down filing can be replaced — '
  'migration 130.';
