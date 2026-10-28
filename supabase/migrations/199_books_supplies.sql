-- 199: Books & supplies tracker.
--
-- The books and supplies a student is handed at the start of a year, and who
-- handed each one over and when — ticked per student on the Admissions
-- Supplies stage (docs/superpowers/plans/2026-10-28-books-supplies-tracker.md).
--
-- `supply_items` is the year's list, imported from the school's book list
-- workbook (scripts/backfill/import-ay2027-book-list.ts). `supply_handovers`
-- holds one row per item given to a student; unticking deletes the row, and
-- every tick and untick writes an audit_log row in the route.
--
-- ⚠ POSTURE. Both tables deny `authenticated` everything and are reached only
-- through the service role, exactly like 198. The app checks roles in code.
--
-- ⚠ NO FOREIGN KEY to auth.users. `given_by` is a plain uuid so a handover
-- outlives the account that recorded it (KD #196). Students are keyed by
-- `student_number`, the only stable student id (Hard Rule #4).
--
-- Idempotent: `if not exists`, `drop ... if exists`, safe to re-run.

-- ── 1. The year's list ──────────────────────────────────────────────────────

create table if not exists public.supply_items (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  kind             text not null check (kind in ('book', 'supply')),
  -- Null = every level.
  level_id         uuid references public.levels (id) on delete restrict,
  -- Null = both tracks.
  class_type       text check (class_type in ('Global', 'Standard')),
  subject          text,
  title            text not null,
  publisher        text,
  isbn             text,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.supply_items is
  'One book or supply on a year''s list: which level and track it is for (null = all), its subject, and its place in the school''s list.';

-- Same coalesce trick as 198's subject_heads_once: a plain unique key treats
-- two NULLs as different, which would let the importer add the same
-- every-level supply twice.
create unique index if not exists supply_items_once
  on public.supply_items (
    academic_year_id,
    kind,
    coalesce(level_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(class_type, '*'),
    coalesce(subject, '*'),
    title
  );

create index if not exists supply_items_ay_level_idx
  on public.supply_items (academic_year_id, level_id);

-- ── 2. What was handed over ─────────────────────────────────────────────────

create table if not exists public.supply_handovers (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.supply_items (id) on delete cascade,
  student_number text not null,
  given_by       uuid,
  given_by_name  text,
  given_at       timestamptz not null default now(),
  constraint supply_handovers_item_student_key unique (item_id, student_number)
);

comment on table public.supply_handovers is
  'One book or supply given to a student, with who gave it and when; deleted when the tick is taken back (the audit log keeps both).';

create index if not exists supply_handovers_student_idx
  on public.supply_handovers (student_number);

-- ── 3. Closed to the browser ────────────────────────────────────────────────

alter table public.supply_items     enable row level security;
alter table public.supply_handovers enable row level security;

revoke all on public.supply_items     from authenticated;
revoke all on public.supply_handovers from authenticated;

revoke all on public.supply_items     from anon;
revoke all on public.supply_handovers from anon;

-- Belt and braces, the same four deny policies as 126 and 198.
do $$
declare
  t text;
begin
  foreach t in array array['supply_items', 'supply_handovers']
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
