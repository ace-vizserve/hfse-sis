-- 113_role_permissions_manage_relief.sql
--
-- Grants `staff.manage_relief` — arranging and ending cover for an absent
-- teacher — to school_admin and superadmin.
--
-- WHY A MIGRATION AND NOT JUST A CODE EDIT. Once `role_permissions` holds rows
-- it is AUTHORITATIVE and is not merged with DEFAULT_ROLE_CAPABILITIES (KD #166;
-- see lib/auth/permission-map.ts — merging would make a deliberately-revoked
-- capability un-revokable). Adding the capability to lib/auth/capabilities.ts
-- alone would therefore change nothing on any database where 101 has been
-- applied, which is all of them. The two must move together, and a test asserts
-- the union of the seed migrations equals the code defaults.
--
-- WHY NOT REUSE `staff.edit_assignments`. That capability is held by
-- academic_coordinator as well (101:119), and Mr Ace scoped cover to school
-- admin and above (2026-08-11). Reusing it would have handed the coordinator
-- relief management silently, as a side effect of a grant she already had.
--
-- WHAT THIS DOES NOT GRANT. The academic coordinator keeps
-- `staff.edit_assignments` — she can still move a teacher onto or off a class.
-- What she cannot do is put a substitute against a teacher who is still the
-- holder of record. The two controls sit on the same screens, so the UI shows
-- the cover control disabled with a reason rather than hiding it; a button that
-- silently vanishes reads as a bug.
--
-- Idempotent, like 101/102/105/106 — safe to re-run, and it never clobbers a
-- grant a superadmin has since edited in /sis/admin/roles.
--
-- AFTER APPLYING: run `npx tsx --env-file=.env.local scripts/audit-role-permissions.ts`
-- and confirm it reports no drift. The live table is the authority; that script
-- exists precisely to catch a code edit that never reached the database.

insert into public.role_permissions (role, capability) values
  ('school_admin', 'staff.manage_relief'),
  ('superadmin',   'staff.manage_relief')
on conflict (role, capability) do nothing;
