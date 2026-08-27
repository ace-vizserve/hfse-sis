-- 126_approval_stages.sql
--
-- Ordered, configurable approval — the engine, and nothing that uses it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS AT ALL
--
-- Migration 125 gave parents a table to file an absence into and a `status`
-- column to watch. Nothing moves that status, so it reads 'pending' forever.
-- The thing that would move it does not exist anywhere in this codebase: the
-- one approval flow we have — locked-sheet grade changes — is two columns
-- (`primary_approver_id`, `secondary_approver_id`) and a pool of two people,
-- where whoever acts FIRST becomes "primary". That is not an order. It cannot
-- express "the form class adviser, and then the officer in charge", which is
-- what the school answered when asked who approves an absence (2026-08-19).
--
-- Mr Ace's model, in his words (2026-08-27), and this schema is a direct
-- transcription of it:
--
--   * a flow is an ORDERED LIST OF STAGES
--   * a stage holds ONE OR MORE APPROVERS and THE FIRST TO ACT CARRIES IT
--     (his frame: Microsoft Teams Approvals)
--   * a REJECTION AT ANY STAGE ENDS the request
--   * stages are CONFIGURATION, NOT CODE — a superadmin edits them
--
-- ⚠ ONE FLOW IS WIRED TO THIS, and only one. He explained the mechanism using
-- the AEB as an example (stage 1 Chandana, 2 Christina, 3 Norma, 4 Gary OR
-- Nina) and that example is recorded in the plan, NOT built. The grade-change
-- flow keeps its two columns and is not touched by this migration or the next.
-- Registering a second flow is a row in `approval_stages`, which is the point.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE ENGINE POINTS AT ITS SUBJECT AND HOLDS NO KEY BACK
--
-- `approval_requests` carries (`subject_type`, `subject_id`) and NO foreign
-- key to any consumer. Migration 125 committed to this from the other end and
-- said why: a key back would couple the engine to attendance, and the whole
-- reason to build stages generically is that grade changes, section moves and
-- publication all want them later. The consumer's own status column is a
-- PROJECTION the deciding route refreshes; this table is the truth.
--
-- ─────────────────────────────────────────────────────────────────────────
-- FOUR TABLES, AND WHY THE LADDER IS MATERIALISED
--
--   approval_stages           the configuration. What the flow's steps ARE.
--   approval_stage_approvers  who is in a NAMED stage.
--   approval_requests         one open request per subject.
--   approval_request_stages   the ladder AS FILED — one row per stage.
--
-- The last one is the interesting choice. `grade_change_requests` already has
-- a version of this idea in `eligible_approver_snapshot` (migration 044, a
-- jsonb blob capturing the approver list at request time so that removing
-- somebody from the flow afterwards does not strand an in-flight request).
-- That instinct is right and this is the same idea in a shape that can be
-- indexed and that carries its own decision trail per step.
--
-- ⚠ ONLY THE CURRENT STAGE IS 'pending'; LATER STAGES SIT AT 'waiting'.
-- That is not cosmetic. It makes "what is waiting for me" one indexed query.
-- The alternative — comparing a stage's order against its request's
-- `current_stage_order` — is a column-to-column comparison that PostgREST
-- cannot express at all, so every inbox read would become two round trips and
-- a filter in TypeScript.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ NAMED POOLS ARE FROZEN. A DERIVED POOL RESOLVES LIVE.
--
-- A `named` stage freezes its people into `approver_pool` when the request is
-- filed, so removing somebody from the configuration does not yank them out of
-- a decision they are part-way through (migration 013's "revocation is
-- forward-only" rule, kept).
--
-- A `form_adviser` stage stores the SECTION and resolves the people every time
-- somebody acts. Freezing the adviser was considered and REJECTED: the adviser
-- rule already covers `form_adviser`, `co_adviser` (124) AND a live relief
-- cover (117/123), so a frozen pool would route a sick child's absence to the
-- teacher who is on leave — very often the exact reason a relief teacher is
-- standing in front of that class this week.
--
-- ─────────────────────────────────────────────────────────────────────────
-- RLS: DENY EVERYTHING TO `authenticated`, INCLUDING SELECT
--
-- Migration 120 and 125 both grant a scoped READ to staff. These four do not,
-- and the difference is deliberate: `approver_pool` is a list of who decides
-- what, and a signed-in user must not be able to enumerate it. Every read in
-- this feature goes through a service-role route that has already worked out
-- what the caller may see. Same posture as `approver_assignments` (013).
--
-- Idempotent — safe to re-run.

-- ── 1. The configuration ───────────────────────────────────────────────────

create table if not exists public.approval_stages (
  id           uuid primary key default gen_random_uuid(),
  flow         text not null,
  stage_order  smallint not null check (stage_order >= 1),
  label        text not null check (char_length(label) between 1 and 80),

  -- 'named'        — the people are listed in approval_stage_approvers
  -- 'form_adviser' — the people are whoever advises the subject's section
  --                  at the moment somebody acts
  resolver     text not null check (resolver in ('named', 'form_adviser')),

  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,

  -- Needed so approval_stage_approvers can carry a composite FK; see below.
  constraint approval_stages_id_resolver_key unique (id, resolver)
);

comment on table public.approval_stages is
  'The configurable steps of an approval flow, in order. Edited by a superadmin at /sis/admin/approvers — deliberately NOT seeded by a migration, because a person''s uuid does not belong in version control.';
comment on column public.approval_stages.resolver is
  'How the stage''s approvers are found. ''named'' = the explicit list in approval_stage_approvers, frozen into the request when it is filed. ''form_adviser'' = whoever advises the subject''s section, resolved LIVE at the moment somebody acts — never frozen, or an absence gets routed to the teacher who is away.';
comment on column public.approval_stages.is_active is
  'Deactivated rather than deleted. A stage that has already been copied into live requests must keep existing so those requests still read correctly.';

-- One active stage per position per flow. Inactive rows are excluded so a
-- stage can be retired and its position reused without a unique violation.
create unique index if not exists approval_stages_flow_order_active_key
  on public.approval_stages (flow, stage_order)
  where is_active;

create index if not exists approval_stages_flow_idx
  on public.approval_stages (flow, stage_order)
  where is_active;

-- ── 2. Who is in a named stage ─────────────────────────────────────────────

create table if not exists public.approval_stage_approvers (
  id         uuid primary key default gen_random_uuid(),
  stage_id   uuid not null,

  -- ⚠ A COPY of the parent's resolver, pinned to 'named' and joined back by a
  -- composite foreign key. That is the whole enforcement: a row here cannot
  -- hang off a `form_adviser` stage, because the FK would not resolve. Cheaper
  -- and more legible than a trigger, and it cannot be bypassed by a service
  -- client the way an application check can.
  resolver   text not null default 'named' check (resolver = 'named'),

  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,

  constraint approval_stage_approvers_stage_fk
    foreign key (stage_id, resolver)
    references public.approval_stages (id, resolver)
    on delete cascade,

  constraint approval_stage_approvers_once unique (stage_id, user_id)
);

comment on table public.approval_stage_approvers is
  'The people in a NAMED approval stage. Any one of them can carry the stage — first to act decides, exactly as the existing change-request flow works within its pair.';
comment on column public.approval_stage_approvers.resolver is
  'Always ''named'', and part of the composite FK back to approval_stages. It exists so the database itself refuses to attach a person to a stage whose approvers are derived rather than listed.';

create index if not exists approval_stage_approvers_user_idx
  on public.approval_stage_approvers (user_id);

-- ── 3. A request ───────────────────────────────────────────────────────────

create table if not exists public.approval_requests (
  id                  uuid primary key default gen_random_uuid(),
  flow                text not null,

  -- ⚠ No FK. See the header. `subject_type` is the consumer's own vocabulary
  -- ('student_declaration' today) and `subject_id` its primary key.
  subject_type        text not null,
  subject_id          uuid not null,

  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected', 'cancelled')),

  -- Which stage is live. Null once the request is closed is NOT used — the
  -- column keeps the last stage it reached, so a closed request still says
  -- where it got to.
  current_stage_order smallint not null,

  filed_by            uuid,
  filed_by_email      text not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  decided_at          timestamptz,

  -- One open request per subject. This is also what makes re-filing safe: the
  -- parent route catches the unique violation rather than opening a second
  -- ladder over the same declaration.
  constraint approval_requests_subject_key unique (flow, subject_type, subject_id)
);

comment on table public.approval_requests is
  'One ordered approval in flight. Points at its subject by (subject_type, subject_id) and holds NO foreign key to it — the engine must be able to serve flows it knows nothing about.';
comment on column public.approval_requests.current_stage_order is
  'The stage that is live. On a closed request it keeps the stage it ended on, so "rejected at stage 1" and "rejected at stage 2" stay distinguishable.';

create index if not exists approval_requests_open_idx
  on public.approval_requests (flow, created_at desc)
  where status = 'pending';

create index if not exists approval_requests_subject_idx
  on public.approval_requests (subject_type, subject_id);

-- ── 4. The ladder as filed ─────────────────────────────────────────────────

create table if not exists public.approval_request_stages (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.approval_requests(id) on delete cascade,
  stage_order   smallint not null check (stage_order >= 1),

  -- Copied from the configuration at filing time, so renaming a stage later
  -- does not rewrite the history of a decision somebody already made.
  label         text not null,
  resolver      text not null check (resolver in ('named', 'form_adviser')),

  -- Frozen people, for a named stage. Empty for a derived one.
  approver_pool uuid[] not null default '{}',

  -- The section to resolve against, for a derived stage. Null for a named one.
  section_id    uuid references public.sections(id) on delete cascade,

  status        text not null default 'waiting'
                  check (status in ('waiting', 'pending', 'approved', 'rejected')),

  decided_by       uuid,
  decided_by_email text,
  decided_at       timestamptz,

  -- ⚠ The approver's own words, and it stays OUT of audit_log for the same
  -- reason the parent's note does (migration 109, restated by 125): the log is
  -- readable by every is_registrar_or_above() user and can never be corrected.
  -- "Rejected — the certificate is for a different child" belongs to the two
  -- people in the conversation, not to everyone with a registrar role forever.
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),

  created_at    timestamptz not null default now(),

  constraint approval_request_stages_order_key unique (request_id, stage_order),

  -- Each resolver carries its own field and none of the other's. Same posture
  -- as `teacher_assignments_role_subject_shape` (124) and
  -- `student_declarations_type_shape_chk` (125): shape in SQL, not in prose.
  constraint approval_request_stages_resolver_shape_chk
    check (
      (resolver = 'named' and section_id is null)
      or
      (resolver = 'form_adviser' and section_id is not null and approver_pool = '{}')
    ),

  -- A decision is a person, a time and (optionally) a note, together or not at
  -- all. A stage marked approved with nobody attached is unattributable.
  constraint approval_request_stages_decision_shape_chk
    check (
      (status in ('waiting', 'pending')
        and decided_by is null and decided_at is null)
      or
      (status in ('approved', 'rejected')
        and decided_by is not null and decided_at is not null)
    )
);

