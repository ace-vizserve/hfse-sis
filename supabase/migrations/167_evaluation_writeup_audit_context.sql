-- Migration 167 — say WHOSE write-up, WHICH term, and count the writing, not the tags
--
-- Migration 151 left the write-up audit trigger recording three facts:
--
--     submitted, un_submitted, length
--
-- and nothing about who or when. A row read "Write-up submitted · Submitted ·
-- 412 characters" with no student, no class and no term, so the audit log could
-- say THAT an adviser finalised something and never WHAT. The only way back to
-- the child was `entity_id` -> evaluation_writeups -> students, by hand, one row
-- at a time. The route this trigger replaced (PATCH /api/evaluation/writeups)
-- at least wrote term_id / section_id / student_id; moving the audit into
-- Postgres (150) quietly dropped even those.
--
-- WHAT THIS ADDS (context keys, all read at write time so the row stays true
-- after a student changes class or a section is renamed):
--
--     term_id, term_number, term_label, ay_code
--     section_id, section_name, level_label
--     student_id, student_number, student_name
--
-- `student_name` is "Last, First Middle" — the same shape
-- lib/sis/full-name.ts::composeFullName gives every other audit row.
--
-- WHAT IT DELIBERATELY DOES NOT ADD: the write-up text. Same "length, not
-- content" rule as before (classroom notes, discipline records, attendance
-- notes). audit_log is append-only and readable by every coordinator; a comment
-- about a child typed in error must not become permanent there.
--
-- `length` NOW COUNTS THE WRITING. `writeup` holds HTML from the rich-text
-- editor (KD #205), and 150/151 measured `length(writeup)` — the tags included.
-- A one-line bolded comment logged as `<p><strong>Good effort</strong></p>`,
-- 37 characters for 11 characters of writing. The key keeps its name and its
-- meaning for lib/audit/humanize.ts ("N characters"); only the measurement is
-- corrected, via `public.rich_text_prose_length` below, which mirrors
-- lib/rich-text::proseLength (blocks joined by one newline, whitespace runs
-- collapsed, ends trimmed). It is a close SQL approximation of the TipTap
-- parse, not a byte-for-byte replica — adequate for "how much did they write".
-- Rows written before 167 carry the old HTML-inclusive number and are NOT
-- rewritten (Hard Rule #6).
--
-- `entity_id` STAYS THE WRITE-UP ROW ID, on purpose. It is the one value that
-- identifies this (term, student) write-up across every save, and the
-- Classroom timeline (lib/classroom/timeline.ts, source 4) finds these rows by
-- exactly that id. Swapping it for a student number would orphan every
-- write-up event from the class timeline.
--
-- Idempotent: `create or replace` on both functions; the trigger itself was
-- created by 150 and is untouched.
--
-- DEPLOY ORDERING: independent of any app deploy. No code reads the new keys
-- yet (the wording phase will), and the old keys are unchanged, so this can be
-- applied before or after the matching code ships.

-- ---------------------------------------------------------------------------
-- 1. Prose length of a rich-text column
-- ---------------------------------------------------------------------------

create or replace function public.rich_text_prose_length(p_html text)
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select length(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            replace(replace(replace(replace(replace(replace(
              -- 3. every remaining tag goes
              regexp_replace(
                -- 2. block ends and line breaks become the one-newline separator
                regexp_replace(
                  -- 1. source whitespace is not prose: the editor never stores
                  --    a meaningful newline outside a block boundary
                  regexp_replace(coalesce(p_html, ''), '\s+', ' ', 'g'),
                  '</(p|li|h[1-6]|blockquote|pre|ul|ol)>|<br\s*/?>|<hr\s*/?>',
                  E'\n', 'gi'
                ),
                '<[^>]*>', '', 'g'
              ),
              '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'),
              '&quot;', '"'), '&#39;', ''''), '&amp;', '&'),
            ' +', ' ', 'g'
          ),
          ' *\n *', E'\n', 'g'
        ),
        E'\n{2,}', E'\n', 'g'
      ),
      E' \n'
    )
  );
$$;

comment on function public.rich_text_prose_length(text) is
  'Characters of writing in a rich-text (HTML) value, ignoring markup. SQL counterpart of lib/rich-text::proseLength, used by audit triggers so a logged "length" means what a person typed (migration 167).';

-- ---------------------------------------------------------------------------
-- 2. The audit trigger, now naming the student, class and term
-- ---------------------------------------------------------------------------
--
-- Action selection is IDENTICAL to 151 — only the context changed.

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
  v_term          record;
  v_section       record;
  v_student       record;
  v_student_name  text;
begin
  if v_now_submitted and not v_was_submitted then
    v_action := 'evaluation.writeup.submit';
  elsif v_now_submitted and v_was_submitted and v_text_changed then
    v_action := 'evaluation.writeup.resubmit';
  elsif (not v_now_submitted) and (v_was_submitted or v_text_changed) then
    v_action := 'evaluation.writeup.save';
  else
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  -- Who / which class / which term. Each lookup is a primary-key read; a
  -- missing row (impossible under the FKs, but a trigger must never be the
  -- thing that blocks a save) leaves its keys null rather than raising.
  select t.term_number, t.label, ay.ay_code
    into v_term
    from public.terms t
    left join public.academic_years ay on ay.id = t.academic_year_id
   where t.id = new.term_id;

  select s.name, l.label as level_label
    into v_section
    from public.sections s
    left join public.levels l on l.id = s.level_id
   where s.id = new.section_id;

  select st.student_number, st.first_name, st.middle_name, st.last_name
    into v_student
    from public.students st
   where st.id = new.student_id;

  -- "Last, First Middle" — lib/sis/full-name.ts::composeFullName.
  v_student_name := nullif(
    concat_ws(', ',
      nullif(btrim(coalesce(v_student.last_name, '')), ''),
      nullif(btrim(concat_ws(' ',
        nullif(btrim(coalesce(v_student.first_name, '')), ''),
        nullif(btrim(coalesce(v_student.middle_name, '')), ''))), '')
    ),
    ''
  );

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
      -- Characters of WRITING, markup excluded (see header).
      'length', public.rich_text_prose_length(new.writeup),
      'ay_code', v_term.ay_code,
      'term_id', new.term_id,
      'term_number', v_term.term_number,
      'term_label', v_term.label,
      'section_id', new.section_id,
      'section_name', v_section.name,
      'level_label', v_section.level_label,
      'student_id', new.student_id,
      'student_number', v_student.student_number,
      'student_name', v_student_name
    )
  );
  return null;
end;
$$;
