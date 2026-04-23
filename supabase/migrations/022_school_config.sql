-- 022_school_config.sql
--
-- Singleton `school_config` table — school-wide settings that don't belong
-- to any AY but do belong somewhere editable (today they're hardcoded in
-- components or blank placeholders):
--
--   principal_name                — shown under the School Principal
--                                   signature line on final (T4) report cards.
--   ceo_name                      — shown under the Founder & CEO signature
--                                   line on final (T4) report cards.
--   pei_registration_number       — Singapore Private Education Institute
--                                   number. Rendered as a subtle line under
--                                   the report-card title.
--   default_publish_window_days   — default number of days from "publish"
--                                   click to the end of the parent-visible
--                                   window. UI consumers read this as a
--                                   sensible default; registrar can still
--                                   override per-publish.
--
-- Enforced singleton via a CHECK constraint on a fixed `id` value. One row
-- is seeded by the migration with empty strings + a sensible default window;
-- superadmin edits via `/sis/admin/school-config`.
--
-- RLS: reads via `current_user_role() is not null`; writes deny-all
-- (service-role only, matches migrations 004 / 014 / 015).
--
-- Apply after 021. Safe to re-run — IF NOT EXISTS + ON CONFLICT DO NOTHING.

create table if not exists public.school_config (
  id                           smallint primary key default 1 check (id = 1),
  principal_name               text not null default '',
  ceo_name                     text not null default '',
  pei_registration_number      text not null default '',
  default_publish_window_days  smallint not null default 30
    check (default_publish_window_days between 1 and 365),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references auth.users(id)
);

comment on table public.school_config is
  'Singleton row (id=1) of school-wide settings: signatures, PEI reg number, publication defaults. Edited by superadmin at /sis/admin/school-config.';

-- Seed the single row on first apply; idempotent via ON CONFLICT.
insert into public.school_config (id) values (1) on conflict (id) do nothing;

alter table public.school_config enable row level security;

drop policy if exists school_config_role_read  on public.school_config;
drop policy if exists school_config_no_insert  on public.school_config;
drop policy if exists school_config_no_update  on public.school_config;
drop policy if exists school_config_no_delete  on public.school_config;

create policy school_config_role_read
  on public.school_config for select
  to authenticated
  using (public.current_user_role() is not null);

create policy school_config_no_insert
  on public.school_config for insert to authenticated with check (false);
create policy school_config_no_update
  on public.school_config for update to authenticated using (false) with check (false);
create policy school_config_no_delete
  on public.school_config for delete to authenticated using (false);