comment on table public.approval_request_stages is
  'The ladder for one request, materialised when it is filed. The grade-change flow''s `eligible_approver_snapshot` (migration 044) is the same idea as a jsonb blob; rows can be indexed and can carry a decision each.';
comment on column public.approval_request_stages.approver_pool is
  'The frozen people of a NAMED stage. Frozen so that removing somebody from the configuration does not pull them out of a request they are mid-way through — migration 013''s forward-only revocation rule, kept.';
comment on column public.approval_request_stages.section_id is
  'The section a DERIVED stage resolves against, every time somebody acts. Never frozen into approver_pool: the adviser rule includes live relief cover, and a frozen pool would send a sick child''s absence to the teacher who is on leave.';
comment on column public.approval_request_stages.status is
  'waiting → pending → approved | rejected. ⚠ Exactly one stage per open request is ''pending''; the ones after it are ''waiting''. That is what makes an inbox a single indexed query instead of a column-to-column comparison PostgREST cannot express.';

-- The inbox for a named approver: "pending stages whose pool contains me".
create index if not exists approval_request_stages_pool_idx
  on public.approval_request_stages using gin (approver_pool)
  where status = 'pending';

-- The inbox for a derived approver: pending stages on the sections they hold.
create index if not exists approval_request_stages_section_idx
  on public.approval_request_stages (section_id)
  where status = 'pending';

