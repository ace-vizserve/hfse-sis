-- Migration 152 — let the subject teacher encode scores from the browser
--
-- Third of three (attendance was 149, evaluation 150/151). Same shape: what the
-- write path enforced in TypeScript moves into Postgres, so the grid can call
-- supabase-js directly instead of awaiting a whole-page re-render per cell.
--
-- ⚠ THIS ONE IS NOT LIKE THE OTHER TWO, AND THE DIFFERENCE IS THE POINT.
--
-- Attendance and evaluation had one write path each, so the route disappeared.
-- `PATCH /api/grading-sheets/[id]/entries/[entryId]` has THREE, and only the
-- first is the one a teacher hits while filling in a sheet:
--
--   1. UNLOCKED, direct        — teacher or registrar types a score.      ← here
--   2. LOCKED, Path A          — apply an approved change request
--                                (`apply_change_request_atomic`, flips the
--                                request's state, emails the requester).
--   3. LOCKED, Path B          — registrar correction with reason +
--                                justification.
--
-- ONLY (1) MOVES. (2) and (3) stay on the route exactly as they are, because
-- they are not a save — they are a workflow, with approval records, state
-- transitions and notifications hanging off them. Hard Rule #5 is therefore
-- untouched: post-lock edits still go through the structured change-request
-- flow, still derive `approval_reference` server-side, still append to
-- `grade_audit_log`. Nothing below can bypass that, because the RLS policy in
-- section 5 refuses a browser write to a locked sheet outright.
--
-- WHAT THE ROUTE ENFORCED FOR PATH (1), AND WHERE IT LIVES NOW:
--
--   a. Role gate + "is the assigned SUBJECT TEACHER for this sheet"
--      (a form adviser reads every sheet in their section but does not
--      encode — advising is not teaching)          -> RLS policies, section 5
--   b. Sheet must be unlocked                       -> same policies
--   c. Scores normalised to the sheet's slot count  -> BEFORE trigger
--   d. Every score within [0, its max]              -> BEFORE trigger
--   e. letter_grade is UG/E and only on a
--      non-examinable subject                       -> BEFORE trigger
--   f. ww_ps / pt_ps / qa_ps / initial / quarterly
--      computed SERVER-SIDE (Hard Rule #2)          -> BEFORE trigger
--   g. One audit_log row per changed field          -> AFTER trigger
--
-- NOT MOVED, DELIBERATELY: the first-score label gate (the 422 that makes a
-- teacher name an activity before its first score). It needs to write
-- `grading_sheets.slot_labels` and the score in one go, and its error carries a
-- slot list the dialog reads. That is a second migration's worth of work and is
-- called out in the plan rather than half-done here.
--
-- ⚠ THE ONE THING THAT IS LOAD-BEARING AND EASY TO MISS. `quarterly_grade` is
-- floored from the UNROUNDED initial grade. `initial_grade` is stored as
-- numeric(7,4), so reading it back and flooring THAT would round 89.99995 up to
-- 90.0000 and change the answer at the boundary. The trigger transmutes from
-- the live value and only then rounds for storage — same order as the route.

-- ---------------------------------------------------------------------------
-- 1. The formula
-- ---------------------------------------------------------------------------
--
-- A line-by-line port of `lib/compute/quarterly.ts`, which is the single source
-- of truth named by Hard Rule #2 and self-tests to 93 on module load.
--
-- ⚠ EVERYTHING HERE IS `double precision`, NOT `numeric`, AND THAT IS ON
-- PURPOSE. JavaScript has one number type: IEEE-754 binary64. `double
-- precision` is the same type with the same rounding, so this function and
-- `computeQuarterly` agree bit for bit. `numeric` is exact decimal and rounds
-- division to a scale Postgres picks — nearly always the same answer, and
-- "nearly" is not a property you want in the function that decides whether a
-- child's mark is 89 or 90. The stored columns stay numeric(7,4); the cast
-- happens once, at the end, after the floor.
--
-- The operator ORDER is copied too, not just the arithmetic: `(sum / max) * 100`
-- rather than `sum * 100 / max`, and `60 + (15 * i) / 60` rather than any
-- algebraically-equal rearrangement. In floating point those are not the same
-- expression.

-- PS for a whole component (WW or PT).
--
-- Hard Rule #3 lives in the `continue`: a NULL slot is excluded from the
-- numerator AND the denominator. Blank ≠ Zero — a child who has not sat an
-- assessment is not a child who scored nothing on it. A slot with no configured
-- max is skipped the same way, which is what the TS does when `totals[i]` is
-- `undefined`; out-of-range array access returns NULL in Postgres, so the same
-- line covers it.
create or replace function public.grade_component_ps(
  p_scores numeric[],
  p_totals numeric[]
)
returns double precision
language plpgsql
immutable
as $$
declare
  v_sum_scores double precision := 0;
  v_sum_max    double precision := 0;
  v_score      numeric;
  v_max        numeric;
  i            int;
begin
  for i in 1 .. coalesce(array_length(p_scores, 1), 0) loop
    v_score := p_scores[i];
    if v_score is null then
      continue;                       -- blank slot: out of BOTH sums
    end if;
    v_max := p_totals[i];
    if v_max is null then
      continue;                       -- no max configured for this slot
    end if;
    v_sum_scores := v_sum_scores + v_score::double precision;
    v_sum_max    := v_sum_max + v_max::double precision;
  end loop;

  if v_sum_max = 0 then
    return null;                      -- nothing counted, or every max is zero
  end if;
  return (v_sum_scores / v_sum_max) * 100;
end;
$$;

-- QA is a single score, so there is no blank-slot rule to apply — either it is
-- there or the component is null. `total = 0` returns null rather than dividing.
create or replace function public.grade_qa_ps(
  p_score numeric,
  p_total numeric
)
returns double precision
language sql
immutable
as $$
  select case
           when p_score is null or p_total is null or p_total = 0 then null
           else (p_score::double precision / p_total::double precision) * 100
         end;
$$;

-- DepEd Order No. 8, s. 2015 transmutation.
--
-- ⚠ ALWAYS FLOOR, NEVER ROUND-TO-NEAREST. `floor`, not `round`: an initial
-- grade of 89.9 is a 92, not a 93. There is no clamp at either end because the
-- TS has none — an out-of-range initial is a validation failure upstream, and
-- silently clamping it here would hide the bug instead of surfacing it.
create or replace function public.grade_transmute(p_initial double precision)
returns double precision
language sql
immutable
as $$
  select case
           when p_initial < 60 then floor(60 + (15 * p_initial) / 60)
           else floor(75 + (25 * (p_initial - 60)) / 40)
         end;
$$;

-- The whole computation, matching `computeQuarterly`'s signature and its
-- all-null short circuit.
create or replace function public.compute_quarterly(
  p_ww_scores numeric[],
  p_ww_totals numeric[],
  p_pt_scores numeric[],
  p_pt_totals numeric[],
  p_qa_score  numeric,
  p_qa_total  numeric,
  p_ww_weight numeric,
  p_pt_weight numeric,
  p_qa_weight numeric,
  out ww_ps           double precision,
  out pt_ps           double precision,
  out qa_ps           double precision,
  out initial_grade   double precision,
  out quarterly_grade double precision
)
language plpgsql
immutable
as $$
begin
  ww_ps := public.grade_component_ps(p_ww_scores, p_ww_totals);
  pt_ps := public.grade_component_ps(p_pt_scores, p_pt_totals);
  qa_ps := public.grade_qa_ps(p_qa_score, p_qa_total);

  -- Nothing entered at all: every output is null, not zero. A sheet opened and
  -- never touched must not read as a room full of failures.
  if ww_ps is null and pt_ps is null and qa_ps is null then
    initial_grade := null;
    quarterly_grade := null;
    return;
  end if;

  -- A null component counts as 0 IN THE WEIGHTED SUM once anything at all has
  -- been entered — that is the TS's `(ww_ps ?? 0)`, and it is why a part-filled
  -- sheet shows a low running grade that climbs as the term fills in.
  initial_grade :=
      coalesce(ww_ps, 0) * p_ww_weight::double precision
    + coalesce(pt_ps, 0) * p_pt_weight::double precision
    + coalesce(qa_ps, 0) * p_qa_weight::double precision;

  quarterly_grade := public.grade_transmute(initial_grade);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Hard Rule #1 — the canonical case returns 93, or this migration fails
-- ---------------------------------------------------------------------------
--
-- `lib/compute/quarterly.ts` runs this exact assertion on module load and
-- refuses to load if it fails. The SQL port earns the same treatment: if the
-- numbers below do not come out right, the transaction aborts and NOTHING in
-- this file is applied. A half-applied formula migration is the one outcome
-- worth failing loudly to avoid.
--
-- The case: WW=[10,10]/max=[10,10], PT=[6,10,10]/max=[10,10,10], QA=22/30,
-- weights 40/40/20.
--   ww_ps   = 20/20 * 100 = 100
--   pt_ps   = 26/30 * 100 = 86.666…
--   qa_ps   = 22/30 * 100 = 73.333…
--   initial = 100*.4 + 86.666…*.4 + 73.333…*.2 = 89.333…
--   floor(75 + 25*(89.333… - 60)/40) = floor(93.333…) = 93
do $$
declare
  r record;
begin
  select * into r from public.compute_quarterly(
    array[10, 10]::numeric[], array[10, 10]::numeric[],
    array[6, 10, 10]::numeric[], array[10, 10, 10]::numeric[],
    22, 30,
    0.40, 0.40, 0.20
  );
  if r.quarterly_grade is distinct from 93 then
    raise exception
      'HFSE formula port failed Hard Rule #1: expected quarterly=93, got % (initial=%)',
      r.quarterly_grade, r.initial_grade;
  end if;

  -- Hard Rule #3, stated as a test rather than a comment. Same child, same
  -- marks, one PT slot not yet sat. If blanks counted as zero the PT
  -- percentage would be 16/30; excluded properly it is 16/20.
  select * into r from public.compute_quarterly(
    array[10, 10]::numeric[], array[10, 10]::numeric[],
    array[6, 10, null]::numeric[], array[10, 10, 10]::numeric[],
    22, 30,
    0.40, 0.40, 0.20
  );
  if round(r.pt_ps::numeric, 4) is distinct from 80.0000 then
    raise exception
      'Blank ≠ Zero is broken: pt_ps should be 80 (16/20), got %', r.pt_ps;
  end if;

  -- A zero is NOT a blank. Same slot, scored zero: now it counts in both sums,
  -- 16/30. This is the other half of Hard Rule #3 and the half that is easy to
  -- lose, because `coalesce` treats the two the same and the rule does not.
  select * into r from public.compute_quarterly(
    array[10, 10]::numeric[], array[10, 10]::numeric[],
    array[6, 10, 0]::numeric[], array[10, 10, 10]::numeric[],
    22, 30,
    0.40, 0.40, 0.20
  );
  if round(r.pt_ps::numeric, 4) is distinct from 53.3333 then
    raise exception
      'A scored zero must count in both sums: pt_ps should be 53.3333 (16/30), got %', r.pt_ps;
  end if;

  -- An untouched entry is null all the way down, not a zero.
  select * into r from public.compute_quarterly(
    array[null, null]::numeric[], array[10, 10]::numeric[],
    array[null]::numeric[], array[10]::numeric[],
    null, 30,
    0.40, 0.40, 0.20
  );
  if r.initial_grade is not null or r.quarterly_grade is not null then
    raise exception
      'An empty entry must compute to null, got initial=% quarterly=%',
      r.initial_grade, r.quarterly_grade;
  end if;

  -- The low branch of the transmutation, which the canonical case never
  -- reaches. initial=30 -> floor(60 + 15*30/60) = floor(67.5) = 67.
  if public.grade_transmute(30) is distinct from 67 then
    raise exception 'Low-branch transmutation wrong: expected 67, got %',
      public.grade_transmute(30);
  end if;

  -- Floor, not round. initial=60.1 -> floor(75 + 25*0.1/40) = floor(75.0625)
  -- = 75. A rounding implementation would also say 75 here, so pick a case
  -- where they disagree: initial=88 -> floor(92.5) = 92, round would give 93.
  if public.grade_transmute(88) is distinct from 92 then
    raise exception 'Transmutation must floor, not round: expected 92, got %',
      public.grade_transmute(88);
  end if;

  raise notice 'Formula port verified: 93 on the canonical case, Hard Rules #1 and #3 hold.';
end;
$$;

-- Six hand-picked cases prove the rules. This proves the PORT — the SQL above
-- against every number `lib/compute/quarterly.ts` has already written to this
-- database, row by row, reading only. If the two formulas disagree anywhere,
-- this names the entry.
--
-- Read-only and safe to run whenever. It is reported rather than asserted,
-- because a disagreement is not automatically a bug in the port: an entry last
-- saved before a sheet's maxes or weights were edited is stale on disk, and
-- that is a real, separate thing worth seeing rather than a reason to refuse
-- the migration. `scripts/verify-grading-formula-port.perf.ts` calls this and
-- splits the two apart.
create or replace function public.grade_formula_port_diff()
returns table (
  entry_id          uuid,
  grading_sheet_id  uuid,
  stored_quarterly  smallint,
  sql_quarterly     smallint,
  stored_initial    numeric,
  sql_initial       numeric,
  sheet_locked      boolean,
  entry_updated_at  timestamptz,
  sheet_updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select ge.id,
         ge.grading_sheet_id,
         ge.quarterly_grade,
         c.quarterly_grade::smallint,
         ge.initial_grade,
         round(c.initial_grade::numeric, 4),
         gs.is_locked,
         ge.updated_at,
         gs.updated_at
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
    join public.subject_configs sc on sc.id = gs.subject_config_id
   cross join lateral public.compute_quarterly(
     ge.ww_scores, gs.ww_totals,
     ge.pt_scores, gs.pt_totals,
     ge.qa_score,  gs.qa_total,
     sc.ww_weight, sc.pt_weight, sc.qa_weight
   ) c
   where ge.quarterly_grade is distinct from c.quarterly_grade::smallint
      or ge.initial_grade is distinct from round(c.initial_grade::numeric, 4);
$$;

-- ---------------------------------------------------------------------------
-- 3. Validate and derive, on every write
-- ---------------------------------------------------------------------------
--
-- Runs for EVERY writer, the service role included. The route computes the same
-- five values before it calls, and the trigger overwrites them with its own —
-- which is the intended end state, not a redundancy: after this migration the
-- formula in Postgres is the one that decides, and the copy in the route is
-- along for the ride until the page stops calling it.
--
-- Errors use custom SQLSTATEs so the grid can tell them apart from a genuine
-- database failure and show the teacher the right sentence:
--   HFRNG — a score is outside [0, max]
--   HFLTR — letter override is not UG/E, or the subject is examinable
--   HFCFG — the sheet has no subject config (weights unknown; cannot compute)

create or replace function public.grade_entries_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet   record;
  v_scores  numeric[];
  v_i       int;
  v_v       numeric;
  v_max     numeric;
  v_c       record;
begin
  select gs.ww_totals,
         gs.pt_totals,
         gs.qa_total,
         sc.ww_weight,
         sc.pt_weight,
         sc.qa_weight,
         s.is_examinable
    into v_sheet
    from public.grading_sheets gs
    join public.subjects s          on s.id = gs.subject_id
    left join public.subject_configs sc on sc.id = gs.subject_config_id
   where gs.id = new.grading_sheet_id;

  if not found then
    raise exception 'grading sheet % not found', new.grading_sheet_id;
  end if;
  if v_sheet.ww_weight is null then
    raise exception 'This sheet has no subject weights set, so grades cannot be worked out.'
      using errcode = 'HFCFG';
  end if;

  -- ---- normalise the score arrays to the sheet's slot count ----------------
  -- The route pads with nulls and truncates the overflow; the array the client
  -- sends is whatever its grid had. Doing it here means a stored row always has
  -- exactly as many slots as the sheet does, so the PS loop can pair scores to
  -- maxes by position without guessing.
  select coalesce(array_agg((new.ww_scores)[i] order by i), '{}'::numeric[])
    into v_scores
    from generate_series(1, coalesce(array_length(v_sheet.ww_totals, 1), 0)) as i;
  new.ww_scores := v_scores;

  select coalesce(array_agg((new.pt_scores)[i] order by i), '{}'::numeric[])
    into v_scores
    from generate_series(1, coalesce(array_length(v_sheet.pt_totals, 1), 0)) as i;
  new.pt_scores := v_scores;

  -- ---- every score within [0, its max] ------------------------------------
  -- A slot with no configured max is not checked, matching the TS, where
  -- `v > undefined` is false and the comparison quietly passes.
  for v_i in 1 .. coalesce(array_length(new.ww_scores, 1), 0) loop
    v_v := (new.ww_scores)[v_i];
    v_max := (v_sheet.ww_totals)[v_i];
    if v_v is not null and v_max is not null and (v_v < 0 or v_v > v_max) then
      raise exception 'W% score % is outside the allowed range 0 to %.', v_i, v_v, v_max
        using errcode = 'HFRNG';
    end if;
  end loop;
  for v_i in 1 .. coalesce(array_length(new.pt_scores, 1), 0) loop
    v_v := (new.pt_scores)[v_i];
    v_max := (v_sheet.pt_totals)[v_i];
    if v_v is not null and v_max is not null and (v_v < 0 or v_v > v_max) then
      raise exception 'PT% score % is outside the allowed range 0 to %.', v_i, v_v, v_max
        using errcode = 'HFRNG';
    end if;
  end loop;
  if new.qa_score is not null and v_sheet.qa_total is not null
     and (new.qa_score < 0 or new.qa_score > v_sheet.qa_total) then
    raise exception 'Quarterly assessment score % is outside the allowed range 0 to %.',
      new.qa_score, v_sheet.qa_total
      using errcode = 'HFRNG';
  end if;

  -- ---- letter override (KD #104) ------------------------------------------
  -- Only UG and E are ever STORED. A, B, C and IP are derived at render time
  -- from the number, so storing one would create a second, divergent answer to
  -- the same question.
  if new.letter_grade is not null then
    if new.letter_grade not in ('UG', 'E') then
      raise exception 'A letter grade can only be UG or E, or left empty.'
        using errcode = 'HFLTR';
    end if;
    if coalesce(v_sheet.is_examinable, true) then
      raise exception 'A letter grade can only be set on a non-examinable subject.'
        using errcode = 'HFLTR';
    end if;
  end if;

  -- ---- derive (Hard Rule #2) ----------------------------------------------
  select * into v_c from public.compute_quarterly(
    new.ww_scores, v_sheet.ww_totals,
    new.pt_scores, v_sheet.pt_totals,
    new.qa_score,  v_sheet.qa_total,
    v_sheet.ww_weight, v_sheet.pt_weight, v_sheet.qa_weight
  );

  -- ⚠ The floor already happened, inside compute_quarterly, against the full
  -- double. Only now is anything rounded for storage.
  new.ww_ps          := v_c.ww_ps::numeric;
  new.pt_ps          := v_c.pt_ps::numeric;
  new.qa_ps          := v_c.qa_ps::numeric;
  new.initial_grade  := v_c.initial_grade::numeric;
  new.quarterly_grade := v_c.quarterly_grade::smallint;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists grade_entries_derive_trg on public.grade_entries;
create trigger grade_entries_derive_trg
  before insert or update on public.grade_entries
  for each row execute function public.grade_entries_derive();

-- A sheet's maxes and weights live on OTHER tables, so changing them leaves
-- every derived value on the sheet stale and nothing fires. `lib/grading/
-- recompute-sheet.ts` does this today by reading every entry into Node,
-- recomputing and writing them back. With the trigger in place it is one
-- statement that touches each row and lets the formula run itself.
create or replace function public.recompute_grade_entries_for_sheet(p_sheet_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.grade_entries
     set updated_at = now()          -- the trigger derives everything else
   where grading_sheet_id = p_sheet_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Audit
-- ---------------------------------------------------------------------------
--
-- One `audit_log` row per CHANGED FIELD, with the same action, entity and
-- context keys the route writes, so old and new rows render identically in the
-- activity views and `lib/audit/humanize.ts` needs no change. Array slots use
-- the route's bracket notation and its ZERO-BASED index — `ww_scores[0]` is the
-- first slot — even though Postgres arrays start at 1. The stored strings have
-- to match the ones already in the table, not the language they were written in.
--
-- ⚠ THIS FIRES ONLY FOR A SIGNED-IN BROWSER CALLER (`auth.uid()` present).
-- The service role has no `auth.uid()`, and the route still writes its own
-- audit rows for the two locked paths it keeps. Without this check every
-- post-lock correction would be logged twice — once by the route with its
-- approval_reference, once by the trigger without one — and the second row
-- would make a properly-approved change look unapproved.
--
-- `grade_audit_log` is deliberately NOT written here. That table is the
-- post-lock record required by Hard Rule #5, post-lock writes cannot reach this
-- trigger from a browser (section 5 refuses them), and the route continues to
-- write it for the paths that can.

-- One `audit_log` row, shaped exactly like the one the route inserts.
create or replace function public.log_grade_entry_change(
  p_entry_id  uuid,
  p_sheet_id  uuid,
  p_field     text,
  p_old       text,
  p_new       text,
  p_actor_id  uuid,
  p_email     text,
  p_role      text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log
    (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
  values (
    p_actor_id,
    coalesce(p_email, 'system'),
    p_role,
    'entry.update',
    'grade_entry',
    p_entry_id,
    jsonb_build_object(
      'grading_sheet_id', p_sheet_id,
      'grade_entry_id',   p_entry_id,
      'field',            p_field,
      'old',              p_old,
      'new',              p_new,
      'was_locked',       false
    )
  );
$$;

create or replace function public.grade_entries_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role  text;
  v_i     int;
  v_old   numeric;
  v_new   numeric;
  v_len   int;
begin
  if auth.uid() is null then
    return null;                      -- service role: the route owns the trail
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  v_role := public.current_user_role();

  -- ww_scores / pt_scores, slot by slot.
  v_len := greatest(
    coalesce(array_length(old.ww_scores, 1), 0),
    coalesce(array_length(new.ww_scores, 1), 0)
  );
  for v_i in 1 .. v_len loop
    v_old := (old.ww_scores)[v_i];
    v_new := (new.ww_scores)[v_i];
    if v_old is distinct from v_new then
      perform public.log_grade_entry_change(
        new.id, new.grading_sheet_id,
        'ww_scores[' || (v_i - 1) || ']',
        case when v_old is null then null else trim_scale(v_old)::text end,
        case when v_new is null then null else trim_scale(v_new)::text end,
        auth.uid(), v_email, v_role
      );
    end if;
  end loop;

  v_len := greatest(
    coalesce(array_length(old.pt_scores, 1), 0),
    coalesce(array_length(new.pt_scores, 1), 0)
  );
  for v_i in 1 .. v_len loop
    v_old := (old.pt_scores)[v_i];
    v_new := (new.pt_scores)[v_i];
    if v_old is distinct from v_new then
      perform public.log_grade_entry_change(
        new.id, new.grading_sheet_id,
        'pt_scores[' || (v_i - 1) || ']',
        case when v_old is null then null else trim_scale(v_old)::text end,
        case when v_new is null then null else trim_scale(v_new)::text end,
        auth.uid(), v_email, v_role
      );
    end if;
  end loop;

  if old.qa_score is distinct from new.qa_score then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'qa_score',
      case when old.qa_score is null then null else trim_scale(old.qa_score)::text end,
      case when new.qa_score is null then null else trim_scale(new.qa_score)::text end,
      auth.uid(), v_email, v_role
    );
  end if;

  if old.letter_grade is distinct from new.letter_grade then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'letter_grade',
      old.letter_grade, new.letter_grade,
      auth.uid(), v_email, v_role
    );
  end if;

  -- `is_na` is NOT NULL with a default, so `coalesce` here mirrors the route's
  -- `?? false` rather than papering over anything.
  if coalesce(old.is_na, false) is distinct from coalesce(new.is_na, false) then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'is_na',
      lower(coalesce(old.is_na, false)::text),
      lower(coalesce(new.is_na, false)::text),
      auth.uid(), v_email, v_role
    );
  end if;

  return null;
end;
$$;

drop trigger if exists grade_entries_audit_trg on public.grade_entries;
create trigger grade_entries_audit_trg
  after update on public.grade_entries
  for each row execute function public.grade_entries_audit();

-- ---------------------------------------------------------------------------
-- 5. Who may write
-- ---------------------------------------------------------------------------
--
-- Migration 005 left `grade_entries` with a SELECT policy and nothing else, on
-- the stated reasoning that "the app uses the service-role client for every
-- write path". This adds the write side for the one path that is moving.
--
-- ⚠ `is_teacher_for_sheet` IS THE WRONG FUNCTION HERE, AND USING IT WOULD BE A
-- PRIVILEGE ESCALATION. It grants the form adviser read access to every subject
-- in their section — deliberately, so they can monitor the class — and the
-- route's own comment is explicit that advising carries no right to encode:
-- "an adviser could not rename an activity on a sheet, yet could overwrite
-- every score on it. Scores were the one outlier." So the write policy asks a
-- narrower question, matching `isSubjectTeacher`: are you assigned to teach
-- THIS subject in THIS section?
--
-- Relief cover is included on the same terms as the read side (migration 114) —
-- entering marks is the substitute's whole job — and a co-teacher counts
-- (migration 124). The regular teacher stays the name on the sheet either way;
-- that is resolved from `teacher_assignments` for display and is untouched here.

create or replace function public.is_subject_teacher_for_sheet(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    join public.teacher_assignments ta
      on ta.section_id = gs.section_id
     and ta.role in ('subject_teacher', 'co_teacher')
     and ta.subject_id = gs.subject_id
     and (ta.teacher_user_id = auth.uid()
          or (ta.relief_teacher_user_id = auth.uid()
              and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
    where gs.id = p_sheet_id
  );
$$;

-- Unlocked, and mine to teach. The lock clause is what keeps Hard Rule #5
-- intact after this migration: a locked sheet cannot be written from a browser
-- at all, so the only way a post-lock edit can happen is still the route's
-- change-request or correction path, which derives an `approval_reference` and
-- appends to `grade_audit_log`.
create or replace function public.can_write_grade_entry(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    where gs.id = p_sheet_id
      and gs.is_locked = false
      and (public.is_registrar_or_above()
           or public.is_subject_teacher_for_sheet(gs.id))
  );
$$;

drop policy if exists grade_entries_scoped_update on public.grade_entries;
create policy grade_entries_scoped_update
  on public.grade_entries for update
  to authenticated
  using (public.can_write_grade_entry(grading_sheet_id))
  with check (public.can_write_grade_entry(grading_sheet_id));

-- `using` AND `with check`, for the same reason as migration 150: `using`
-- decides which rows you may touch, `with check` what they may become. With
-- only `using`, a teacher could move an entry onto another sheet by editing
-- `grading_sheet_id` — the row they started from is theirs, and nothing would
-- examine the row they ended with.

-- INSERT and DELETE stay denied to `authenticated`. Rows are created by
-- `seed_grade_entries_for_sheet` when a sheet is opened, one per enrolled
-- child, and Hard Rule #6 makes them append-only from there: clearing a score
-- is setting it to null, never removing the row.
