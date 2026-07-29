-- 096_pfile_reminder_claim.sql
--
-- Makes the P-Files reminder cooldown race-safe, so a parent cannot receive two
-- reminder emails for the same document slot inside the 24-hour window.
--
-- THE BUG THIS FIXES
--
-- lib/p-files/notify-helpers.ts did: SELECT the last reminder (cooldown check)
-- → send the email → INSERT the p_file_outreach row that establishes the next
-- cooldown. Two requests could both pass the SELECT before either INSERTed —
-- and the gap between them is not microseconds, it spans an actual email send.
-- A double-submitted "Send reminder", or a single notify racing the bulk sweep
-- over the same slot, sends the parent two emails.
--
-- Verified against production before writing: the only duplicate
-- (ay, enrolee, slot, kind) key in p_file_outreach is a pair of AY9999 test-AY
-- rows sharing an identical microsecond timestamp — one seeder INSERT, not a
-- real double-send. So this is latent, not an incident. (That seeder duplicate
-- is also why a plain unique index is NOT the fix here: it could not be created
-- without first deleting real rows from an append-only table, and a
-- calendar-day unique key does not express a 24-hour ROLLING window anyway.)
--
-- WHY AN ADVISORY LOCK
--
-- `INSERT ... WHERE NOT EXISTS` alone is not sufficient: under READ COMMITTED
-- two concurrent executions cannot see each other's uncommitted row, so both
-- can pass the NOT EXISTS. `pg_advisory_xact_lock` inside a plpgsql function
-- (which runs as one transaction) serialises callers on the slot key, so the
-- second waits, then sees the first's committed row and declines. No unique
-- index, no rows deleted to make one fit.
--
-- Apply after 095.

-- ─── claim ──────────────────────────────────────────────────────────────────
create or replace function public.claim_pfile_reminder(
  p_ay_code            text,
  p_enrolee_number     text,
  p_slot_key           text,
  p_recipient_email    text,
  p_created_by_user_id uuid,
  p_created_by_email   text,
  p_cooldown_hours     integer default 24   -- mirrors REMINDER_COOLDOWN_HOURS
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_id   uuid;
begin
  -- Serialise concurrent claims for this exact slot. Transaction-scoped, so it
  -- releases when the function returns — it is held across the cooldown read
  -- and the insert, never across the email send (that happens in the caller,
  -- after this returns).
  perform pg_advisory_xact_lock(
    hashtext(p_ay_code || '|' || p_enrolee_number || '|' || p_slot_key)
  );

  select created_at
    into v_last
    from p_file_outreach
   where ay_code        = p_ay_code
     and enrolee_number = p_enrolee_number
     and slot_key       = p_slot_key
     and kind           = 'reminder'
     and created_at     > now() - make_interval(hours => p_cooldown_hours)
   order by created_at desc
   limit 1;

  if v_last is not null then
    return jsonb_build_object('claimed', false, 'last_sent_at', v_last);
  end if;

  insert into p_file_outreach (
    ay_code, enrolee_number, slot_key, kind, channel,
    recipient_email, created_by_user_id, created_by_email
  )
  values (
    p_ay_code, p_enrolee_number, p_slot_key, 'reminder', 'email',
    p_recipient_email, p_created_by_user_id, p_created_by_email
  )
  returning id into v_id;

  return jsonb_build_object('claimed', true, 'claim_id', v_id);
end;
$$;

comment on function public.claim_pfile_reminder(text, text, text, text, uuid, text, integer) is
  'Atomically claim the right to send a P-Files reminder for (ay, enrolee, slot), honouring the 24h rolling cooldown. Returns {claimed:true, claim_id} or {claimed:false, last_sent_at}. Caller sends the email only on claimed:true, and must release the claim if the send fails.';

-- ─── release ────────────────────────────────────────────────────────────────
--
-- THE ONE SANCTIONED DELETE ON THIS TABLE.
--
-- p_file_outreach is append-only by design (034_pfile_outreach.sql: "Hard Rule
-- #6 applies. No UPDATE / DELETE paths"), and that stays true for every row
-- describing an email that was actually sent.
--
-- This deletes only a claim the SAME request created moments earlier, when the
-- send then failed. Keeping it would be the greater violation: the row would
-- assert that a parent was emailed when no email left the building, corrupting
-- the very record the append-only rule exists to protect — and it would block
-- the retry for 24 hours while showing the registrar "cooldown" instead of
-- "send failed".
--
-- Deliberately narrow: `kind = 'reminder'` only (never a promise), and only
-- within a few minutes of creation, so it can never retract historical
-- outreach even if a stale id is replayed.
create or replace function public.release_pfile_reminder_claim(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from p_file_outreach
   where id = p_claim_id
     and kind = 'reminder'
     and created_at > now() - interval '10 minutes';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

comment on function public.release_pfile_reminder_claim(uuid) is
  'Retract a reminder claim whose email send failed. The single sanctioned DELETE on the append-only p_file_outreach table: scoped to kind=reminder and to rows created in the last 10 minutes, so it can only ever remove a just-made claim, never historical outreach.';

-- Server-side callers only. Revoke + explicit service_role grant, matching
-- create_academic_year (090) and create_ay_admissions_tables (087).
revoke all on function public.claim_pfile_reminder(text, text, text, text, uuid, text, integer) from public;
grant execute on function public.claim_pfile_reminder(text, text, text, text, uuid, text, integer) to service_role;

revoke all on function public.release_pfile_reminder_claim(uuid) from public;
grant execute on function public.release_pfile_reminder_claim(uuid) to service_role;
