-- 181_house_points.sql
--
-- Adds the House Points tables: events, places, entries, teams and the
-- points scale. Foundation migration for the House Points feature — every
-- later task in this plan uses these table and column names verbatim.
--
-- WHAT THE WORKBOOK DID
--
-- HFSE has run house points out of a shared spreadsheet
-- (`House Points Tracking AY2026.xlsx`) with one tab per event: a class
-- competition, an inter-house sports day, a school-wide contest, an
-- attendance bonus. Each tab lists who took part and what place they came,
-- and a fixed legend converts a place into points — Gold/Silver/Bronze for
-- an internal (class-level) event, the same three names worth more for an
-- external one, Winner/Runner-up wording for a "major" event, and two flat
-- attendance bonuses that have no ranking at all. The four houses accumulate
-- across the year; the totals are what gets read out.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY POINTS ARE NEVER STORED
--
-- `house_point_entries` records WHO did WHAT and (for a scored event) WHAT
-- SCORE or WHICH PLACE they got — never a points number. Points are derived
-- at read time from `place_id` (or, for a house-only "pick" event, from the
-- house's own placement) joined against `house_point_places` /
-- `house_point_scales`. Storing a computed points value would let it drift
-- from the scale the moment someone edits the scale or re-derives a
-- placement from scores — exactly the class of bug 177 fixed for grade
-- computation ("a formula change is always a migration too" would otherwise
-- apply here too, except there is no formula to keep in sync because nothing
-- is stored). A place can carry its own bespoke points
-- (`house_point_places.points`) for a one-off event; but that column is
-- always populated — `house_point_scales` is copied into an event's own
-- `house_point_places` once, at event creation, never read from again for
-- that event. Editing the scale afterwards only changes what the NEXT event
-- of that type is seeded with; read-time code never falls back to
-- `house_point_scales` for an event that already has places.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A TEAM COUNTS ONCE PER HOUSE
--
-- `entrant_kind = 'team'` exists because some events are run as mixed teams
-- of students (a relay, a quiz bowl) rather than as individuals or as whole
-- houses. A team's members can — and often do — belong to more than one
-- house. If every member's house were awarded the team's placement points
-- independently, a 4-a-side team spanning all four houses would hand out the
-- winning points four times over from one placement, which is not what
-- "the team came first" means. So `house_point_team_members` records
-- membership, but the points a team earns are credited to each DISTINCT
-- house represented on it exactly once — read-time logic, not a constraint
-- this migration can express, since it depends on which students the
-- registrar actually put on the team.
--
-- `house_point_entries.team_id` is UNIQUE: a team is entered once per event,
-- never twice, mirroring the per-student and per-house uniqueness below.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THREE ENTRANT SHAPES INSTEAD OF ONE
--
-- The workbook's tabs are not all the same shape. Some rank individual
-- students (a spelling bee), some rank ad-hoc teams (a relay), and some rank
-- houses directly with no team in between (a banner competition scored once
-- per house). `entrant_kind` names which shape an event is, and
-- `house_point_entries_one_entrant` (exactly one of `section_student_id`,
-- `team_id`, `house_id` set) keeps every row honest about which shape it
-- belongs to. `house_point_events_house_is_pick` requires a house-entrant
-- event to use `placement_mode = 'pick'` (registrar picks the place per
-- house) rather than 'score', because a raw score has no meaning compared
-- house-to-house without a scored roster underneath it.
--
-- `placement_mode` is the other axis: 'score' means every entrant gets a
-- numeric score and placement is derived by ranking scores (DENSE ranking —
-- ties share a place and the next place is not skipped, e.g. 46, 46, 44 ->
-- 1st, 1st, 2nd); 'pick' means the registrar assigns each entrant a place
-- directly, because some events (a costume contest, "best decorated
-- classroom") were never scored, only judged. `rank_within` records the
-- scope ranking happens inside: the whole event, or bucketed by section or
-- level, because a school-wide event isn't always ranked school-wide — a
-- Sports Day sprint is ranked within a level, not against every level.
--
-- ─────────────────────────────────────────────────────────────────────────
-- house_point_scales VS house_point_places
--
-- `house_point_scales` is the workbook's fixed legend: four `event_type`
-- values, each with a small ladder of named places and their points,
-- reusable across every event of that type. `house_point_places` is the
-- PER-EVENT ladder an event actually uses — usually copied from the scale
-- for its `event_type` when the event is created, but editable, because a
-- one-off event ("Founders' Day pageant") can carry its own place names and
-- point values that don't match any of the four standard ladders. Keeping
-- them as two tables means changing the standing scale never silently
-- rewrites the points an already-run event handed out.
--
-- `rank = null` on both tables means "everyone else who joined but didn't
-- place" — the workbook's flat "Participation" row, and the two attendance
-- bonuses (`100% attendance`, `No lates`) which were never ranked at all.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY academic_year_id LIVES ON THE EVENT, NOT DERIVED
--
-- `house_point_events` is a genuinely new, year-scoped record — not a
-- reference table like `houses` (110) and not an append-only chronological
-- record hung off a permanent student row like `student_discipline_records`
-- (120). Events are run within one academic year's calendar and never
-- span a rollover, so `academic_year_id` is stored directly rather than
-- inferred later from `held_on`, matching the posture of every other
-- year-scoped table in this schema (`sections`, `grading_sheets`, …).
--
-- ─────────────────────────────────────────────────────────────────────────
-- SAFE TO RE-RUN
--
-- Every table is `create table if not exists`; the scale seed uses
-- `on conflict (event_type, sort_order) do nothing`; every RLS policy is
-- `drop policy if exists` then `create policy`. Re-running this file changes
-- nothing on a database that already has it applied.
--
-- Idempotent. NOT YET APPLIED — Mr Ace applies migrations by hand.

create table if not exists public.house_point_scales (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null check (event_type in ('internal','external','major','attendance')),
  label       text not null,
  rank        smallint check (rank is null or rank >= 1),   -- null = "everyone else who joined" / unranked
  points      numeric(6,2) not null check (points >= 0),
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  unique (event_type, sort_order)
);

create table if not exists public.house_point_events (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years(id) on delete cascade,
  name              text not null check (length(btrim(name)) > 0),
  held_on           date,
  event_type        text not null check (event_type in ('internal','external','major','attendance')),
  entrant_kind      text not null check (entrant_kind in ('student','team','house')),
  placement_mode    text not null check (placement_mode in ('score','pick')),
  max_score         numeric(8,2) check (max_score is null or max_score > 0),
  rank_within       text not null default 'event' check (rank_within in ('section','level','event')),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_at        timestamptz not null default now(),
  constraint house_point_events_score_needs_max check (placement_mode <> 'score' or max_score is not null),
  constraint house_point_events_house_is_pick  check (entrant_kind <> 'house' or placement_mode = 'pick')
);

create table if not exists public.house_point_places (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.house_point_events(id) on delete cascade,
  label       text not null check (length(btrim(label)) > 0),
  rank        smallint check (rank is null or rank >= 1),
  points      numeric(6,2) not null check (points >= 0),
  sort_order  smallint not null default 0
);

create table if not exists public.house_point_teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.house_point_events(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.house_point_team_members (
  team_id             uuid not null references public.house_point_teams(id) on delete cascade,
  section_student_id  uuid not null references public.section_students(id) on delete cascade,
  primary key (team_id, section_student_id)
);

create table if not exists public.house_point_entries (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.house_point_events(id) on delete cascade,
  section_student_id  uuid references public.section_students(id) on delete cascade,
  team_id             uuid references public.house_point_teams(id) on delete cascade,
  house_id            uuid references public.houses(id) on delete cascade,
  score               numeric(8,2) check (score is null or score >= 0),
  place_id            uuid references public.house_point_places(id) on delete set null,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  constraint house_point_entries_one_entrant check (num_nonnulls(section_student_id, team_id, house_id) = 1),
  unique (event_id, section_student_id),
  unique (event_id, house_id),
  unique (team_id)
);

-- Indexes ---------------------------------------------------------------

create index if not exists house_point_events_ay_idx
  on public.house_point_events (academic_year_id);

create index if not exists house_point_places_event_sort_idx
  on public.house_point_places (event_id, sort_order);

create index if not exists house_point_entries_event_idx
  on public.house_point_entries (event_id);

create index if not exists house_point_teams_event_idx
  on public.house_point_teams (event_id);

-- Scale seed --------------------------------------------------------------
-- The workbook's fixed legend. sort_order runs 1..n within each event_type.

insert into public.house_point_scales (event_type, label, rank, points, sort_order)
values
  ('internal', 'Gold',   1,    5, 1),
  ('internal', 'Silver', 2,    4, 2),
  ('internal', 'Bronze', 3,    3, 3),
  ('internal', 'Participation', null, 1, 4),

  ('external', 'Gold',   1,   20, 1),
  ('external', 'Silver', 2,   15, 2),
  ('external', 'Bronze', 3,   10, 3),
  ('external', 'Participation', null, 5, 4),

  ('major', 'Winner',         1,   20, 1),
  ('major', '1st Runner Up',  2,   15, 2),
  ('major', '2nd Runner Up',  3,   10, 3),
  ('major', 'Participation',  null, 5, 4),

  ('attendance', '100% attendance',            null, 1, 1),
  ('attendance', 'No lates (on-time bonus)',   null, 2, 2)
on conflict (event_type, sort_order) do nothing;

-- Comments ------------------------------------------------------------------

comment on table public.house_point_scales is
  'The workbook''s fixed points legend, per event_type — reusable defaults an event''s own house_point_places is usually seeded from. Editing a scale row never touches points an event already handed out (those live in house_point_places).';
comment on table public.house_point_events is
  'One row per house points activity (a class competition, sports day event, school-wide contest, attendance bonus). Points are never stored on the event or its entries — always derived at read time from place_id against house_point_places / house_point_scales.';
comment on table public.house_point_places is
  'The place ladder an event actually uses (Gold/Silver/Bronze, Winner/Runner-up, …), usually copied from house_point_scales for the event''s event_type but editable per event so a one-off event can diverge without rewriting the standing scale.';
comment on table public.house_point_teams is
  'An ad-hoc team entered into one event (a relay, a quiz bowl). Its members can span more than one house — see house_point_team_members and the migration header on why a team''s points are credited once per distinct house, not once per member.';
comment on table public.house_point_team_members is
  'Membership of a house_point_team. A team''s placement points are credited to each DISTINCT house among its members exactly once (read-time logic) — never once per member, which would multiply a single placement into several.';
comment on table public.house_point_entries is
  'Who took part in an event and how they placed — a score and/or a place_id, never a computed points number. Exactly one of section_student_id / team_id / house_id is set per row, matching the event''s entrant_kind.';

-- RLS -------------------------------------------------------------------
-- Read: registrar-and-above (academic_coordinator, school_admin, superadmin
-- — public.is_registrar_or_above(), migration 004/039/092) or the
-- admissions role (public.current_user_role() = 'admissions', migration
-- 142), matching the read/view-only split this whole feature uses
-- (global constraints: writers = academic_coordinator, school_admin,
-- superadmin; admissions = view only). Both function names verified present
-- by grep against supabase/migrations before writing this file.
--
-- Write: denied to `authenticated` outright, exactly as migration 120 writes
-- it. All writes go through service-role API routes, which enforce
-- HOUSE_POINTS_WRITERS themselves — these deny policies are defence in
-- depth for cookie-scoped reads, not the primary gate.

alter table public.house_point_scales enable row level security;
alter table public.house_point_events enable row level security;
alter table public.house_point_places enable row level security;
alter table public.house_point_teams enable row level security;
alter table public.house_point_team_members enable row level security;
alter table public.house_point_entries enable row level security;

drop policy if exists house_point_scales_read on public.house_point_scales;
create policy house_point_scales_read
  on public.house_point_scales for select to authenticated
  using (public.is_registrar_or_above() or public.current_user_role() = 'admissions');

drop policy if exists house_point_scales_no_insert on public.house_point_scales;
create policy house_point_scales_no_insert
  on public.house_point_scales for insert to authenticated with check (false);

drop policy if exists house_point_scales_no_update on public.house_point_scales;
create policy house_point_scales_no_update
  on public.house_point_scales for update to authenticated
  using (false) with check (false);

drop policy if exists house_point_scales_no_delete on public.house_point_scales;
create policy house_point_scales_no_delete
  on public.house_point_scales for delete to authenticated using (false);

drop policy if exists house_point_events_read on public.house_point_events;
create policy house_point_events_read
  on public.house_point_events for select to authenticated
  using (public.is_registrar_or_above() or public.current_user_role() = 'admissions');

drop policy if exists house_point_events_no_insert on public.house_point_events;
create policy house_point_events_no_insert
  on public.house_point_events for insert to authenticated with check (false);

drop policy if exists house_point_events_no_update on public.house_point_events;
create policy house_point_events_no_update
  on public.house_point_events for update to authenticated
  using (false) with check (false);

drop policy if exists house_point_events_no_delete on public.house_point_events;
create policy house_point_events_no_delete
  on public.house_point_events for delete to authenticated using (false);

drop policy if exists house_point_places_read on public.house_point_places;
create policy house_point_places_read
  on public.house_point_places for select to authenticated
  using (public.is_registrar_or_above() or public.current_user_role() = 'admissions');

drop policy if exists house_point_places_no_insert on public.house_point_places;
create policy house_point_places_no_insert
  on public.house_point_places for insert to authenticated with check (false);

drop policy if exists house_point_places_no_update on public.house_point_places;
create policy house_point_places_no_update
  on public.house_point_places for update to authenticated
  using (false) with check (false);

drop policy if exists house_point_places_no_delete on public.house_point_places;
create policy house_point_places_no_delete
  on public.house_point_places for delete to authenticated using (false);

drop policy if exists house_point_teams_read on public.house_point_teams;
create policy house_point_teams_read
  on public.house_point_teams for select to authenticated
  using (public.is_registrar_or_above() or public.current_user_role() = 'admissions');

drop policy if exists house_point_teams_no_insert on public.house_point_teams;
create policy house_point_teams_no_insert
  on public.house_point_teams for insert to authenticated with check (false);

drop policy if exists house_point_teams_no_update on public.house_point_teams;
create policy house_point_teams_no_update
  on public.house_point_teams for update to authenticated
  using (false) with check (false);

drop policy if exists house_point_teams_no_delete on public.house_point_teams;
create policy house_point_teams_no_delete
  on public.house_point_teams for delete to authenticated using (false);

drop policy if exists house_point_team_members_read on public.house_point_team_members;
create policy house_point_team_members_read
  on public.house_point_team_members for select to authenticated
  using (public.is_registrar_or_above() or public.current_user_role() = 'admissions');

drop policy if exists house_point_team_members_no_insert on public.house_point_team_members;
create policy house_point_team_members_no_insert
  on public.house_point_team_members for insert to authenticated with check (false);

drop policy if exists house_point_team_members_no_update on public.house_point_team_members;
create policy house_point_team_members_no_update
  on public.house_point_team_members for update to authenticated
  using (false) with check (false);

drop policy if exists house_point_team_members_no_delete on public.house_point_team_members;
create policy house_point_team_members_no_delete
  on public.house_point_team_members for delete to authenticated using (false);

drop policy if exists house_point_entries_read on public.house_point_entries;
create policy house_point_entries_read
  on public.house_point_entries for select to authenticated
  using (public.is_registrar_or_above() or public.current_user_role() = 'admissions');

drop policy if exists house_point_entries_no_insert on public.house_point_entries;
create policy house_point_entries_no_insert
  on public.house_point_entries for insert to authenticated with check (false);

drop policy if exists house_point_entries_no_update on public.house_point_entries;
create policy house_point_entries_no_update
  on public.house_point_entries for update to authenticated
  using (false) with check (false);

drop policy if exists house_point_entries_no_delete on public.house_point_entries;
create policy house_point_entries_no_delete
  on public.house_point_entries for delete to authenticated using (false);
