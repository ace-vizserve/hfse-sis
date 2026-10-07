-- Migration 185 — switch a grading sheet between Standard and Term 4 framework
--
-- Mr Ace, 2026-10-08 (KD #230 update): a sheet becomes a Term 4 framework
-- sheet by SWITCHING an existing sheet, and switches back the same way. New
-- sheets are always Standard; "Remove sheet" is unchanged.
--
-- One transaction, called by PATCH /api/grading-sheets/[id]/sheet-type with
-- the service role:
--   1. lock the sheet row, refuse what cannot switch (SQLSTATE HFT4F);
--   2. snapshot every entry that holds a score — returned to the route, which
--      writes it into the `sheet.switch_type` audit row (nothing is lost);
--   3. reshape the sheet in ONE statement (the shape check sees it whole);
--   4. reset every entry's scores. On a framework sheet the fill trigger
--      (184) writes the best term average back; the derive trigger recomputes.
-- No row is deleted. grade_entries_derive / compute_quarterly /
-- grade_component_ps are untouched (Hard Rule #1).
--
-- ⚠ grade_entries_derive "never erases" (153): when neither the old nor the
-- new row holds a score, it keeps the old derived figures even if the UPDATE
-- nulls them. So a row whose scores were already empty but which still
-- carried a grade (an imported grade, say) would keep it. Step 5 handles
-- exactly those rows: the reset gives them a 0 exam score (the row now holds
-- a score, so the grade is computed), then back to blank (the old row held a
-- score, so the grade is recomputed from nothing → NULL).

begin;

create or replace function public.switch_grading_sheet_type(
  p_sheet_id   uuid,
  p_sheet_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet   record;
  v_qa_max  numeric;
  v_cleared jsonb;
  v_count   int;
  v_stuck   uuid[];
begin
  if p_sheet_type is null or p_sheet_type not in ('standard', 'term4_framework') then
    raise exception 'Unknown sheet type.' using errcode = 'HFT4F';
  end if;

  select gs.id, gs.sheet_type, gs.is_locked, gs.subject_config_id, gs.slot_labels,
         s.is_examinable, t.term_number
    into v_sheet
    from grading_sheets gs
    join subjects s on s.id = gs.subject_id
    join terms t    on t.id = gs.term_id
   where gs.id = p_sheet_id
   for update of gs;

  if not found then
    raise exception 'Grading sheet not found.' using errcode = 'HFT4F';
  end if;
  if v_sheet.sheet_type = p_sheet_type then
    raise exception 'The sheet is already that type.' using errcode = 'HFT4F';
  end if;
  if v_sheet.is_locked then
    raise exception 'Unlock the sheet before switching its type.' using errcode = 'HFT4F';
  end if;
  if p_sheet_type = 'term4_framework' then
    if not coalesce(v_sheet.is_examinable, false) then
      raise exception 'A Term 4 framework sheet is only for subjects with a number grade.'
        using errcode = 'HFT4F';
    end if;
    if v_sheet.term_number is distinct from 4 then
      raise exception 'A Term 4 framework sheet is only for Term 4.' using errcode = 'HFT4F';
    end if;
  end if;

  -- 2. What is about to be cleared — every row the switch changes: a score,
  -- a derived figure (an imported or stale grade the reset will null), or an
  -- excusal. Nothing goes without a record.
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id',           ge.id,
           'section_student_id', ge.section_student_id,
           'ww_scores',          ge.ww_scores,
           'pt_scores',          ge.pt_scores,
           'qa_score',           ge.qa_score,
           'ww_excused',         ge.ww_excused,
           'pt_excused',         ge.pt_excused,
           'initial_grade',      ge.initial_grade,
           'quarterly_grade',    ge.quarterly_grade,
           'letter_grade',       ge.letter_grade
         ) order by ge.section_student_id), '[]'::jsonb),
         count(*)
    into v_cleared, v_count
    from grade_entries ge
   where ge.grading_sheet_id = p_sheet_id
     and (   ge.qa_score is not null
          or exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
          or exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
          or ge.ww_ps is not null or ge.pt_ps is not null or ge.qa_ps is not null
          or ge.initial_grade is not null or ge.quarterly_grade is not null
          or coalesce(ge.ww_excused, '{}') <> '{}' or coalesce(ge.pt_excused, '{}') <> '{}');

  -- 3. The new shape, in one statement. Slot labels described the assessments
  -- being cleared, so they go too (kept in the audit row by the route).
  if p_sheet_type = 'term4_framework' then
    update grading_sheets
       set sheet_type  = 'term4_framework',
           ww_totals   = '{100}',
           pt_totals   = '{30}',
           qa_total    = 100,
           ww_weight   = 0.50,
           pt_weight   = 0.20,
           qa_weight   = 0.30,
           slot_labels = null,
           updated_at  = now()
     where id = p_sheet_id;
  else
    select sc.qa_max into v_qa_max from subject_configs sc where sc.id = v_sheet.subject_config_id;
    update grading_sheets
       set sheet_type  = 'standard',
           ww_totals   = '{10,10,10}',
           pt_totals   = '{10,10,10}',
           qa_total    = coalesce(v_qa_max, 30),
           ww_weight   = null,
           pt_weight   = null,
           qa_weight   = null,
           slot_labels = null,
           updated_at  = now()
     where id = p_sheet_id;
  end if;

  -- Rows that hold no score but still carry a derived figure: the derive
  -- trigger would keep those figures through the reset (see the header).
  select coalesce(array_agg(ge.id), '{}') into v_stuck
    from grade_entries ge
   where ge.grading_sheet_id = p_sheet_id
     and ge.qa_score is null
     and not exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
     and not exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
     and (   ge.ww_ps is not null or ge.pt_ps is not null or ge.qa_ps is not null
          or ge.initial_grade is not null or ge.quarterly_grade is not null);

  -- 4. Every entry back to blank. is_na and letter_grade stay. The stuck rows
  -- hold an exam score of 0 for a moment (so the grade is computed) …
  update grade_entries
     set ww_scores  = '{}',
         pt_scores  = '{}',
         qa_score   = case when id = any(v_stuck) then 0 end,
         ww_excused = '{}',
         pt_excused = '{}'
   where grading_sheet_id = p_sheet_id;

  -- 5. … then blank again (the old row held a score → recomputed → NULL).
  if array_length(v_stuck, 1) > 0 then
    update grade_entries set qa_score = null where id = any(v_stuck);
  end if;

  return jsonb_build_object(
    'cleared',       v_cleared,
    'cleared_count', v_count,
    'slot_labels',   v_sheet.slot_labels,
    'from',          v_sheet.sheet_type,
    'to',            p_sheet_type
  );
end;
$$;

revoke all on function public.switch_grading_sheet_type(uuid, text) from public, anon, authenticated;
grant execute on function public.switch_grading_sheet_type(uuid, text) to service_role;

commit;
