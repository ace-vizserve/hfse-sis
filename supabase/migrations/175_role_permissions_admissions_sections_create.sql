-- 175_role_permissions_admissions_sections_create.sql
--
-- Admissions manages classes, so it can add one while placing a child.
--
-- WHY. Admissions places next year's intake while that year's classes are
-- still being set up. On 2026-09-24 three AY2027 children were placed in
-- Directus into classes the SIS did not have, and the sync skipped them
-- silently. The office had no way to add the class themselves: "Create a new
-- section" in Records → Unsynced refused them, and the stage dialog's class
-- picker only pointed at SIS Admin, which they cannot open.
--
-- WHAT MOVES
--
--   admissions  GAINS  sections.read / create / edit / delete
--                      (Roles screen: the whole Classes row)
--
-- `create` came first (this migration as originally applied). Mr Ace ticked
-- view, edit and delete for admissions on the Roles screen the same day —
-- deliberately ("thats mine") — so they are recorded here too, so a fresh
-- environment matches production. The create route still limits the year to
-- the current or upcoming one.
--
-- Idempotent.

insert into public.role_permissions (role, capability) values
  ('admissions', 'sections.read'),
  ('admissions', 'sections.create'),
  ('admissions', 'sections.edit'),
  ('admissions', 'sections.delete')
on conflict (role, capability) do nothing;
