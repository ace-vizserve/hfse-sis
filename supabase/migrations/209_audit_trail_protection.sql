-- 209_audit_trail_protection.sql
--
-- Two holes in the trail itself.
--
-- 1. HISTORY COULD BE REWRITTEN. RLS stops staff logins changing audit_log and
--    grade_audit_log (006), but RLS does not bind the service role or a direct
--    database login. Hard Rule #6 says append-only, so the tables now refuse
--    UPDATE and DELETE from everyone. Nothing in the app does either. Someone
--    with database owner rights can still disable this trigger, but they have
--    to do it on purpose.
--
-- 2. THREE GRADE COLUMNS SKIPPED THE TRIGGER. RLS lets a subject teacher or
--    registrar write a whole row on an unlocked sheet, and grade_entries_audit
--    (184) only diffs scores, letter grade and N/A. A direct write to
--    annual_letter_grade, ww_excused or pt_excused left no row. The screens go
--    through routes that log; this covers a login used without them. A separate
--    trigger, so 184's body isn't re-emitted from a stale copy (KD #119).
--
-- Idempotent. Apply after 208.

-- ─── 1. Append-only ────────────────────────────────────────────────────────
create or replace function public.refuse_audit_rewrite()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit trail is append-only: % on % is refused (Hard Rule 6).',
    tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.refuse_audit_rewrite();

drop trigger if exists grade_audit_log_append_only on public.grade_audit_log;
create trigger grade_audit_log_append_only
  before update or delete on public.grade_audit_log
  for each row execute function public.refuse_audit_rewrite();

-- ─── 2. The grade columns 184 doesn't diff ─────────────────────────────────
create or replace function public.grade_entries_audit_extra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
begin
  if auth.uid() is null then
    return null;                      -- service role: the route owns the trail
  end if;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  v_role := public.current_user_role();

  if old.annual_letter_grade is distinct from new.annual_letter_grade then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'annual_letter_grade',
      old.annual_letter_grade, new.annual_letter_grade,
      auth.uid(), v_email, v_role
    );
  end if;
  if old.ww_excused is distinct from new.ww_excused then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'ww_excused',
      old.ww_excused::text, new.ww_excused::text,
      auth.uid(), v_email, v_role
    );
  end if;
  if old.pt_excused is distinct from new.pt_excused then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'pt_excused',
      old.pt_excused::text, new.pt_excused::text,
      auth.uid(), v_email, v_role
    );
  end if;
  return null;
end;
$$;

revoke all on function public.grade_entries_audit_extra() from public, anon, authenticated;

drop trigger if exists grade_entries_audit_extra_trg on public.grade_entries;
create trigger grade_entries_audit_extra_trg
  after update on public.grade_entries
  for each row execute function public.grade_entries_audit_extra();
