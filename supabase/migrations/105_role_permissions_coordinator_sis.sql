-- 105_role_permissions_coordinator_sis.sql
--
-- Grants the academic coordinator the three SIS Admin surfaces she works from:
-- Subject Weights, AY Setup, and Classes (which she already had).
--
-- UNLIKE 101 AND 102, THIS ONE CHANGES BEHAVIOUR. Those two were transcriptions
-- of authorization that already existed. This is a real widening, made on Mr
-- Ace's explicit instruction (2026-07-31): the academic coordinator sets up the
-- academic year, the classes and the subject weights, and was doing it through
-- cross-links planted in the Records sidebar with two of the three surfaces
-- shut to her.
--
-- WHY A MIGRATION AND NOT JUST A CODE EDIT. Once role_permissions holds rows it
-- is AUTHORITATIVE and is not merged with DEFAULT_ROLE_CAPABILITIES (see
-- lib/auth/permission-map.ts — merging would make a deliberately-revoked
-- capability un-revokable). So editing the defaults alone would change nothing
-- on any database where 101 has been applied. The two must move together, and a
-- test asserts the union of the seed migrations equals the defaults.
--
-- WHAT SHE GETS
--
--   subjects.read/create/edit   — /sis/admin/subjects. ROUTE_ACCESS had already
--                                 been widened to admit her in anticipation of
--                                 this grant, so the page was reachable and then
--                                 redirected on the missing `subjects.read`.
--                                 All three actions, not just read: the "add
--                                 subject" control and the per-cell weight
--                                 editors live on that one surface, so granting
--                                 read alone leaves buttons that render and 403.
--
--   academic_year.read/create/edit
--                               — /sis/ay-setup. She already held `edit_terms`
--                                 (the term-dates route admitted her while the
--                                 page redirected her away — an asymmetry 101
--                                 faithfully reproduced). This resolves it in
--                                 the direction of giving her the page.
--
-- WHAT SHE DOES NOT GET
--
--   academic_year.delete        — deleting an academic year stays superadmin
--                                 only, as it is for school_admin (KD #40; the
--                                 RPC is emptiness-guarded on top).
--   subjects.delete             — does not exist as a capability at all; subject
--                                 removal is SQL-only because historical grade
--                                 entries reference subject_configs (KD #72).
--
-- Her AY power is now exactly school_admin's. That is the deliberate ceiling:
-- it means /sis/ay-setup has no control that renders for her and then fails.
--
-- The `/sis` hub itself is NOT opened — she reaches these surfaces from the SIS
-- sidebar (which the route-group layout already renders for her) and from the
-- Records and Admissions cross-links.
--
-- Idempotent, like 101 and 102 — safe to re-run, and it never clobbers a grant
-- a superadmin has since edited in /sis/admin/roles.

insert into public.role_permissions (role, capability) values
  ('academic_coordinator', 'subjects.read'),
  ('academic_coordinator', 'subjects.create'),
  ('academic_coordinator', 'subjects.edit'),

  ('academic_coordinator', 'academic_year.read'),
  ('academic_coordinator', 'academic_year.create'),
  ('academic_coordinator', 'academic_year.edit')
on conflict (role, capability) do nothing;
