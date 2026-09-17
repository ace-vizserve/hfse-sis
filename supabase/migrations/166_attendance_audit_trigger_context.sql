-- Migration 166 — the attendance mark's audit row names the child, and is
-- written once
--
-- WHY. Migration 149 moved "every mark is audited" into an AFTER INSERT
-- trigger on `attendance_daily`, so the register could write straight from the
-- browser. Two things about that trigger were wrong, and both are visible in
-- the live log.
--
--   1. IT FIRES FOR EVERY WRITER, NOT ONLY THE BROWSER. Two server paths still
--      insert through the service-role client, where `auth.uid()` is null:
--
--        * PATCH /api/attendance/daily — which ALREADY writes its own audit
--          row, with the actor, the class and the before -> after. The
--          trigger added a second row for the same mark, `actor_id` null,
--          `actor_email` 'system', no class. Seven of those were live against
--          1,327 rows that carry an actor.
--        * An approved absence declaration marking its days Excused
--          (`lib/declarations/register.ts`). That write was logged ONLY by the
--          trigger — so the one trace of "this day became EX because two
--          people approved a medical certificate" read as 'system' did it,
--          about nobody in particular.
--
--      A row that says 'system' when a person acted is not a thin record, it
--      is a wrong one. So the trigger now STEPS ASIDE when there is no signed-in
--      caller, and each service-role writer logs for itself — both do, as of the
--      code that ships with this migration, with the real actor and the role
--      that authorised the write.
--
--   2. IT SAID WHAT CHANGED BUT NOT TO WHOM. The context carried date, status,
--      prior status and reason — no enrolment, no class, no student. On
--      /attendance/audit-log a Term-sheet edit therefore read "EX on 3 Sep"
--      with no way to tell which child. The context now carries the same keys
--      the daily route writes (`section_student_id`, `section_id`,
--      `section_name`, `term_id`) plus `student_number` and `student_name`, and
--      `entity_id` is the ledger row the mark created.
--
-- ⚠ THE NOTE IS STILL PRESENCE ONLY. `ex_note_present` says a note is on the
-- mark and `ex_note_changed` says it differs from the mark it supersedes —
-- which is how a note added, edited or removed on an otherwise unchanged EX is
-- now visible at all. The words never reach `audit_log`: migration 109's rule,
-- restated by 125 and by the daily route. The log is readable by every
-- is_registrar_or_above() user and can never be corrected.
--
-- ⚠ `prior_status` AND `ex_reason` ARE OMITTED WHEN NULL, rather than written
-- as JSON null. That is what the daily route has always done, and
-- lib/audit/humanize.ts can only render a null prior as the word "null". `status`
-- is the exception and stays present even when null — a null status IS the
-- record that a day was cleared (migration 134).
--
-- ⚠ `actor_role` STAYS `current_user_role()`. For a browser insert that is the
-- role in force on the JWT (migration 142) — the same value the RLS insert
-- policy from 149 evaluated to let the row in, which is exactly what
-- `audit_log.actor_role` is defined to hold (migration 141): the role that
-- AUTHORISED the write.
--
-- WHAT IS DELIBERATELY NOT TOUCHED. The trigger itself (still AFTER INSERT,
-- FOR EACH ROW), the closed-day guard and the rollup trigger. `create or
-- replace function` keeps the existing trigger bound to the new body.
--
-- ⚠ A CONSEQUENCE, stated rather than discovered later: a one-off script that
-- inserts marks with the service-role key is no longer audited by the
-- database. Before this it was audited as 'system', which recorded that
-- something happened and nothing about who. A script that changes marks should
-- write its own audit rows, as the two app paths now do.
--
-- DEPLOY ORDERING. Ship the application code FIRST, then run this. The
-- reverse order opens a gap: with this applied and the old code still live, an
-- approved declaration's Excused days would be written by a service-role path
-- that does not yet log for itself, and the trigger would no longer do it for
-- it. Code-first costs nothing worse than today — the duplicate 'system' rows
-- carry on until this lands.
--
-- Idempotent: `create or replace function` only. Safe to re-run.

create or replace function public.attendance_daily_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior        text;
  v_prior_note   text;
  v_email        text;
  v_section_id   uuid;
  v_section_name text;
  v_student_no   text;
  v_student_name text;
  v_context      jsonb;
begin
  -- Service-role writers (no signed-in caller) log for themselves. See (1).
  if auth.uid() is null then
    return null;
  end if;

  select ad.status, ad.ex_note
    into v_prior, v_prior_note
  from   public.attendance_daily ad
  where  ad.section_student_id = new.section_student_id
    and  ad.date               = new.date
    and  ad.id <> new.id
  order  by ad.recorded_at desc, ad.id
  limit  1;

  select ss.section_id,
         s.name,
         st.student_number,
         nullif(trim(concat_ws(' ', st.first_name, st.last_name)), '')
    into v_section_id, v_section_name, v_student_no, v_student_name
  from   public.section_students ss
  join   public.sections s  on s.id  = ss.section_id
  left   join public.students st on st.id = ss.student_id
  where  ss.id = new.section_student_id;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  v_context := jsonb_build_object(
    'section_student_id', new.section_student_id,
    'section_id',         v_section_id,
    'section_name',       v_section_name,
    'student_number',     v_student_no,
    'student_name',       v_student_name,
    'term_id',            new.term_id,
    'date',               new.date,
    -- Present even when null: that is the record of a clear (migration 134).
    'status',             new.status
  );

  if v_prior is not null then
    v_context := v_context || jsonb_build_object('prior_status', v_prior);
  end if;
  if new.ex_reason is not null then
    v_context := v_context || jsonb_build_object('ex_reason', new.ex_reason);
  end if;
  -- Presence only, never the words. See the header.
  if new.ex_note is not null then
    v_context := v_context || jsonb_build_object('ex_note_present', true);
  end if;
  if new.ex_note is distinct from v_prior_note then
    v_context := v_context || jsonb_build_object('ex_note_changed', true);
  end if;

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
  values (
    auth.uid(),
    coalesce(v_email, '(unknown)'),
    public.current_user_role(),
    case when new.date < (now() at time zone 'Asia/Singapore')::date
         then 'attendance.daily.correct'
         else 'attendance.daily.update' end,
    'attendance_daily',
    new.id::text,
    v_context
  );
  return null;
end;
$$;

comment on function public.attendance_daily_audit() is
  'Audits a mark written by a signed-in caller (the Term-sheet grid). Skips service-role inserts, whose writers log for themselves (PATCH /api/attendance/daily, lib/declarations/register.ts). Context names the enrolment, class and student; the note is presence only (migration 109). Migration 166.';
