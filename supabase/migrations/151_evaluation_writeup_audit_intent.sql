-- Migration 151 — stop logging a "resubmit" for a save that changed nothing
--
-- Migration 150 moved the write-up audit into a trigger and got one case wrong.
-- Caught immediately by `scripts/verify-evaluation-writeup-triggers.perf.ts`,
-- whose whole premise is that re-saving a row with its own values must leave no
-- trail: it left one.
--
-- WHY IT HAPPENED — A TRIGGER SEES STATE, THE ROUTE SAW INTENT.
--
-- The route decided the action from what the client ASKED for:
--
--     if (submit === true)  action = wasSubmitted ? resubmit : submit
--     else if (textChanged) action = save
--
-- `submit === true` meant the user pressed Submit. A plain save of an
-- already-submitted write-up sent no `submit` at all and fell through to the
-- text check. A trigger has no such signal — it only sees `submitted: true`
-- before and `submitted: true` after, which 150 read as a resubmit. So every
-- save of a finalised write-up, including one that changed nothing, logged a
-- re-finalisation that never happened.
--
-- THE FIX: infer intent from the only honest evidence the row carries — whether
-- the text moved.
--
--     not submitted -> submitted                 : submit
--     submitted     -> submitted, text changed   : resubmit
--     submitted     -> not submitted             : save   (demoted to draft)
--     text changed, still a draft                : save
--     nothing of substance changed               : no row
--
-- The one case this reads differently from the route is pressing Submit on an
-- already-submitted write-up whose text is untouched. The route logged a
-- resubmit; this logs nothing. That is the better answer: the audit log exists
-- to say what changed, and nothing did.
--
-- ⚠ ONE ROW OF POLLUTION EXISTS. Verifying 150 produced exactly one spurious
-- `evaluation.writeup.resubmit`, actor `system` (the service role has no
-- `auth.uid()`). It is NOT deleted — `audit_log` is append-only (Hard Rule #6)
-- and quietly removing an inconvenient row is precisely what that rule forbids.
-- It stands, and this comment is its explanation.

create or replace function public.evaluation_writeups_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- OLD is unassigned on INSERT; every prior-row read goes through tg_op.
  v_was_submitted boolean := case when tg_op = 'UPDATE'
                                  then coalesce(old.submitted, false)
                                  else false end;
  v_prior_text    text    := case when tg_op = 'UPDATE'
                                  then coalesce(old.writeup, '')
                                  else null end;
  v_now_submitted boolean := coalesce(new.submitted, false);
  v_text_changed  boolean := tg_op = 'INSERT'
                             or v_prior_text is distinct from coalesce(new.writeup, '');
  v_action        text;
  v_email         text;
begin
  if v_now_submitted and not v_was_submitted then
    -- Finalised for the first time.
    v_action := 'evaluation.writeup.submit';
  elsif v_now_submitted and v_was_submitted and v_text_changed then
    -- Already finalised, and the text moved: a real re-finalisation.
    v_action := 'evaluation.writeup.resubmit';
  elsif (not v_now_submitted) and (v_was_submitted or v_text_changed) then
    -- Demoted back to draft, or edited while still a draft.
    v_action := 'evaluation.writeup.save';
  else
    -- Nothing of substance changed. An adviser opening a write-up and saving it
    -- untouched should leave no trail implying they revised it.
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
  values (
    auth.uid(),
    coalesce(v_email, 'system'),
    public.current_user_role(),
    v_action,
    'evaluation_writeup',
    new.id,
    jsonb_build_object(
      'submitted', v_now_submitted,
      'un_submitted', (v_was_submitted and not v_now_submitted),
      'length', length(coalesce(new.writeup, ''))
    )
  );
  return null;
end;
$$;
