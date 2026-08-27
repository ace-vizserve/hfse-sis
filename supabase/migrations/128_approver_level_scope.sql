-- 128_approver_level_scope.sql
--
-- An approver on a NAMED step can be scoped to half the school.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ THIS EXISTS BECAUSE MIGRATION 126 GOT "PRIMARY OR SECONDARY" WRONG.
--
-- The school's answer on 2026-08-19 read: "Form Class Adviser", then "Officer
-- in Charge (Primary or Secondary)". That was read — by us, on 2026-08-27 —
-- as *either of two approvers, whoever acts first*, and both people were put
-- on one step accordingly.
--
-- It means neither of those things. Mr Ace, same day, correcting it:
--
--   "the OIC is per year category hence Primary and Secondary — so if the
--    submitted approval by the parent is a student from primary then use the
--    OIC for Primary"
--
-- PRIMARY AND SECONDARY ARE THE TWO HALVES OF THE SCHOOL. Ms Lhen is the
-- officer in charge OF PRIMARY; Ms Elaine Wee is the officer in charge OF
-- SECONDARY. There is one officer for each child, decided by the child.
--
-- ⚠ WHAT THE WRONG READING ACTUALLY DID, until this migration: both sat on one
-- step with first-to-act, so the SECONDARY officer could approve a Primary
-- child's absence and the primary officer a Secondary child's. Not a
-- theoretical routing bug — exactly the shape migration 125 refused to allow
-- for siblings, arriving from a different direction.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A TAG ON THE PERSON, NOT TWO STEPS
--
-- Two steps would be wrong twice over: every declaration would have to pass
-- through BOTH officers, and one of the two would be deciding a child from a
-- half of the school they have nothing to do with. The routing is not a
-- sequence; it is a choice of WHO, made per child.
--
-- Nor is it a third resolver. `form_adviser` derives its people from the class
-- because the answer changes weekly. This one does not: the school names an
-- officer per half and that holds for the year. It is a named person with a
-- scope, so it is a column on the named person.
--
-- NULL means "any child", which is both the sensible default and what every
-- existing row means. A flow that has never heard of school halves keeps
-- working with no change at all.
--
-- ⚠ AN EMPTY POOL AFTER FILTERING STALLS, exactly as an empty pool always has.
-- If the school names an officer for Primary and nobody for Secondary, a
-- Secondary child's declaration reaches that step and stops there, visibly.
-- It is NOT silently handed to the primary officer, and it does NOT skip the
-- step. `/sis/admin/approvers` reports the gap before it can happen.
--
-- Values match `levels.level_type` exactly (migration 029 widened it to
-- include 'preschool'). Only 'primary' and 'secondary' are live at HFSE today
-- — 15 and 6 sections in AY2026 — but matching the source column means a
-- preschool level costs nothing later.
--
-- Idempotent — safe to re-run.

alter table public.approval_stage_approvers
  add column if not exists applies_to_level_type text;

alter table public.approval_stage_approvers
  drop constraint if exists approval_stage_approvers_level_type_chk;

alter table public.approval_stage_approvers
  add constraint approval_stage_approvers_level_type_chk
  check (
    applies_to_level_type is null
    or applies_to_level_type in ('primary', 'secondary', 'preschool')
  );

comment on column public.approval_stage_approvers.applies_to_level_type is
  'Which half of the school this person approves for, matching levels.level_type. NULL means any child, which is what every pre-128 row means. Named for the post the school actually holds: Ms Lhen is the officer in charge OF PRIMARY, Ms Elaine of SECONDARY — "Primary or Secondary" in the school''s own answer is the year category, not a first-and-second approver, and reading it the other way let each of them decide the other half''s children.';

-- One person may now hold the step for primary AND for secondary, so the
-- old `(stage_id, user_id)` uniqueness is too strict.
--
-- ⚠ The index keys on `coalesce(applies_to_level_type, '*')` rather than using
-- `nulls not distinct`. Two untagged rows for the same person are a duplicate
-- and must be refused, but a plain multi-column unique index treats NULLs as
-- distinct and would allow them. `nulls not distinct` says so directly and
-- needs Postgres 15; the coalesce says the same thing on any version, and this
-- schema is applied by hand rather than by a pinned runner.
alter table public.approval_stage_approvers
  drop constraint if exists approval_stage_approvers_once;

drop index if exists public.approval_stage_approvers_once;

create unique index if not exists approval_stage_approvers_once
  on public.approval_stage_approvers
     (stage_id, user_id, (coalesce(applies_to_level_type, '*')));

comment on index public.approval_stage_approvers_once is
  'One person appears once per step per school half. It does NOT stop the same person holding both an untagged row and a tagged one — that combination is redundant rather than wrong, and the pool builder in lib/approvals/materialise.ts dedupes by person, so it can never put anybody into a pool twice.';

-- ─────────────────────────────────────────────────────────────────────────
-- THE CHILD'S HALF, REMEMBERED ON THE LADDER ITSELF
--
-- ⚠ THIS IS WHAT MAKES A CHANGE OF OFFICER REACH REQUESTS ALREADY WAITING.
--
-- A named step copies its people into `approver_pool` at the moment the parent
-- files. Normally that is right: somebody taken off the list can still finish
-- a decision they were already holding. But a step that had NOBODY on it when
-- the filing arrived freezes with an empty pool and stays empty however many
-- people are named afterwards — that request waits forever, with nobody able
-- to act and nothing on screen explaining why.
--
-- That is not hypothetical. Nobody is scoped to a half right now, so anything
-- filed before this migration lands is in exactly that state.
--
-- Re-pointing a waiting row means rebuilding its pool, and rebuilding the pool
-- needs to know WHICH HALF the child is in. Deriving it at that moment would
-- mean walking request → declaration → student → section → level for every
-- open row, across a table the engine deliberately knows nothing about: the
-- engine points at `(subject_type, subject_id)` and holds no key back to its
-- consumer. So the half is stamped here when the ladder is built, exactly as
-- `section_id` already is for a derived step.
--
-- NULL means the half could not be established, and it is NOT "carry on":
-- `poolForLevelType` narrows to approvers who cover every child rather than
-- guessing, because putting the primary officer on a child who might be in
-- secondary is the mistake this whole migration exists to prevent.
alter table public.approval_request_stages
  add column if not exists level_type text;

alter table public.approval_request_stages
  drop constraint if exists approval_request_stages_level_type_chk;

alter table public.approval_request_stages
  add constraint approval_request_stages_level_type_chk
  check (
    level_type is null
    or level_type in ('primary', 'secondary', 'preschool')
  );

comment on column public.approval_request_stages.level_type is
  'Which half of the school the subject''s child is in, stamped when the ladder is built. Lets a named step''s pool be rebuilt for a request already waiting when the school changes who holds the job — see lib/approvals/config.ts::repointWaitingStages. NULL means the half was not established, which narrows the pool to approvers covering every child rather than guessing one.';