create index if not exists approval_request_stages_request_idx
  on public.approval_request_stages (request_id, stage_order);

-- ── 5. The adviser rule, with an explicit actor ────────────────────────────
--
-- ⚠ THIS IS THE ONE EDIT IN THIS MIGRATION THAT TOUCHES LIVE ACCESS.
--
-- `is_adviser_for_section(uuid)` answers "is the CALLER an adviser of this
-- section" and is exactly right for RLS, where the caller is the person. The
-- approval RPC has the opposite problem: it runs as `service_role` and must
-- ask about somebody who is not the connection's user.
--
-- So the rule moves down one level into `is_section_adviser(section, user)`
-- and `is_adviser_for_section` becomes a one-line call into it. The predicate
-- — role in ('form_adviser','co_adviser'), plus a relief arm windowed by
-- `relief_is_live` — then exists in exactly ONE place.
--
-- The alternative was a second copy pinned by a text-comparison test. It was
-- rejected: this repo has already paid that bill twice. Migration 115 exists
-- solely because two copies of the relief window disagreed, and KD #193 found
-- SEVEN app-side gates comparing a role literal that SQL had already widened,
-- so the database granted what the app refused.
--
-- ⚠ AND THE THING THAT MUST NOT BE REPEATED: migration 114 revoked EXECUTE on
-- an RLS helper from `authenticated`, and because an RLS policy is evaluated
-- as the querying role, every cookie-scoped read of `teacher_assignments`
-- failed. Teachers saw a blank Teachers tab while service-role screens went on
-- rendering the same rows correctly. Migration 116 repaired it. Therefore:
-- `is_section_adviser` is GRANTED to `authenticated`, not revoked from it.

