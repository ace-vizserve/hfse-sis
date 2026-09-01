-- 140 — THE 300-CHARACTER NOTE CHECKS NOW COUNT MARKUP THEY WERE NEVER
--       WRITTEN TO COUNT.
--
-- ── what changed above the database ──────────────────────────────────────
--
-- Every multi-line text box in the app is a formatting editor now, so these
-- columns hold HTML rather than bare text. The application validates what the
-- person actually typed: `proseLength()` strips the tags before measuring, so
-- "Keep the note under 300 characters" means 300 characters of writing.
--
-- ── why that breaks these two constraints ────────────────────────────────
--
-- Both of these check `char_length(...) <= 300` on the STORED STRING. A note
-- that is plainly inside the limit on screen can therefore be refused by
-- Postgres once the tags are counted:
--
--   A teacher types 280 characters and bolds two words.
--   On screen the counter reads 280 / 300 and Save is enabled.
--   The stored string is 280 + <p></p> + two <strong></strong> pairs = 321.
--   Postgres rejects the row.
--
-- The teacher gets a failure they cannot act on: nothing on screen is over
-- any limit, and shortening the note by two words would not obviously help.
-- The formatting is invisible to them by design — that is the whole point of
-- a formatting editor.
--
-- ── why widen rather than drop ───────────────────────────────────────────
--
-- These checks are a backstop against a runaway write, not the user-facing
-- rule; that rule now lives in Zod and is enforced on both the client and the
-- server. Markup overhead has no fixed ceiling — deeply nested formatting can
-- multiply a string several times over — so a slightly larger number would
-- only move the same trap further along. 4000 is far above anything 300
-- characters of prose can expand to, while still refusing a write that has
-- clearly gone wrong.
--
-- The columns' documented intent does not change: these are short notes, and
-- the limit a person is held to is still 300 characters of writing.
--
-- ── what is deliberately NOT touched ─────────────────────────────────────
--
-- * `change_requests.justification`'s `char_length(justification) >= 20`
--   (migration 009) is a MINIMUM. Markup can only make it easier to satisfy,
--   so it cannot produce a false rejection. It is a weaker rule than it was,
--   and the real gate is now the Zod `.min(20)` measuring prose. Tightening
--   the database side would mean teaching Postgres to strip HTML, which is
--   not worth it for a backstop.
--
-- * `student_declarations.parent_note`'s 300-character check (migration 125)
--   stays as it is. That note is typed by a PARENT in the external portal's
--   own plain text box, which this change does not touch. It holds no markup.
--
-- * `subject_configs.description` (migration 138) is a single-line input, not
--   one of the text areas that became an editor.
--
-- Idempotent, and safe to re-run. No data is rewritten.

-- ── attendance_daily.ex_note — the excused-absence explanation ───────────

alter table public.attendance_daily
  drop constraint if exists attendance_daily_ex_note_len_chk;

alter table public.attendance_daily
  add constraint attendance_daily_ex_note_len_chk
  check (ex_note is null or char_length(ex_note) <= 4000);

comment on column public.attendance_daily.ex_note is
  'Optional free-text explanation for an EX mark (e.g. "Medical certificate submitted"). Complements the structured ex_reason, which is what quotas and dashboards count. EX-only. Written in a formatting editor, so this column holds HTML: the limit a person is held to is 300 characters of PROSE, enforced in lib/schemas/attendance.ts; the 4000 here is a runaway-write backstop that counts the markup too. Never copied into audit_log — see migration 109 for why.';

-- ── approval_request_stages.decision_note — the approver's own words ─────

-- ⚠ THIS ONE WAS DECLARED INLINE IN MIGRATION 126, SO POSTGRES NAMED IT.
-- Guessing that name and using `drop constraint if exists` would be the
-- dangerous kind of wrong: a miss drops nothing, the new constraint is added
-- alongside the old one, and the 300-character limit stays in force while
-- this migration reports success. So find it by what it CHECKS, not by what
-- it is called, and drop whatever turns up.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.approval_request_stages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%decision_note%'
      and pg_get_constraintdef(oid) ilike '%char_length%'
  loop
    execute format(
      'alter table public.approval_request_stages drop constraint %I',
      c.conname
    );
  end loop;
end $$;

alter table public.approval_request_stages
  add constraint approval_request_stages_decision_note_len_chk
  check (decision_note is null or char_length(decision_note) <= 4000);

comment on column public.approval_request_stages.decision_note is
  'The approver''s own words on a declaration decision. Written in a formatting editor, so this column holds HTML: the limit a person is held to is 300 characters of PROSE, enforced in lib/schemas/; the 4000 here is a runaway-write backstop that counts the markup too. Stays OUT of audit_log for the same reason the parent''s note does (migrations 109 and 125) — it belongs to the two people in the conversation, not to everyone holding a registrar role forever.';
