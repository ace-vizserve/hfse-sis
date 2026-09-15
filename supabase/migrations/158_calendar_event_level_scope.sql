-- 158_calendar_event_level_scope.sql
--
-- A calendar event can say WHICH LEVELS it is for.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY
--
-- Mr Ace, 2026-09-15: "i have seen events named P6 Fieldtrip and its assigned
-- to whole school which is wrong."
--
-- He is right, and it is measurable. `audience` (migration 037) offers three
-- values — all / primary / secondary — and that is the entire vocabulary the
-- calendar has for scope. HFSE's own published AY2026 calendar names a level
-- on 43 of its ~100 entries: "Primary One Fieldtrip", "Primary Two and Three
-- Fieldtrip", "Secondary Four Retreat", "Leadership Camp (UpperPri -
-- Secondary)". 27 of those cannot be expressed at all today — P6 flattens to
-- 'primary', and a camp running P4 through S4 flattens to 'all', which is to
-- say it flattens to nothing.
--
-- The cost is not cosmetic. `resolveColumnTag` turns any event into an `SE`
-- tag on that date's column, in the live attendance grid AND in the exported
-- register. So "P6 Fieldtrip" currently stamps a school-event tag on every
-- P1 teacher's register.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SHAPE, AND WHY NOT A JOIN TABLE
--
-- `levels` is a text[] of level CODES, NULL meaning whole-school — the same
-- "NULL means everyone" convention migration 128 chose for
-- `applies_to_level_type`, and the same shape the TypeScript already uses
-- (lib/sis/backfill/calendar/types.ts::CalendarEntry.levels).
--
-- A join table would buy referential integrity and cost a join on every
-- calendar read, for a set that is fixed at ten values and changes roughly
-- never (migration 086 removed the volatile levels precisely because HFSE
-- never used them). The CHECK below mirrors `public.levels.code` and
-- `lib/sis/levels.ts::LEVEL_CODES`; a new level changes all three, which is
-- the same bargain every other CHECK in this schema already makes (day_type,
-- audience, category).
--
-- An EMPTY array is refused. "No levels" would mean an event for nobody;
-- whole-school is NULL. Refusing it stops a UI bug from silently hiding an
-- event from the entire school.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SECTIONS
--
-- `section_ids` covers the narrower case Mr Ace also asked for. Nothing in two
-- years of real data is scoped tighter than a level, so this is capability,
-- not backfill — it stays NULL until somebody uses it.
--
-- Levels and sections are mutually exclusive, by CHECK. "P6, and also section
-- S1 Discipline 1" has no obvious meaning and no use case; refusing the
-- combination is cheaper than defining one nobody asked for.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ `audience` STAYS, AND STAYS DERIVED
--
-- Three live readers branch on it and none of them is touched by this
-- migration:
--   • app/(attendance)/attendance/[sectionId]/page.tsx — the teacher's sheet
--   • app/api/attendance/[sectionId]/export/route.ts   — the register export
--   • lib/attendance/calendar-filters.ts               — the SIS calendar
-- Dropping it here would break all three in the same commit. Instead a BEFORE
-- trigger keeps it correct: set `levels`, and `audience` follows.
--
-- ⚠ THE TRIGGER ONLY SPEAKS WHEN IT HAS SOMETHING TO SAY. This is migration
-- 153/154's lesson applied before the fact, not after: a derive trigger fires
-- for EVERY writer — the two API routes, the copy-from-prior-AY bulk insert,
-- every backfill, every maintenance UPDATE — including rows written long
-- before the rule existed. All 56 production rows have no `levels` and a
-- deliberate `audience`, so a trigger that derived unconditionally would
-- overwrite 4 correct 'secondary' rows with 'all' on the next touch of any
-- kind. It therefore derives ONLY when `levels` or `section_ids` is present,
-- and otherwise leaves whatever the writer supplied exactly as it is.
--
-- Verified against production before writing this (2026-09-15): 56 rows,
-- 52 'all' + 4 'secondary', zero NULL audience, zero NULL category, zero
-- empty labels, zero audiences outside the CHECK.
--
-- Apply after 157. Idempotent — safe to re-run.

-- =====================================================================
-- 1. Columns
-- =====================================================================

alter table public.calendar_events
  add column if not exists levels text[];

