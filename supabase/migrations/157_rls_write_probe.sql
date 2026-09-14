-- Migration 157 — a read-only way to ask "may THIS person write THIS row?"
--
-- WHY. Migrations 149, 150, 152 and 156 moved the write rules for attendance,
-- evaluation and grading into RLS policies, and every verification script so
-- far has run as the SERVICE role — which bypasses RLS by definition. So the
-- TRIGGERS are proven and the POLICIES are not. That gap is not academic: if
-- `is_subject_teacher_for_sheet` is wrong, a teacher types a score and it does
-- not save, and the only way to find out was for a teacher to try.
--
-- An admin clicking around cannot answer it either — `is_registrar_or_above()`
-- short-circuits every one of these policies, so an admin sails straight
-- through a broken teacher rule.
--
-- WHAT THIS DOES. Evaluates the policy helper functions as if a given user were
-- the caller, without a session and without writing anything. `auth.uid()`
-- reads `request.jwt.claims ->> 'sub'`, so setting that claim LOCAL to the
-- transaction is enough to answer the question honestly.
--
-- ⚠ IT IS A READ, AND IT MUST STAY ONE. It evaluates `security definer`
-- predicates; it never inserts, updates, or returns row data. It answers
-- "would the policy allow it", not "do it".
--
-- ⚠ `set local` IS LOAD-BEARING. Without `local`, the claim would outlive the
-- statement on a pooled connection and leak one user's identity into the next
-- request on that connection. `local` ties it to the transaction, and a
-- function body is always inside one.
--
-- ⚠ SERVICE ROLE ONLY. Being able to ask "what may this other person do" is a
-- disclosure in itself, so `authenticated` is not granted execute.

create or replace function public.rls_probe_grade_write(
  p_user_id uuid,
  p_sheet_id uuid
)
returns table (
  can_write            boolean,
  is_subject_teacher   boolean,
  is_registrar_or_above boolean,
  sheet_is_locked      boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text)::text,
    true                                   -- true = local to this transaction
  );

  return query
  select public.can_write_grade_entry(p_sheet_id),
         public.is_subject_teacher_for_sheet(p_sheet_id),
         public.is_registrar_or_above(),
         gs.is_locked
    from public.grading_sheets gs
   where gs.id = p_sheet_id;
end;
$$;

revoke execute on function public.rls_probe_grade_write(uuid, uuid) from public, authenticated;
grant  execute on function public.rls_probe_grade_write(uuid, uuid) to service_role;

-- The same question for the evaluation write-up policy (migration 150), which
-- is scoped by (section, student) rather than by sheet.
create or replace function public.rls_probe_writeup_write(
  p_user_id    uuid,
  p_section_id uuid,
  p_student_id uuid
)
returns table (
  can_write             boolean,
  is_adviser            boolean,
  is_registrar_or_above boolean,
  on_roster             boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on_roster boolean;
  v_adviser   boolean;
  v_above     boolean;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text)::text,
    true
  );

  select exists (
    select 1 from public.section_students ss
     where ss.section_id = p_section_id
       and ss.student_id = p_student_id
       and ss.enrollment_status <> 'withdrawn'
  ) into v_on_roster;

  v_adviser := public.is_adviser_for_section(p_section_id);
  v_above   := public.is_registrar_or_above();

  return query select (v_above or (v_on_roster and v_adviser)),
                      v_adviser,
                      v_above,
                      v_on_roster;
end;
$$;

revoke execute on function public.rls_probe_writeup_write(uuid, uuid, uuid) from public, authenticated;
grant  execute on function public.rls_probe_writeup_write(uuid, uuid, uuid) to service_role;