create or replace function public.is_section_adviser(
  p_section_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and ta.role in ('form_adviser', 'co_adviser')
      and (ta.teacher_user_id = p_user_id
           or (ta.relief_teacher_user_id = p_user_id
               and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
  );
$$;

comment on function public.is_section_adviser(uuid, uuid) is
  'True when the given user advises the given section — as form adviser, as co-adviser (124), or as a relief teacher whose cover window includes today (117/123). The single definition of the adviser rule: is_adviser_for_section(uuid) is a one-line call into this, and the approval RPC calls it for an actor who is not the connection''s user.';

-- Byte-for-byte the same question 124 asked, now asked in one place.
create or replace function public.is_adviser_for_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_section_adviser(p_section_id, auth.uid());
$$;

comment on function public.is_adviser_for_section(uuid) is
  'True when the CALLER advises the given section — form adviser, co-adviser, or live relief cover. Gates attendance_records and attendance_daily. Since migration 126 this is a thin wrapper over is_section_adviser(section, user) so the rule has one definition; the behaviour is unchanged from 124.';

-- ⚠ GRANTED, not revoked. See the note above: 114 revoked exactly this kind of
-- helper and blanked every teacher's assignment read until 116 put it back.
grant execute on function public.is_section_adviser(uuid, uuid) to authenticated;
grant execute on function public.is_section_adviser(uuid, uuid) to service_role;
grant execute on function public.is_adviser_for_section(uuid) to authenticated;
grant execute on function public.is_adviser_for_section(uuid) to service_role;

-- `anon` is deliberately removed. Nothing unauthenticated reads a section's
-- staffing, and the two-argument form takes a user id rather than reading
-- auth.uid(), so unlike its wrapper it WOULD answer for a stranger.
revoke all on function public.is_section_adviser(uuid, uuid) from anon;

-- ── 6. RLS — nothing reaches these tables through PostgREST ────────────────
--
-- All four deny `authenticated` everything, SELECT included. See the header:
-- `approver_pool` is a list of who decides what, and no signed-in user should
-- be able to enumerate it. Same posture as approver_assignments (013).

alter table public.approval_stages            enable row level security;
alter table public.approval_stage_approvers   enable row level security;
alter table public.approval_requests          enable row level security;
alter table public.approval_request_stages    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'approval_stages',
    'approval_stage_approvers',
    'approval_requests',
    'approval_request_stages'
  ]
  loop
    execute format('drop policy if exists %I_no_select on public.%I', t, t);
    execute format('create policy %I_no_select on public.%I for select to authenticated using (false)', t, t);

    execute format('drop policy if exists %I_no_insert on public.%I', t, t);
    execute format('create policy %I_no_insert on public.%I for insert to authenticated with check (false)', t, t);

    execute format('drop policy if exists %I_no_update on public.%I', t, t);
    execute format('create policy %I_no_update on public.%I for update to authenticated using (false) with check (false)', t, t);

    execute format('drop policy if exists %I_no_delete on public.%I', t, t);
    execute format('create policy %I_no_delete on public.%I for delete to authenticated using (false)', t, t);
  end loop;
end $$;