alter table public.calendar_events
  add column if not exists section_ids uuid[];

-- Level codes must be real, and the array must not be empty.
alter table public.calendar_events
  drop constraint if exists calendar_events_levels_chk;

alter table public.calendar_events
  add constraint calendar_events_levels_chk
  check (
    levels is null
    or (
      cardinality(levels) > 0
      and levels <@ array[
        'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
        'S1', 'S2', 'S3', 'S4'
      ]::text[]
    )
  );

alter table public.calendar_events
  drop constraint if exists calendar_events_section_ids_chk;

alter table public.calendar_events
  add constraint calendar_events_section_ids_chk
  check (section_ids is null or cardinality(section_ids) > 0);

-- One scope at a time.
alter table public.calendar_events
  drop constraint if exists calendar_events_one_scope_chk;

alter table public.calendar_events
  add constraint calendar_events_one_scope_chk
  check (levels is null or section_ids is null);

comment on column public.calendar_events.levels is
  'Level CODES this event is for (P1..S4), or NULL for the whole school. The real scope — `audience` is derived from it. An empty array is refused: whole-school is NULL, and "no levels" would be an event for nobody. Mirrors public.levels.code and lib/sis/levels.ts::LEVEL_CODES.';

comment on column public.calendar_events.section_ids is
  'Sections this event is for, when it is narrower than a level; NULL otherwise. Mutually exclusive with `levels`. Capability only — nothing in AY2025 or AY2026 is scoped this tightly.';

-- =====================================================================
-- 2. audience, derived
-- =====================================================================
--
-- Mixed primary+secondary resolves to 'all' because three values cannot say
-- "P4 through S4". That is a lossy answer and deliberately so: `levels` holds
-- the truth, `audience` is the compatibility shim the old readers need.

create or replace function public.calendar_events_derive_audience()
returns trigger
language plpgsql
as $$
declare
  has_primary   boolean := false;
  has_secondary boolean := false;
begin
  if new.levels is not null and cardinality(new.levels) > 0 then
    has_primary   := exists (select 1 from unnest(new.levels) c where c like 'P%');
    has_secondary := exists (select 1 from unnest(new.levels) c where c like 'S%');
  elsif new.section_ids is not null and cardinality(new.section_ids) > 0 then
    -- A section knows its level, and a level knows its half of the school.
    has_primary := exists (
      select 1
      from public.sections s
      join public.levels l on l.id = s.level_id
      where s.id = any (new.section_ids) and l.level_type = 'primary'
    );
    has_secondary := exists (
      select 1
      from public.sections s
      join public.levels l on l.id = s.level_id
      where s.id = any (new.section_ids) and l.level_type = 'secondary'
    );
  else
    -- NOTHING TO DERIVE FROM. Leave the writer's own value alone — this is the
    -- whole reason 56 pre-existing rows survive this migration untouched.
    return new;
  end if;

  if has_primary and has_secondary then
    new.audience := 'all';
  elsif has_primary then
    new.audience := 'primary';
  elsif has_secondary then
    new.audience := 'secondary';
  else
    -- Scope given but it resolved to neither half (section ids that match no
    -- row). Refusing to guess is safer than narrowing the event to nothing.
    new.audience := coalesce(new.audience, 'all');
  end if;

  return new;
end
$$;

drop trigger if exists calendar_events_derive_audience on public.calendar_events;

create trigger calendar_events_derive_audience
  before insert or update on public.calendar_events
  for each row
  execute function public.calendar_events_derive_audience();

-- =====================================================================
-- 3. Read path
-- =====================================================================
--
-- The teacher's sheet asks "which events touch this section's level?". Until
-- the readers move to `levels` (a later step, deliberately not this one), they
-- keep filtering on `audience`, which the index from 037 already covers. This
-- GIN index serves the new question without waiting for them.

create index if not exists calendar_events_levels_gin
  on public.calendar_events using gin (levels);

-- =====================================================================
-- 4. Post-apply verification (run by hand; changes nothing)
-- =====================================================================
--
-- Expect: 56 rows, 52 'all' + 4 'secondary', every `levels` NULL. If any
-- audience moved, the trigger is deriving when it should be silent — stop and
-- read section 2 again.
--
--   select audience, count(*), count(levels) as with_levels
--   from public.calendar_events
--   group by audience
--   order by audience;
